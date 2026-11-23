import {
  AccountResearchJobStatus,
  AccountResearchPilotStatus,
  AccountResearchTier,
  Prisma,
  type PrismaClient,
} from '@prisma/client';
import { createResearchIdentitySnapshot, getPrioritizedAccountResearchQueue } from './accountResearchQueue';
import { refreshTenantOpportunityScoresForAccounts } from './accountResearchScoring';
import {
  ACCOUNT_RESEARCH_JOB_RESERVE_MICROS,
  ACCOUNT_RESEARCH_PILOT_BUDGET_MICROS,
  ACCOUNT_RESEARCH_PILOT_MAX_ACCOUNTS,
  ACCOUNT_RESEARCH_PILOT_MODEL,
  ACCOUNT_RESEARCH_PRICING,
  ACCOUNT_RESEARCH_SUBMISSION_WAVE_SIZE,
  ACCOUNT_RESEARCH_AUTOMATIC_RUN_ACTOR,
  chooseResearchTier,
  estimateResearchCostMicros,
  parseAccountResearchResult,
  validateExactResearchLocation,
  type AccountResearchResult,
  type AccountResearchInputSnapshot,
} from './accountResearchPilot';
import { ACCOUNT_RESEARCH_RECONCILIATION_PREFIX } from './accountResearchFailures';
import {
  assertAccountResearchAutomationEnabled,
  assertAccountResearchPilotEnabled,
  isAccountResearchResponseUnavailable,
  isAmbiguousAccountResearchSubmissionError,
  retrieveAccountResearch,
  submitAccountResearch,
  type AccountResearchExecutionMode,
} from './accountResearchOpenAI';
import { prisma } from './prisma';

const ACTIVE_PILOT_STATUSES = [
  AccountResearchPilotStatus.RUNNING,
  AccountResearchPilotStatus.PAUSED,
  AccountResearchPilotStatus.READY_FOR_REVIEW,
];
const ACTIVE_PROVIDER_JOB_STATUSES = [AccountResearchJobStatus.SUBMITTED, AccountResearchJobStatus.RUNNING];
const TERMINAL_PROVIDER_STATUSES = new Set(['completed', 'failed', 'cancelled', 'incomplete']);
const PROVIDER_PENDING_LIMIT_MS = 60 * 60_000;
const PROVIDER_RESULT_CHECK_FAILURE = 'Result check failed:';

const clipError = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 1_500);
const isFatalSubmissionError = (error: unknown) => [401, 403, 429].includes(Number((error as { status?: number })?.status));
const assertResearchMode = (mode: AccountResearchExecutionMode) => mode === 'automatic' ? assertAccountResearchAutomationEnabled() : assertAccountResearchPilotEnabled();

