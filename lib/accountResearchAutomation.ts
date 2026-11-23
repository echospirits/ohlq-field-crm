import { AccountResearchJobStatus, AccountResearchPilotStatus, AccountResearchTier, Prisma, type PrismaClient } from '@prisma/client';
import { getPrioritizedAccountResearchQueue } from './accountResearchQueue';
import {
  ACCOUNT_RESEARCH_AUTOMATIC_DAILY_BUDGET_MICROS,
  ACCOUNT_RESEARCH_AUTOMATIC_DAILY_LIMIT,
  ACCOUNT_RESEARCH_AUTOMATIC_RUN_ACTOR,
  ACCOUNT_RESEARCH_JOB_RESERVE_MICROS,
  ACCOUNT_RESEARCH_PILOT_MODEL,
  ACCOUNT_RESEARCH_PRICING,
  ACCOUNT_RESEARCH_SUBMISSION_WAVE_SIZE,
  chooseResearchTier,
  type AccountResearchInputSnapshot,
} from './accountResearchPilot';
import { assertAccountResearchAutomationEnabled } from './accountResearchOpenAI';
import { ACCOUNT_RESEARCH_ACTIONABLE_REVIEW_PREFIX } from './accountResearchFailures';
import { pollAccountResearchPilot, refreshPilotStatus, submitQueuedPilotJobs } from './accountResearchPilotService';
import { prisma } from './prisma';
import { ECHO_ORGANIZATION_ID } from './echoAccess';

const ACTIVE_RUN_STATUSES: AccountResearchPilotStatus[] = [AccountResearchPilotStatus.RUNNING, AccountResearchPilotStatus.PAUSED, AccountResearchPilotStatus.READY_FOR_REVIEW];
const ACTIVE_JOB_STATUSES: AccountResearchJobStatus[] = [AccountResearchJobStatus.SUBMITTED, AccountResearchJobStatus.RUNNING, AccountResearchJobStatus.NEEDS_REVIEW];
const OUTSTANDING_JOB_STATUSES = [AccountResearchJobStatus.QUEUED, ...ACTIVE_JOB_STATUSES];
const activePilotWhere: Prisma.AccountResearchPilotWhereInput = {
  organizationId: ECHO_ORGANIZATION_ID,
  organization: { active: true, accountStatus: { notIn: ['SUSPENDED', 'CANCELLED'] } },
  startedByUserId: ACCOUNT_RESEARCH_AUTOMATIC_RUN_ACTOR,
  status: { in: ACTIVE_RUN_STATUSES },
};
const pilotIdentity = { id: true, organizationId: true } as const;

const startOfUtcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export async function getAutomaticAccountResearchStatus({ db = prisma, now = new Date() }: { db?: PrismaClient; now?: Date } = {}) {
  const today = startOfUtcDay(now);
  const automaticJobs = { organizationId: ECHO_ORGANIZATION_ID, pilot: { organizationId: ECHO_ORGANIZATION_ID, startedByUserId: ACCOUNT_RESEARCH_AUTOMATIC_RUN_ACTOR } };
  const [queue, submittedToday, uniqueAccountRowsToday, todayStatusCounts, allTimeStatusCounts, actionableFailuresToday, actionableFailuresAllTime, outstandingJobs, latestRun] = await Promise.all([
    getPrioritizedAccountResearchQueue({ db, now, limit: null, organizationId: ECHO_ORGANIZATION_ID }),
    db.accountResearchJob.count({
      where: { submittedAt: { gte: today }, ...automaticJobs },
    }),
    db.accountResearchJob.findMany({
      where: { submittedAt: { gte: today }, ...automaticJobs },
      distinct: ['wholesaleAccountId'],
      select: { wholesaleAccountId: true },
    }),
    db.accountResearchJob.groupBy({ by: ['status'], where: { submittedAt: { gte: today }, ...automaticJobs }, _count: { _all: true } }),
    db.accountResearchJob.groupBy({ by: ['status'], where: automaticJobs, _count: { _all: true } }),
    db.accountResearchJob.count({
      where: { submittedAt: { gte: today }, status: AccountResearchJobStatus.REJECTED, reviewNote: { startsWith: ACCOUNT_RESEARCH_ACTIONABLE_REVIEW_PREFIX }, ...automaticJobs },
    }),
    db.accountResearchJob.count({
      where: { status: AccountResearchJobStatus.REJECTED, reviewNote: { startsWith: ACCOUNT_RESEARCH_ACTIONABLE_REVIEW_PREFIX }, ...automaticJobs },
    }),
    db.accountResearchJob.count({
      where: { status: { in: OUTSTANDING_JOB_STATUSES }, ...automaticJobs },
    }),
    db.accountResearchPilot.findFirst({
      where: { organizationId: ECHO_ORGANIZATION_ID, startedByUserId: ACCOUNT_RESEARCH_AUTOMATIC_RUN_ACTOR },
      orderBy: { startedAt: 'desc' },
      select: { id: true, status: true, startedAt: true, completedAt: true, estimatedSpendMicros: true, maxAccounts: true },
    }),
  ]);
  const byPriority = new Map<number, number>();
  for (const item of queue) byPriority.set(item.priorityBucket, (byPriority.get(item.priorityBucket) ?? 0) + 1);
  const todayCounts = Object.fromEntries(todayStatusCounts.map((item) => [item.status, item._count._all])) as Partial<Record<AccountResearchJobStatus, number>>;
  const allTimeCounts = Object.fromEntries(allTimeStatusCounts.map((item) => [item.status, item._count._all])) as Partial<Record<AccountResearchJobStatus, number>>;
  return {
    queueCount: queue.length + outstandingJobs,
    unassignedQueueCount: queue.length,
    outstandingJobs,
    byPriority: Object.fromEntries(byPriority),
    submittedToday,
    uniqueAccountsSubmittedToday: uniqueAccountRowsToday.length,
    approvedToday: todayCounts.APPROVED ?? 0,
    failedToday: actionableFailuresToday,
    unsuccessfulToday: (todayCounts.FAILED ?? 0) + (todayCounts.BLOCKED_BUDGET ?? 0),
    rejectedToday: Math.max(0, (todayCounts.REJECTED ?? 0) - actionableFailuresToday),
    failedAttempts: actionableFailuresAllTime,
    unsuccessfulAttempts: (allTimeCounts.FAILED ?? 0) + (allTimeCounts.BLOCKED_BUDGET ?? 0),
    rejectedAttempts: Math.max(0, (allTimeCounts.REJECTED ?? 0) - actionableFailuresAllTime),
    latestRun,
  };
}

async function createAutomaticRun({ db, now, maxAccounts }: { db: Prisma.TransactionClient; now: Date; maxAccounts: number }) {
  const organization = await db.organization.findFirst({ where: { id: ECHO_ORGANIZATION_ID, active: true, accountStatus: { notIn: ['SUSPENDED', 'CANCELLED'] } }, select: { id: true } });
  if (organization?.id !== ECHO_ORGANIZATION_ID) throw new Error('Automatic account research requires active Echo ownership.');
  const candidates = await getPrioritizedAccountResearchQueue({ db, now, limit: maxAccounts, organizationId: ECHO_ORGANIZATION_ID });
  if (candidates.length === 0) return null;
  const reservedMicros = candidates.length * ACCOUNT_RESEARCH_JOB_RESERVE_MICROS;
  if (reservedMicros > ACCOUNT_RESEARCH_AUTOMATIC_DAILY_BUDGET_MICROS) throw new Error('Automatic research reservation exceeds the daily spending ceiling.');
  return db.accountResearchPilot.create({
    data: {
      organizationId: organization.id,
      status: AccountResearchPilotStatus.RUNNING,
      model: ACCOUNT_RESEARCH_PILOT_MODEL,
      maxAccounts: candidates.length,
      budgetLimitMicros: ACCOUNT_RESEARCH_AUTOMATIC_DAILY_BUDGET_MICROS,
      reservedMicros,
      estimatedSpendMicros: 0,
      pricingSnapshot: ACCOUNT_RESEARCH_PRICING,
      startedByUserId: ACCOUNT_RESEARCH_AUTOMATIC_RUN_ACTOR,
      jobs: {
        create: candidates.map((candidate, index) => {
          const tier = chooseResearchTier(candidate.opportunities).tier;
          const input: AccountResearchInputSnapshot = {
            wholesaleAccountId: candidate.id,
            licenseeId: candidate.licenseeId,
            accountName: candidate.name,
            address: candidate.address,
            city: candidate.city,
            state: candidate.state,
            zip: candidate.zip,
          };
          return {
            organizationId: organization.id,
            wholesaleAccountId: candidate.id,
            tier: tier === 'DEEP' ? AccountResearchTier.DEEP : AccountResearchTier.LIGHTWEIGHT,
            status: AccountResearchJobStatus.QUEUED,
            priority: index + 1,
            reason: candidate.researchReason,
            inputSnapshot: input as unknown as Prisma.InputJsonValue,
            reservedMicros: ACCOUNT_RESEARCH_JOB_RESERVE_MICROS,
          };
        }),
      },
    },
    select: pilotIdentity,
  });
}

