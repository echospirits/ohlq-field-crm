import {
  AccountResearchJobStatus,
  AccountResearchPilotStatus,
  AccountResearchTier,
  Prisma,
  type PrismaClient,
} from '@prisma/client';
import { getAccountResearchQueue } from './accountResearch';
import {
  ACCOUNT_RESEARCH_JOB_RESERVE_MICROS,
  ACCOUNT_RESEARCH_PILOT_BUDGET_MICROS,
  ACCOUNT_RESEARCH_PILOT_MAX_ACCOUNTS,
  ACCOUNT_RESEARCH_PILOT_MODEL,
  ACCOUNT_RESEARCH_PRICING,
  chooseResearchTier,
  estimateResearchCostMicros,
  parseAccountResearchResult,
  validateExactResearchLocation,
  type AccountResearchInputSnapshot,
} from './accountResearchPilot';
import { assertAccountResearchPilotEnabled, retrieveAccountResearch, submitAccountResearch } from './accountResearchOpenAI';
import { evaluateOpportunityIntelligence } from './opportunityEngine';
import { prisma } from './prisma';

const ACTIVE_PILOT_STATUSES = [
  AccountResearchPilotStatus.RUNNING,
  AccountResearchPilotStatus.PAUSED,
  AccountResearchPilotStatus.READY_FOR_REVIEW,
];

const clipError = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 1_500);
const isFatalSubmissionError = (error: unknown) => [401, 403, 429].includes(Number((error as { status?: number })?.status));

export async function createAccountResearchPilot({
  organizationId,
  startedByUserId,
  db = prisma,
}: {
  organizationId: string;
  startedByUserId: string;
  db?: PrismaClient;
}) {
  assertAccountResearchPilotEnabled();
  const existing = await db.accountResearchPilot.findFirst({
    where: { organizationId, status: { in: ACTIVE_PILOT_STATUSES } },
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  });
  if (existing) throw new Error('This organization already has an active research pilot.');

  const dueAccounts = await getAccountResearchQueue({ db, organizationId, limit: null });
  const candidates = dueAccounts
    .filter((candidate) => candidate.address?.trim() && candidate.city?.trim() && candidate.zip?.match(/\d{5}/))
    .slice(0, ACCOUNT_RESEARCH_PILOT_MAX_ACCOUNTS);
  if (candidates.length === 0) throw new Error('No due opportunity accounts are available for the pilot.');
  const requiredReservation = candidates.length * ACCOUNT_RESEARCH_JOB_RESERVE_MICROS;
  if (requiredReservation > ACCOUNT_RESEARCH_PILOT_BUDGET_MICROS) throw new Error('The pilot reservation would exceed the $20 ceiling.');

  return db.accountResearchPilot.create({
    data: {
      organizationId,
      status: AccountResearchPilotStatus.RUNNING,
      model: ACCOUNT_RESEARCH_PILOT_MODEL,
      maxAccounts: candidates.length,
      budgetLimitMicros: ACCOUNT_RESEARCH_PILOT_BUDGET_MICROS,
      reservedMicros: requiredReservation,
      estimatedSpendMicros: 0,
      pricingSnapshot: ACCOUNT_RESEARCH_PRICING,
      startedByUserId,
      jobs: {
        create: candidates.map((candidate, index) => {
          const waterfall = chooseResearchTier(candidate.opportunities);
          const inputSnapshot: AccountResearchInputSnapshot = {
            wholesaleAccountId: candidate.id,
            licenseeId: candidate.licenseeId,
            accountName: candidate.name,
            address: candidate.address,
            city: candidate.city,
            state: candidate.state,
            zip: candidate.zip,
          };
          return {
            organizationId,
            wholesaleAccountId: candidate.id,
            tier: waterfall.tier === 'DEEP' ? AccountResearchTier.DEEP : AccountResearchTier.LIGHTWEIGHT,
            status: AccountResearchJobStatus.QUEUED,
            priority: index + 1,
            reason: waterfall.reason,
            inputSnapshot: inputSnapshot as unknown as Prisma.InputJsonValue,
            reservedMicros: ACCOUNT_RESEARCH_JOB_RESERVE_MICROS,
          };
        }),
      },
    },
    include: { jobs: { orderBy: { priority: 'asc' } } },
  });
}

