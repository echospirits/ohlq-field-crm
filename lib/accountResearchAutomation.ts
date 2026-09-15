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
import { pollAccountResearchPilot, submitQueuedPilotJobs } from './accountResearchPilotService';
import { prisma } from './prisma';

const ACTIVE_RUN_STATUSES: AccountResearchPilotStatus[] = [AccountResearchPilotStatus.RUNNING, AccountResearchPilotStatus.PAUSED, AccountResearchPilotStatus.READY_FOR_REVIEW];
const ACTIVE_JOB_STATUSES: AccountResearchJobStatus[] = [AccountResearchJobStatus.SUBMITTED, AccountResearchJobStatus.RUNNING, AccountResearchJobStatus.NEEDS_REVIEW];

const startOfUtcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export async function getAutomaticAccountResearchStatus({ db = prisma, now = new Date() }: { db?: PrismaClient; now?: Date } = {}) {
  const [queue, submittedToday, outstandingJobs, latestRun] = await Promise.all([
    getPrioritizedAccountResearchQueue({ db, now, limit: null }),
    db.accountResearchJob.count({
      where: { submittedAt: { gte: startOfUtcDay(now) }, pilot: { startedByUserId: ACCOUNT_RESEARCH_AUTOMATIC_RUN_ACTOR } },
    }),
    db.accountResearchJob.count({
      where: { status: { in: [AccountResearchJobStatus.QUEUED, ...ACTIVE_JOB_STATUSES] }, pilot: { startedByUserId: ACCOUNT_RESEARCH_AUTOMATIC_RUN_ACTOR } },
    }),
    db.accountResearchPilot.findFirst({
      where: { startedByUserId: ACCOUNT_RESEARCH_AUTOMATIC_RUN_ACTOR },
      orderBy: { startedAt: 'desc' },
      select: { id: true, status: true, startedAt: true, completedAt: true, estimatedSpendMicros: true, maxAccounts: true },
    }),
  ]);
  const byPriority = new Map<number, number>();
  for (const item of queue) byPriority.set(item.priorityBucket, (byPriority.get(item.priorityBucket) ?? 0) + 1);
  return { queueCount: queue.length + outstandingJobs, unassignedQueueCount: queue.length, outstandingJobs, byPriority: Object.fromEntries(byPriority), submittedToday, latestRun };
}

async function createAutomaticRun({ db, now, maxAccounts }: { db: PrismaClient; now: Date; maxAccounts: number }) {
  const organization = await db.organization.findFirst({ where: { active: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!organization) throw new Error('Automatic account research requires at least one active organization for run ownership.');
  const candidates = await getPrioritizedAccountResearchQueue({ db, now, limit: maxAccounts });
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
    select: { id: true, organizationId: true },
  });
}

export async function runAutomaticAccountResearch({
  db = prisma,
  now = new Date(),
  submissionTake = ACCOUNT_RESEARCH_SUBMISSION_WAVE_SIZE,
  remainingRunCapacity = ACCOUNT_RESEARCH_AUTOMATIC_DAILY_LIMIT,
}: {
  db?: PrismaClient;
  now?: Date;
  submissionTake?: number;
  remainingRunCapacity?: number;
} = {}) {
  assertAccountResearchAutomationEnabled();
  let remainingCapacity = Math.max(0, Math.min(ACCOUNT_RESEARCH_AUTOMATIC_DAILY_LIMIT, remainingRunCapacity));
  let run = await db.accountResearchPilot.findFirst({
    where: { startedByUserId: ACCOUNT_RESEARCH_AUTOMATIC_RUN_ACTOR, status: { in: ACTIVE_RUN_STATUSES } },
    orderBy: { startedAt: 'asc' },
    select: { id: true, organizationId: true },
  });
  let poll = null;
  if (run) {
    poll = await pollAccountResearchPilot({ pilotId: run.id, organizationId: run.organizationId, db, mode: 'automatic' });
    const current = await db.accountResearchPilot.findUnique({ where: { id: run.id }, select: { status: true } });
    if (!current || !ACTIVE_RUN_STATUSES.includes(current.status)) run = null;
  }
  if (!run && remainingCapacity > 0) run = await createAutomaticRun({ db, now, maxAccounts: remainingCapacity });
  if (!run || remainingCapacity === 0) {
    const status = await getAutomaticAccountResearchStatus({ db, now });
    return { ...status, poll, submitted: 0, runLimitReached: remainingCapacity === 0 };
  }
  const activeJobs = await db.accountResearchJob.count({ where: { pilotId: run.id, status: { in: ACTIVE_JOB_STATUSES } } });
  const settledWaveThisPass = Boolean(poll && poll.checked > 0 && activeJobs === 0);
  let submission = { submitted: 0, failed: 0, paused: false, remaining: 0 };
  if (activeJobs === 0 && !settledWaveThisPass) {
    submission = await submitQueuedPilotJobs({
      pilotId: run.id,
      organizationId: run.organizationId,
      db,
      mode: 'automatic',
      take: Math.min(remainingCapacity, submissionTake),
    });
    remainingCapacity -= submission.submitted;
  }
  const status = await getAutomaticAccountResearchStatus({ db, now });
  return { ...status, poll, ...submission, coolingDown: settledWaveThisPass, runLimitReached: remainingCapacity === 0 };
}