async function lockResearchPilot(tx: Prisma.TransactionClient, pilotId: string, organizationId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`account-research-pilot:${organizationId}:${pilotId}`}, 0))`;
}

const researchStorageFields = (result: AccountResearchResult) => {
  const [primaryRating, secondaryRating] = result.publicRatings;
  return {
    // These legacy columns remain the numeric storage slots until a later schema migration.
    // Source identity is authoritative in identitySnapshot.publicRatings.
    googleRating: primaryRating?.rating ?? null,
    googleReviewCount: primaryRating?.reviewCount ?? null,
    yelpRating: secondaryRating?.rating ?? null,
    yelpReviewCount: secondaryRating?.reviewCount ?? null,
    sourceUrls: [...new Set([
      ...result.evidence.map((item) => item.sourceUrl),
      ...result.publicRatings.map((item) => item.sourceUrl),
      ...(result.businessHours ? [result.businessHours.sourceUrl] : []),
    ])],
  };
};

type PilotJobCounts = Partial<Record<AccountResearchJobStatus, number>>;

export const deriveSettledPilotStatus = (counts: PilotJobCounts) => {
  const active = (counts.QUEUED ?? 0) + (counts.SUBMITTED ?? 0) + (counts.RUNNING ?? 0);
  if (active > 0) return null;
  if ((counts.NEEDS_REVIEW ?? 0) > 0) return AccountResearchPilotStatus.READY_FOR_REVIEW;
  if ((counts.FAILED ?? 0) + (counts.BLOCKED_BUDGET ?? 0) > 0) return AccountResearchPilotStatus.FAILED;
  return Object.values(counts).some((count) => count > 0) ? AccountResearchPilotStatus.COMPLETE : null;
};

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
    where: { organizationId, startedByUserId: { not: ACCOUNT_RESEARCH_AUTOMATIC_RUN_ACTOR }, status: { in: ACTIVE_PILOT_STATUSES } },
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  });
  if (existing) throw new Error('This organization already has an active manual research test.');

  const dueAccounts = await getPrioritizedAccountResearchQueue({ db, limit: null, organizationId });
  const candidates = dueAccounts
    .filter((candidate) => candidate.address?.trim() && candidate.city?.trim() && candidate.zip?.match(/\d{5}/))
    .slice(0, ACCOUNT_RESEARCH_PILOT_MAX_ACCOUNTS);
  if (candidates.length === 0) throw new Error('No accounts currently need refreshed research.');
  const requiredReservation = candidates.length * ACCOUNT_RESEARCH_JOB_RESERVE_MICROS;
  if (requiredReservation > ACCOUNT_RESEARCH_PILOT_BUDGET_MICROS) throw new Error('The manual test reservation would exceed its spending ceiling.');

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
          const waterfall = chooseResearchTier([
            ...candidate.opportunities.map(p => ({ status: p.status, rating: null })),
            ...(candidate.currentAssessments ?? []).map(a => ({ status: 'CURRENT', rating: a.rating })),
          ]);
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
            reason: candidate.researchReason || waterfall.reason,
            inputSnapshot: inputSnapshot as unknown as Prisma.InputJsonValue,
            reservedMicros: ACCOUNT_RESEARCH_JOB_RESERVE_MICROS,
          };
        }),
      },
    },
    include: { jobs: { orderBy: { priority: 'asc' } } },
  });
}

// Recover during polling as well as submission: an interrupted claim otherwise
// blocks the active-wave gate forever. Conditional updates make overlapping
// cron workflows release each reservation only once.
export async function recoverInterruptedResearchSubmissions({
  pilotId, organizationId, db = prisma, now = new Date(), mode = 'manual',
}: { pilotId: string; organizationId: string; db?: PrismaClient; now?: Date; mode?: AccountResearchExecutionMode }) {
  const staleClaimCutoff = new Date(now.getTime() - 15 * 60_000);
  const where = {
    pilotId, organizationId, status: AccountResearchJobStatus.SUBMITTED,
    responseId: null, submittedAt: { lt: staleClaimCutoff },
  };
  const staleClaims = await db.accountResearchJob.findMany({
    where, select: { id: true, reservedMicros: true },
  });
  const error = 'Submission was interrupted before an OpenAI response ID was saved.';
  let recovered = 0;
  for (const stale of staleClaims) {
    recovered += await db.$transaction(async (tx) => {
      const claim = await tx.accountResearchJob.updateMany({
        where: { ...where, id: stale.id },
        data: {
          status: AccountResearchJobStatus.FAILED,
          reservedMicros: 0,
          ...(mode === 'automatic' ? { error: `${ACCOUNT_RESEARCH_RECONCILIATION_PREFIX} ${error}`, completedAt: now } : { error }),
        },
      });
      if (claim.count !== 1) return 0;
      await tx.accountResearchPilot.update({
        where: { id: pilotId }, data: { reservedMicros: { decrement: stale.reservedMicros } },
      });
      return 1;
    });
  }
  if (recovered > 0) console.warn('account-research.interrupted-submissions-recovered', { pilotId, recovered });
  return recovered;
}

export async function submitQueuedPilotJobs({ pilotId, organizationId, db = prisma, mode = 'manual', take = ACCOUNT_RESEARCH_SUBMISSION_WAVE_SIZE }: { pilotId: string; organizationId: string; db?: PrismaClient; mode?: AccountResearchExecutionMode; take?: number }) {
  assertResearchMode(mode);
  const pilot = await db.accountResearchPilot.findFirst({
    where: { id: pilotId, organizationId, status: { in: [AccountResearchPilotStatus.RUNNING, AccountResearchPilotStatus.PAUSED] } },
    select: { id: true, budgetLimitMicros: true, reservedMicros: true, estimatedSpendMicros: true },
  });
  if (!pilot) throw new Error('The active pilot could not be found.');
  if (pilot.estimatedSpendMicros + pilot.reservedMicros > pilot.budgetLimitMicros) throw new Error('The pilot budget reservation is invalid; no jobs were submitted.');

  const recovered = await recoverInterruptedResearchSubmissions({ pilotId, organizationId, db, mode });
  let reconciliationRequired = mode === 'automatic' ? recovered : 0;

  const activeWhere = { pilotId, organizationId, status: { in: ACTIVE_PROVIDER_JOB_STATUSES } };
  const queuedWhere = { pilotId, organizationId, status: AccountResearchJobStatus.QUEUED };
  const activeJobs = await db.accountResearchJob.count({ where: activeWhere });
  if (mode === 'manual' && activeJobs > 0) throw new Error('The current 25-account wave is still running. Check and apply it before submitting the next wave.');

  const queuedJobs = await db.accountResearchJob.count({ where: queuedWhere });
  const batchSize = mode === 'automatic' ? Math.min(take, ACCOUNT_RESEARCH_SUBMISSION_WAVE_SIZE - activeJobs) : take;
  if (batchSize <= 0) return { submitted: 0, failed: 0, paused: false, remaining: queuedJobs, reconciliationRequired };
  const jobs = await db.accountResearchJob.findMany({
    where: queuedWhere,
    orderBy: { priority: 'asc' },
    take: batchSize,
  });
  let submitted = 0;
  let failed = 0;
  let paused = false;
  for (const job of jobs) {
    const claimJob = (tx: Prisma.TransactionClient) => tx.accountResearchJob.updateMany({
      where: { ...queuedWhere, id: job.id },
      data: { status: AccountResearchJobStatus.SUBMITTED, submittedAt: new Date(), attemptCount: { increment: 1 }, error: null },
    });
    const claim = mode === 'automatic' ? await db.$transaction(async (tx) => {
      await lockResearchPilot(tx, pilotId, organizationId);
      const active = await tx.accountResearchJob.count({ where: activeWhere });
      return active < ACCOUNT_RESEARCH_SUBMISSION_WAVE_SIZE ? claimJob(tx) : null;
    }) : await claimJob(db);
    if (!claim) break;
    if (claim.count !== 1) continue;
    let response: Awaited<ReturnType<typeof submitAccountResearch>>;
    try {
      response = await submitAccountResearch({
        input: job.inputSnapshot as unknown as AccountResearchInputSnapshot,
        tier: job.tier,
        pilotId,
        jobId: job.id,
        mode,
      });
    } catch (error) {
      const ambiguous = mode === 'automatic' && isAmbiguousAccountResearchSubmissionError(error);
      const message = clipError(error);
      const recorded = await db.$transaction(async (tx) => {
        const failure = await tx.accountResearchJob.updateMany({
          where: { id: job.id, organizationId, pilotId, status: AccountResearchJobStatus.SUBMITTED, responseId: null },
          data: {
            status: AccountResearchJobStatus.FAILED,
            reservedMicros: 0,
            ...(ambiguous ? { error: `${ACCOUNT_RESEARCH_RECONCILIATION_PREFIX} OpenAI did not confirm submission. ${message}`, completedAt: new Date() } : { error: message }),
          },
        });
        if (failure.count !== 1) return false;
        await tx.accountResearchPilot.update({ where: { id: pilotId, organizationId }, data: { reservedMicros: { decrement: job.reservedMicros } } });
        return true;
      });
      failed += 1;
      if (ambiguous && recorded) reconciliationRequired += 1;
      if (isFatalSubmissionError(error)) {
        await db.accountResearchPilot.update({ where: { id: pilotId }, data: { status: AccountResearchPilotStatus.PAUSED } });
        paused = true;
        break;
      }
      continue;
    }

    // Keep a claimed submission in place if persisting its response fails. A retry must not submit it again.
    await db.accountResearchJob.update({
      where: { id: job.id, organizationId, pilotId, status: AccountResearchJobStatus.SUBMITTED, AND: [{ responseId: null }] },
      data: {
        responseId: response.responseId,
        status: response.status === 'in_progress' ? AccountResearchJobStatus.RUNNING : AccountResearchJobStatus.SUBMITTED,
        error: null,
      },
    });
    submitted += 1;
  }
  if (submitted > 0 && !paused) {
    await db.accountResearchPilot.updateMany({
      where: { id: pilotId, organizationId },
      data: { status: AccountResearchPilotStatus.RUNNING },
    });
  }
  return { submitted, failed, paused, remaining: Math.max(0, queuedJobs - submitted - failed), reconciliationRequired };
}

type ResearchJob = Awaited<ReturnType<PrismaClient['accountResearchJob']['findMany']>>[number];

function exceededProviderPendingLimit(job: ResearchJob) {
  return Date.now() - (job.submittedAt ?? job.createdAt).getTime() >= PROVIDER_PENDING_LIMIT_MS;
}

function activeResponseWhere(job: ResearchJob) {
  return { id: job.id, pilotId: job.pilotId, organizationId: job.organizationId, responseId: job.responseId, status: { in: ACTIVE_PROVIDER_JOB_STATUSES } };
}

async function recordResponseForReconciliation(job: ResearchJob, reason: string, db: PrismaClient) {
  return db.$transaction(async (tx) => {
    await lockResearchPilot(tx, job.pilotId, job.organizationId);
    const claim = await tx.accountResearchJob.updateMany({
      where: activeResponseWhere(job),
      data: {
        status: AccountResearchJobStatus.FAILED,
        error: `${ACCOUNT_RESEARCH_RECONCILIATION_PREFIX} ${reason}`,
        reservedMicros: 0,
        completedAt: new Date(),
      },
    });
    if (claim.count === 1) {
      await tx.accountResearchPilot.update({
        where: { id: job.pilotId, organizationId: job.organizationId },
        data: { reservedMicros: { decrement: job.reservedMicros } },
      });
    }
    return claim.count;
  });
}

const finishRetrievedJob = async ({
  job,
  retrieved,
  db,
}: {
  job: ResearchJob;
  retrieved: Awaited<ReturnType<typeof retrieveAccountResearch>>;
  db: PrismaClient;
}) => {
  const estimatedCostMicros = estimateResearchCostMicros(retrieved);
  const input = job.inputSnapshot as unknown as AccountResearchInputSnapshot;
  const locationValidation = retrieved.result ? validateExactResearchLocation(input, retrieved.result) : null;
  const data = {
    status: retrieved.result ? AccountResearchJobStatus.NEEDS_REVIEW : AccountResearchJobStatus.FAILED,
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
  };
  return db.$transaction(async (tx) => {
    await lockResearchPilot(tx, job.pilotId, job.organizationId);
    const where = activeResponseWhere(job);
    const claimed = await tx.accountResearchJob.updateMany({ where, data });
    let saved = claimed.count;
    if (saved === 0 && retrieved.result) {
      // A concurrent poll may have marked this ID unavailable just before the result arrived.
      const resolved = await tx.accountResearchJob.updateMany({
        where: { ...where, status: AccountResearchJobStatus.FAILED, error: { startsWith: ACCOUNT_RESEARCH_RECONCILIATION_PREFIX } },
        data,
      });
      saved = resolved.count;
    }
    if (saved === 1) {
      await tx.accountResearchPilot.update({
        where: { id: job.pilotId, organizationId: job.organizationId },
        data: {
          reservedMicros: { decrement: claimed.count === 1 ? job.reservedMicros : 0 },
          estimatedSpendMicros: { increment: estimatedCostMicros },
        },
      });
    }
    return saved;
  });
};

export async function autoResolveAccountResearchJobs({
  pilotId,
  organizationId,
  db = prisma,
  mode = 'manual',
}: {
  pilotId: string;
  organizationId: string;
  db?: PrismaClient;
  mode?: AccountResearchExecutionMode;
}) {
  assertResearchMode(mode);
  await recoverInterruptedResearchSubmissions({ pilotId, organizationId, db, mode });
  const jobs = await db.accountResearchJob.findMany({
    where: { pilotId, organizationId, status: AccountResearchJobStatus.NEEDS_REVIEW },
    orderBy: { priority: 'asc' },
    include: {
      pilot: { select: { model: true } },
      wholesaleAccount: { select: { id: true, licenseeId: true, isActive: true, mergedIntoId: true } },
    },
  });
  const approved: Array<{ job: typeof jobs[number]; result: ReturnType<typeof parseAccountResearchResult> }> = [];
  const rejected: Array<{ id: string; note: string }> = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const job of jobs) {
    try {
      const result = parseAccountResearchResult(job.result);
      const input = job.inputSnapshot as unknown as AccountResearchInputSnapshot;
      const validation = validateExactResearchLocation(input, result);
      if (!job.wholesaleAccount.isActive || job.wholesaleAccount.mergedIntoId) {
        rejected.push({ id: job.id, note: 'Automatically declined because the account is inactive or merged.' });
      } else if (job.wholesaleAccount.id !== input.wholesaleAccountId || job.wholesaleAccount.licenseeId.toUpperCase() !== input.licenseeId.toUpperCase()) {
        rejected.push({ id: job.id, note: 'Automatically declined because the CRM account identity changed after submission.' });
      } else if (!validation.exact) {
        rejected.push({ id: job.id, note: `Automatically declined: exact-location validation failed. ${validation.explanation}`.slice(0, 500) });
      } else {
        approved.push({ job, result });
      }
    } catch (error) {
      failed.push({ id: job.id, error: `Automatic validation failed: ${clipError(error)}` });
    }
  }

  const resolvedAt = new Date();
  const resolved = await db.$transaction(async (tx) => {
    const reviewing = { pilotId, organizationId, status: AccountResearchJobStatus.NEEDS_REVIEW };
    const accountIds: string[] = [];
    let rejectedCount = 0;
    let failedCount = 0;
    for (const { job, result } of approved) {
      const claim = await tx.accountResearchJob.updateMany({
        where: { ...reviewing, id: job.id },
        data: {
          status: AccountResearchJobStatus.APPROVED,
          reviewedAt: resolvedAt,
          reviewedByUserId: null,
          reviewNote: 'Automatically applied after exact-location and structured-evidence validation.',
        },
      });
      if (claim.count !== 1) continue;
      const storage = researchStorageFields(result);
      const input = job.inputSnapshot as unknown as AccountResearchInputSnapshot;
      const researchData = {
        researchStatus: 'Automatically validated research',
        patioOutdoor: result.patioOutdoor,
        privateDining: result.privateDining,
        cocktailProgram: result.cocktailProgram,
        events: result.events,
        popularitySignal: result.popularitySignal,
        openStatus: result.openStatus,
        ownershipVerification: result.ownershipVerification,
        buyerStructure: result.buyerStructure,
        websiteUrl: result.websiteUrl,
        cocktailMenuUrl: result.cocktailMenuUrl,
        localBrandsOnMenu: result.localBrandsOnMenu,
        googleRating: storage.googleRating,
        googleReviewCount: storage.googleReviewCount,
        yelpRating: storage.yelpRating,
        yelpReviewCount: storage.yelpReviewCount,
        isNationalChain: result.isNationalChain,
        researchConfidence: result.confidence,
        notes: result.notes,
        sourceUrls: storage.sourceUrls,
        completedAt: job.completedAt ?? resolvedAt,
        researcher: 'Automated guarded research',
        lastAttemptedAt: job.completedAt ?? resolvedAt,
        lastRefreshedAt: resolvedAt,
        refreshStatus: 'COMPLETE',
        refreshError: null,
        researchModel: job.pilot.model,
        researchResponseId: job.responseId,
        identitySnapshot: createResearchIdentitySnapshot({
          name: input.accountName,
          address: input.address,
          city: input.city,
          state: input.state,
          zip: input.zip,
        }, result),
      };
      await tx.targetPublicResearch.upsert({
        where: { wholesaleAccountId: job.wholesaleAccountId },
        create: { wholesaleAccountId: job.wholesaleAccountId, ...researchData },
        update: researchData,
      });
      accountIds.push(job.wholesaleAccountId);
    }
    for (const item of rejected) {
      const claim = await tx.accountResearchJob.updateMany({
        where: { ...reviewing, id: item.id },
        data: { status: AccountResearchJobStatus.REJECTED, reviewedAt: resolvedAt, reviewedByUserId: null, reviewNote: item.note },
      });
      rejectedCount += claim.count;
    }
    for (const item of failed) {
      const claim = await tx.accountResearchJob.updateMany({ where: { ...reviewing, id: item.id }, data: { status: AccountResearchJobStatus.FAILED, error: item.error } });
      failedCount += claim.count;
    }
    return { accountIds, rejectedCount, failedCount };
  }, { timeout: 300_000 });

  await refreshTenantOpportunityScoresForAccounts({
    db,
    asOfDate: resolvedAt,
    accountIds: resolved.accountIds,
  });

  return { applied: resolved.accountIds.length, rejected: resolved.rejectedCount, failed: resolved.failedCount };
}

export async function pollAccountResearchPilot({ pilotId, organizationId, db = prisma, mode = 'manual' }: { pilotId: string; organizationId: string; db?: PrismaClient; mode?: AccountResearchExecutionMode }) {
  assertResearchMode(mode);
  const recovered = await recoverInterruptedResearchSubmissions({ pilotId, organizationId, db, mode });
  const jobs = await db.accountResearchJob.findMany({
    where: { pilotId, organizationId, status: { in: ACTIVE_PROVIDER_JOB_STATUSES }, responseId: { not: null } },
    orderBy: { priority: 'asc' },
  });
  let completed = 0;
  let pending = 0;
  let failedChecks = 0;
  let reconciliationRequired = mode === 'automatic' ? recovered : 0;
  let paused = false;
  for (const job of jobs) {
    let retrieved: Awaited<ReturnType<typeof retrieveAccountResearch>>;
    try {
      retrieved = await retrieveAccountResearch({ responseId: job.responseId!, mode });
    } catch (error) {
      if (isAccountResearchResponseUnavailable(error)) {
        reconciliationRequired += await recordResponseForReconciliation(job, `OpenAI returned HTTP ${error.status} for the saved response.`, db);
        continue;
      }
      const fatal = isFatalSubmissionError(error);
      if (!fatal && job.error?.startsWith(PROVIDER_RESULT_CHECK_FAILURE) && exceededProviderPendingLimit(job)) {
        reconciliationRequired += await recordResponseForReconciliation(job, 'Repeated result checks failed for the saved response more than one hour after submission.', db);
        continue;
      }
      failedChecks += 1;
      await db.accountResearchJob.updateMany({
        where: activeResponseWhere(job),
        data: { error: `${PROVIDER_RESULT_CHECK_FAILURE} ${clipError(error)}` },
      });
      if (fatal) {
        await db.accountResearchPilot.updateMany({
          where: { id: pilotId, organizationId },
          data: { status: AccountResearchPilotStatus.PAUSED },
        });
        paused = true;
        break;
      }
      continue;
    }

    if (retrieved.status === 'queued' || retrieved.status === 'in_progress') {
      if (exceededProviderPendingLimit(job)) {
        reconciliationRequired += await recordResponseForReconciliation(job, 'The saved response was still pending after one hour.', db);
      } else {
        const update = await db.accountResearchJob.updateMany({
          where: activeResponseWhere(job),
          data: { status: AccountResearchJobStatus.RUNNING, error: null },
        });
        pending += update.count;
      }
    } else if (!TERMINAL_PROVIDER_STATUSES.has(retrieved.status)) {
      reconciliationRequired += await recordResponseForReconciliation(job, 'OpenAI returned an expired or unrecognized status for the saved response.', db);
    } else {
      completed += await finishRetrievedJob({ job, retrieved, db });
    }
  }
  const automatic = await autoResolveAccountResearchJobs({ pilotId, organizationId, db, mode });
  await refreshPilotStatus({ pilotId, organizationId, db });
  await db.accountResearchPilot.updateMany({ where: { id: pilotId, organizationId }, data: { lastPolledAt: new Date() } });
  return { checked: jobs.length, completed, pending, failedChecks, reconciliationRequired, paused, ...automatic };
}

export async function refreshPilotStatus({ pilotId, organizationId, db = prisma }: { pilotId: string; organizationId: string; db?: PrismaClient }) {
  await db.$transaction(async (tx) => {
    await lockResearchPilot(tx, pilotId, organizationId);
    const pilot = await tx.accountResearchPilot.findFirst({ where: { id: pilotId, organizationId }, select: { maxAccounts: true } });
    if (!pilot) return;
    const counts = await tx.accountResearchJob.groupBy({ by: ['status'], where: { pilotId, organizationId }, _count: { _all: true } });
    const total = counts.reduce((sum, item) => sum + item._count._all, 0);
    if (!total || total < pilot.maxAccounts) {
      throw new Error(`Account research job count does not cover the saved batch (${total} of ${pilot.maxAccounts}).`);
    }
    const count = Object.fromEntries(counts.map((item) => [item.status, item._count._all])) as PilotJobCounts;
    const status = deriveSettledPilotStatus(count);
    if (!status) return;
    const isTerminal = status === AccountResearchPilotStatus.COMPLETE || status === AccountResearchPilotStatus.FAILED;
    await tx.accountResearchPilot.update({ where: { id: pilotId, organizationId }, data: { status, completedAt: isTerminal ? new Date() : null } });
  });
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
  const storage = researchStorageFields(result);
  const appliedAt = new Date();
  await db.$transaction(async (tx) => {
    await tx.targetPublicResearch.upsert({
      where: { wholesaleAccountId: job.wholesaleAccountId },
      create: {
        wholesaleAccountId: job.wholesaleAccountId,
        researchStatus: 'Reviewed pilot research',
        patioOutdoor: result.patioOutdoor,
        privateDining: result.privateDining,
        cocktailProgram: result.cocktailProgram,
        events: result.events,
        popularitySignal: result.popularitySignal,
        openStatus: result.openStatus,
        ownershipVerification: result.ownershipVerification,
        buyerStructure: result.buyerStructure,
        websiteUrl: result.websiteUrl,
        cocktailMenuUrl: result.cocktailMenuUrl,
        localBrandsOnMenu: result.localBrandsOnMenu,
        googleRating: storage.googleRating,
        googleReviewCount: storage.googleReviewCount,
        yelpRating: storage.yelpRating,
        yelpReviewCount: storage.yelpReviewCount,
        isNationalChain: result.isNationalChain,
        researchConfidence: result.confidence,
        notes: result.notes,
        sourceUrls: storage.sourceUrls,
        completedAt: job.completedAt ?? appliedAt,
        researcher: `Reviewed automated pilot by ${reviewedByUserId}`,
        lastAttemptedAt: job.completedAt ?? appliedAt,
        lastRefreshedAt: appliedAt,
        refreshStatus: 'COMPLETE',
        refreshError: null,
        researchModel: job.pilot.model,
        researchResponseId: job.responseId,
        identitySnapshot: createResearchIdentitySnapshot({
          name: input.accountName,
          address: input.address,
          city: input.city,
          state: input.state,
          zip: input.zip,
        }, result),
      },
      update: {
        researchStatus: 'Reviewed pilot research',
        patioOutdoor: result.patioOutdoor,
        privateDining: result.privateDining,
        cocktailProgram: result.cocktailProgram,
        events: result.events,
        popularitySignal: result.popularitySignal,
        openStatus: result.openStatus,
        ownershipVerification: result.ownershipVerification,
        buyerStructure: result.buyerStructure,
        websiteUrl: result.websiteUrl,
        cocktailMenuUrl: result.cocktailMenuUrl,
        localBrandsOnMenu: result.localBrandsOnMenu,
        googleRating: storage.googleRating,
        googleReviewCount: storage.googleReviewCount,
        yelpRating: storage.yelpRating,
        yelpReviewCount: storage.yelpReviewCount,
        isNationalChain: result.isNationalChain,
        researchConfidence: result.confidence,
        notes: result.notes,
        sourceUrls: storage.sourceUrls,
        completedAt: job.completedAt ?? appliedAt,
        researcher: `Reviewed automated pilot by ${reviewedByUserId}`,
        lastAttemptedAt: job.completedAt ?? appliedAt,
        lastRefreshedAt: appliedAt,
        refreshStatus: 'COMPLETE',
        refreshError: null,
        researchModel: job.pilot.model,
        researchResponseId: job.responseId,
        identitySnapshot: createResearchIdentitySnapshot({
          name: input.accountName,
          address: input.address,
          city: input.city,
          state: input.state,
          zip: input.zip,
        }, result),
      },
    });
    await tx.accountResearchJob.update({
      where: { id: job.id },
      data: { status: AccountResearchJobStatus.APPROVED, reviewedAt: new Date(), reviewedByUserId, reviewNote: reviewNote?.trim() || null },
    });
  }, { timeout: 180_000 });
  await refreshTenantOpportunityScoresForAccounts({ db, asOfDate: appliedAt, accountIds: [job.wholesaleAccountId] });
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
    where: { organizationId, startedByUserId: { not: ACCOUNT_RESEARCH_AUTOMATIC_RUN_ACTOR } },
    orderBy: { startedAt: 'desc' },
    include: {
      jobs: {
        orderBy: { priority: 'asc' },
        include: { wholesaleAccount: { select: { name: true, licenseeId: true, address: true, city: true, state: true, zip: true } } },
      },
    },
  });
}