export async function submitQueuedPilotJobs({ pilotId, organizationId, db = prisma }: { pilotId: string; organizationId: string; db?: PrismaClient }) {
  assertAccountResearchPilotEnabled();
  const pilot = await db.accountResearchPilot.findFirst({
    where: { id: pilotId, organizationId, status: { in: [AccountResearchPilotStatus.RUNNING, AccountResearchPilotStatus.PAUSED] } },
    select: { id: true, budgetLimitMicros: true, reservedMicros: true, estimatedSpendMicros: true },
  });
  if (!pilot) throw new Error('The active pilot could not be found.');
  if (pilot.estimatedSpendMicros + pilot.reservedMicros > pilot.budgetLimitMicros) throw new Error('The pilot budget reservation is invalid; no jobs were submitted.');

  const jobs = await db.accountResearchJob.findMany({
    where: { pilotId, organizationId, status: AccountResearchJobStatus.QUEUED },
    orderBy: { priority: 'asc' },
  });
  let submitted = 0;
  let failed = 0;
  let paused = false;
  for (const job of jobs) {
    try {
      const input = job.inputSnapshot as unknown as AccountResearchInputSnapshot;
      const response = await submitAccountResearch({
        input,
        tier: job.tier,
        pilotId,
        jobId: job.id,
      });
      await db.accountResearchJob.update({
        where: { id: job.id },
        data: {
          responseId: response.responseId,
          status: response.status === 'in_progress' ? AccountResearchJobStatus.RUNNING : AccountResearchJobStatus.SUBMITTED,
          submittedAt: new Date(),
          attemptCount: { increment: 1 },
          error: null,
        },
      });
      submitted += 1;
    } catch (error) {
      await db.$transaction([
        db.accountResearchJob.update({
          where: { id: job.id },
          data: { status: AccountResearchJobStatus.FAILED, error: clipError(error), attemptCount: { increment: 1 }, reservedMicros: 0 },
        }),
        db.accountResearchPilot.update({ where: { id: pilotId }, data: { reservedMicros: { decrement: job.reservedMicros } } }),
      ]);
      failed += 1;
      if (isFatalSubmissionError(error)) {
        await db.accountResearchPilot.update({ where: { id: pilotId }, data: { status: AccountResearchPilotStatus.PAUSED } });
        paused = true;
        break;
      }
    }
  }
  return { submitted, failed, paused, remaining: jobs.length - submitted - failed };
}

const finishRetrievedJob = async ({
  job,
  retrieved,
  db,
}: {
  job: Awaited<ReturnType<PrismaClient['accountResearchJob']['findMany']>>[number];
  retrieved: Awaited<ReturnType<typeof retrieveAccountResearch>>;
  db: PrismaClient;
}) => {
  const estimatedCostMicros = estimateResearchCostMicros(retrieved);
  const input = job.inputSnapshot as unknown as AccountResearchInputSnapshot;
  const locationValidation = retrieved.result ? validateExactResearchLocation(input, retrieved.result) : null;
  const nextStatus = retrieved.result ? AccountResearchJobStatus.NEEDS_REVIEW : AccountResearchJobStatus.FAILED;
  await db.$transaction(async (tx) => {
    const claimed = await tx.accountResearchJob.updateMany({
      where: { id: job.id, status: { in: [AccountResearchJobStatus.SUBMITTED, AccountResearchJobStatus.RUNNING] } },
      data: {
        status: nextStatus,
        result: retrieved.result as unknown as Prisma.InputJsonValue ?? Prisma.JsonNull,
        evidence: retrieved.result?.evidence as unknown as Prisma.InputJsonValue ?? [],
        locationValidation: locationValidation as unknown as Prisma.InputJsonValue ?? Prisma.JsonNull,
        estimatedCostMicros,
        inputTokens: retrieved.inputTokens,
        outputTokens: retrieved.outputTokens,
        webSearchCalls: retrieved.webSearchCalls,
        error: retrieved.error,
        reservedMicros: 0,
        completedAt: new Date(),
      },
    });
    if (claimed.count === 1) {
      await tx.accountResearchPilot.update({
        where: { id: job.pilotId },
        data: {
          reservedMicros: { decrement: job.reservedMicros },
          estimatedSpendMicros: { increment: estimatedCostMicros },
        },
      });
    }
  });
};