export async function runAutomaticAccountResearch({
  db = prisma,
  now = new Date(),
  pilotId,
  submissionTake = ACCOUNT_RESEARCH_SUBMISSION_WAVE_SIZE,
  remainingRunCapacity = ACCOUNT_RESEARCH_AUTOMATIC_DAILY_LIMIT,
}: {
  db?: PrismaClient;
  now?: Date;
  pilotId?: string;
  submissionTake?: number;
  remainingRunCapacity?: number;
} = {}) {
  assertAccountResearchAutomationEnabled();
  const capacity = Math.max(0, Math.min(ACCOUNT_RESEARCH_AUTOMATIC_DAILY_LIMIT, remainingRunCapacity));
  let run = await db.accountResearchPilot.findFirst({
    where: { ...activePilotWhere, id: pilotId },
    orderBy: { startedAt: 'asc' },
    select: pilotIdentity,
  });
  if (!run && !pilotId && capacity > 0) {
    run = await db.$transaction(async tx => {
      // Serialize select-or-create across scheduled and operator-triggered runs.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`account-research:${ECHO_ORGANIZATION_ID}`}, 0))`;
      const existing = await tx.accountResearchPilot.findFirst({ where: activePilotWhere, orderBy: { startedAt: 'asc' }, select: pilotIdentity });
      return existing ?? createAutomaticRun({ db: tx, now, maxAccounts: capacity });
    }, { timeout: 30_000 });
  }
  if (!run || run.organizationId !== ECHO_ORGANIZATION_ID) {
    return { pilotId: pilotId ?? null, submitted: 0, attempted: 0, outstandingJobs: 0, reconciliationRequired: 0, paused: false };
  }

  const target = { pilotId: run.id, organizationId: run.organizationId };
  const poll = await pollAccountResearchPilot({ ...target, db, mode: 'automatic' });
  const current = await db.accountResearchPilot.findFirst({ where: { ...activePilotWhere, id: run.id }, select: { status: true } });
  const submit = current && current.status !== AccountResearchPilotStatus.READY_FOR_REVIEW && !poll.paused && capacity > 0
    ? await submitQueuedPilotJobs({ ...target, db, mode: 'automatic', take: Math.min(capacity, submissionTake) })
    : null;
  const outstandingJobs = await db.accountResearchJob.count({ where: { ...target, status: { in: OUTSTANDING_JOB_STATUSES } } });
  if (submit && outstandingJobs === 0) await refreshPilotStatus({ ...target, db });
  return {
    pilotId: run.id,
    submitted: submit?.submitted ?? 0,
    attempted: (submit?.submitted ?? 0) + (submit?.failed ?? 0),
    outstandingJobs,
    reconciliationRequired: poll.reconciliationRequired + (submit?.reconciliationRequired ?? 0),
    paused: poll.paused || Boolean(submit?.paused) || current?.status === AccountResearchPilotStatus.READY_FOR_REVIEW,
  };
}