export async function pollAccountResearchPilot({ pilotId, organizationId, db = prisma }: { pilotId: string; organizationId: string; db?: PrismaClient }) {
  assertAccountResearchPilotEnabled();
  const jobs = await db.accountResearchJob.findMany({
    where: { pilotId, organizationId, status: { in: [AccountResearchJobStatus.SUBMITTED, AccountResearchJobStatus.RUNNING] }, responseId: { not: null } },
    orderBy: { priority: 'asc' },
  });
  let completed = 0;
  let pending = 0;
  let failedChecks = 0;
  for (const job of jobs) {
    try {
      const retrieved = await retrieveAccountResearch({ responseId: job.responseId! });
      if (['queued', 'in_progress'].includes(retrieved.status)) {
        await db.accountResearchJob.updateMany({
          where: { id: job.id, status: { in: [AccountResearchJobStatus.SUBMITTED, AccountResearchJobStatus.RUNNING] } },
          data: { status: AccountResearchJobStatus.RUNNING, error: null },
        });
        pending += 1;
        continue;
      }
      await finishRetrievedJob({ job, retrieved, db });
      completed += 1;
    } catch (error) {
      failedChecks += 1;
      await db.accountResearchJob.updateMany({
        where: { id: job.id, status: { in: [AccountResearchJobStatus.SUBMITTED, AccountResearchJobStatus.RUNNING] } },
        data: { error: `Result check failed: ${clipError(error)}` },
      });
      if (isFatalSubmissionError(error)) {
        await db.accountResearchPilot.updateMany({
          where: { id: pilotId, organizationId },
          data: { status: AccountResearchPilotStatus.PAUSED },
        });
        break;
      }
    }
  }
  await refreshPilotStatus({ pilotId, organizationId, db });
  await db.accountResearchPilot.updateMany({ where: { id: pilotId, organizationId }, data: { lastPolledAt: new Date() } });
  return { checked: jobs.length, completed, pending, failedChecks };
}

export async function refreshPilotStatus({ pilotId, organizationId, db = prisma }: { pilotId: string; organizationId: string; db?: PrismaClient }) {
  const counts = await db.accountResearchJob.groupBy({ by: ['status'], where: { pilotId, organizationId }, _count: { _all: true } });
  const count = new Map(counts.map((item) => [item.status, item._count._all]));
  const active = (count.get(AccountResearchJobStatus.QUEUED) ?? 0) + (count.get(AccountResearchJobStatus.SUBMITTED) ?? 0) + (count.get(AccountResearchJobStatus.RUNNING) ?? 0);
  const review = count.get(AccountResearchJobStatus.NEEDS_REVIEW) ?? 0;
  const current = await db.accountResearchPilot.findFirst({ where: { id: pilotId, organizationId }, select: { status: true } });
  if (!current) return;
  if (active > 0) return;
  const status = review > 0 ? AccountResearchPilotStatus.READY_FOR_REVIEW : AccountResearchPilotStatus.COMPLETE;
  await db.accountResearchPilot.update({ where: { id: pilotId }, data: { status, completedAt: status === AccountResearchPilotStatus.COMPLETE ? new Date() : null } });
}

export async function approveAccountResearchJob({
  jobId,
  organizationId,
  reviewedByUserId,
  reviewNote,
  db = prisma,
}: {
  jobId: string;
  organizationId: string;
  reviewedByUserId: string;
  reviewNote?: string | null;
  db?: PrismaClient;
}) {
  assertAccountResearchPilotEnabled();
  const job = await db.accountResearchJob.findFirst({
    where: { id: jobId, organizationId, status: AccountResearchJobStatus.NEEDS_REVIEW },
    include: { pilot: { select: { model: true } }, wholesaleAccount: { select: { id: true, name: true, licenseeId: true, isActive: true, mergedIntoId: true } } },
  });
  if (!job) throw new Error('The review item is no longer available.');
  if (!job.wholesaleAccount.isActive || job.wholesaleAccount.mergedIntoId) throw new Error('This account is inactive or has been merged.');
  const result = parseAccountResearchResult(job.result);
  const input = job.inputSnapshot as unknown as AccountResearchInputSnapshot;
  const locationValidation = validateExactResearchLocation(input, result);
  if (!locationValidation.exact) throw new Error('Approval is blocked because exact-location validation did not pass.');
  if (job.wholesaleAccount.id !== input.wholesaleAccountId || job.wholesaleAccount.licenseeId.toUpperCase() !== input.licenseeId.toUpperCase()) {
    throw new Error('The account identity changed after research; rerun this account.');
  }
  const sourceUrls = [...new Set(result.evidence.map((item) => item.sourceUrl))];
  const researchedAt = new Date(`${result.researchedAt}T12:00:00.000Z`);
  await db.$transaction(async (tx) => {
    await tx.targetPublicResearch.upsert({
      where: { wholesaleAccountId: job.wholesaleAccountId },
      create: {
        wholesaleAccountId: job.wholesaleAccountId,
        researchStatus: 'Reviewed pilot research',
        patioOutdoor: result.patioOutdoor,
        cocktailProgram: result.cocktailProgram,
        events: result.events,
        popularitySignal: result.popularitySignal,
        openStatus: result.openStatus,
        ownershipVerification: result.ownershipVerification,
        buyerStructure: result.buyerStructure,
        websiteUrl: result.websiteUrl,
        cocktailMenuUrl: result.cocktailMenuUrl,
        localBrandsOnMenu: result.localBrandsOnMenu,
        googleRating: result.googleRating,
        googleReviewCount: result.googleReviewCount,
        yelpRating: result.yelpRating,
        yelpReviewCount: result.yelpReviewCount,
        isNationalChain: result.isNationalChain,
        researchConfidence: result.confidence,
        notes: result.notes,
        sourceUrls,
        completedAt: researchedAt,
        researcher: `Reviewed automated pilot by ${reviewedByUserId}`,
        lastAttemptedAt: researchedAt,
        lastRefreshedAt: researchedAt,
        refreshStatus: 'COMPLETE',
        refreshError: null,
        researchModel: job.pilot.model,
        researchResponseId: job.responseId,
      },
      update: {
        researchStatus: 'Reviewed pilot research',
        patioOutdoor: result.patioOutdoor,
        cocktailProgram: result.cocktailProgram,
        events: result.events,
        popularitySignal: result.popularitySignal,
        openStatus: result.openStatus,
        ownershipVerification: result.ownershipVerification,
        buyerStructure: result.buyerStructure,
        websiteUrl: result.websiteUrl,
        cocktailMenuUrl: result.cocktailMenuUrl,
        localBrandsOnMenu: result.localBrandsOnMenu,
        googleRating: result.googleRating,
        googleReviewCount: result.googleReviewCount,
        yelpRating: result.yelpRating,
        yelpReviewCount: result.yelpReviewCount,
        isNationalChain: result.isNationalChain,
        researchConfidence: result.confidence,
        notes: result.notes,
        sourceUrls,
        completedAt: researchedAt,
        researcher: `Reviewed automated pilot by ${reviewedByUserId}`,
        lastAttemptedAt: researchedAt,
        lastRefreshedAt: researchedAt,
        refreshStatus: 'COMPLETE',
        refreshError: null,
        researchModel: job.pilot.model,
        researchResponseId: job.responseId,
      },
    });
    await evaluateOpportunityIntelligence({ db: tx as unknown as PrismaClient, asOfDate: new Date(), accountIds: [job.wholesaleAccountId], organizationId });
    await tx.accountResearchJob.update({
      where: { id: job.id },
      data: { status: AccountResearchJobStatus.APPROVED, reviewedAt: new Date(), reviewedByUserId, reviewNote: reviewNote?.trim() || null },
    });
  }, { timeout: 180_000 });
  await refreshPilotStatus({ pilotId: job.pilotId, organizationId, db });
}

export async function rejectAccountResearchJob({
  jobId,
  organizationId,
  reviewedByUserId,
  reviewNote,
  db = prisma,
}: {
  jobId: string;
  organizationId: string;
  reviewedByUserId: string;
  reviewNote: string;
  db?: PrismaClient;
}) {
  assertAccountResearchPilotEnabled();
  const note = reviewNote.trim();
  if (!note) throw new Error('Add a short rejection reason so the pilot can be evaluated.');
  const job = await db.accountResearchJob.update({
    where: { id: jobId, organizationId, status: AccountResearchJobStatus.NEEDS_REVIEW },
    data: { status: AccountResearchJobStatus.REJECTED, reviewedAt: new Date(), reviewedByUserId, reviewNote: note },
    select: { pilotId: true },
  });
  await refreshPilotStatus({ pilotId: job.pilotId, organizationId, db });
}

export async function getLatestAccountResearchPilot({ organizationId, db = prisma }: { organizationId: string; db?: PrismaClient }) {
  return db.accountResearchPilot.findFirst({
    where: { organizationId },
    orderBy: { startedAt: 'desc' },
    include: {
      jobs: {
        orderBy: { priority: 'asc' },
        include: { wholesaleAccount: { select: { name: true, licenseeId: true, address: true, city: true, state: true, zip: true } } },
      },
    },
  });
}
