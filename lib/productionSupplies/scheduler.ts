import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { getAppEnvironment } from '../appEnvironment';
import { prisma } from '../prisma';
import { nextSupplyFreshMailSlot, SUPPLY_FRESH_MAIL_MS, SUPPLY_POLL_MINUTES, supplyJobsEnabled } from './config';
import { runSupplyJobs } from './jobs';

export const SUPPLY_SCHEDULER_STATE = 'SUPPLY_SCHEDULER_STATE';
export const SUPPLY_POLL_MS = SUPPLY_POLL_MINUTES * 60_000;
export const SUPPLY_WORK_LEASE_MS = 330_000; // Longer than the platform's 300s step ceiling.
const GRACE_MS = 5 * 60_000;
const stateInput = z.object({
  version: z.literal(1), generation: z.string(), runId: z.string(), deployment: z.string(),
  heartbeatAt: z.string().datetime(), nextDueAt: z.string().datetime(), nextRegularAt: z.string().datetime(),
  leaseUntil: z.string().datetime(), workUntil: z.string().datetime().nullable(),
  status: z.enum(['STARTING', 'RUNNING', 'SLEEPING', 'CONTROL_UNAVAILABLE', 'STOPPED']),
  completedBatches: z.number().int().nonnegative(), failedBatches: z.number().int().nonnegative(),
  pollIntervalMs: z.number().int().positive().optional(),
  nextFullAt: z.string().datetime().optional(),
  lastResult: z.object({ mailboxChecks: z.number(), mailboxErrors: z.number(), evidenceReplays: z.number(), replayErrors: z.number(), continuation: z.boolean(), backfillIncomplete: z.boolean(),earliestMailboxNextAt:z.string().datetime().nullable().optional() }).nullable(),
});
export type SupplySchedulerState = z.infer<typeof stateInput>;
type Owner = { organizationId: string; generation: string; runId: string };
type Launch = (organizationId: string, generation: string) => Promise<string>;
type Control = 'current' | 'superseded' | 'disabled' | 'unavailable';
type Services = {
  now?: () => number; env?: NodeJS.ProcessEnv; launch?: Launch;
  jobs?: typeof runSupplyJobs; control?: (owner: Owner) => Promise<Control>; runStatus?: (runId: string) => Promise<string>;
};
type Tick = { continue: boolean; nextAt?: string; reason?: string };
export type EnsuredSupplyScheduler = { organizationId: string; status: 'disabled' | 'superseded' | 'healthy' | 'started'; generation?: string; runId?: string; nextAt?: string };
const stateId = (organizationId: string) => `supply-scheduler:${organizationId}`;
const enrolled = (organizationId?: string): Prisma.OrganizationWhereInput => ({ ...(organizationId ? { id: organizationId } : {}), active: true, accountStatus: { notIn: ['SUSPENDED', 'CANCELLED'] }, features: { some: { featureKey: 'PRODUCTION_SUPPLIES', enabled: true } } });
const iso = (time: number) => new Date(time).toISOString();
const fingerprint = (env: NodeJS.ProcessEnv) => env.VERCEL_DEPLOYMENT_ID || env.VERCEL_URL || `local:${getAppEnvironment(env)}`;
const enabled = (env: NodeJS.ProcessEnv) => supplyJobsEnabled(env) && (env.VERCEL !== '1' || env.VERCEL_ENV === 'production' && getAppEnvironment(env) !== 'development');
const owns = (state: SupplySchedulerState | null, owner: Owner) => state?.generation === owner.generation && state.runId === owner.runId && state.status !== 'STOPPED';
const parse = (detail: unknown): SupplySchedulerState | null => {
  const result = stateInput.safeParse(detail);
  if (!result.success) return null;
  const state = result.data;
  if (state.nextFullAt) return state;
  if (state.pollIntervalMs === SUPPLY_POLL_MS) return state;
  // Upgrade old 15-minute anchors before either takeover or a replayed tick.
  // Checkpoints and failure/backfill debt remain intact until the next slot.
  const alreadyRan = state.completedBatches > 0 || state.failedBatches > 0 || state.status === 'RUNNING' || state.workUntil !== null;
  const regular = Math.max(Date.parse(state.nextRegularAt), alreadyRan ? Date.parse(state.heartbeatAt) + SUPPLY_POLL_MS : Date.parse(state.nextDueAt));
  const due = Math.max(regular, Date.parse(state.nextDueAt));
  return { ...state, pollIntervalMs: SUPPLY_POLL_MS, nextRegularAt: iso(regular), nextDueAt: iso(due), leaseUntil: iso(Math.max(Date.parse(state.leaseUntil), due + GRACE_MS)) };
};
const json = (state: SupplySchedulerState) => state as unknown as Prisma.InputJsonValue;

async function locked<T>(db: PrismaClient, organizationId: string, operation: (tx: Prisma.TransactionClient, state: SupplySchedulerState | null) => Promise<T>) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`supply-scheduler:${organizationId}`},0))`;
    const row = await tx.supplyAudit.findFirst({ where: { id: stateId(organizationId), organizationId, action: SUPPLY_SCHEDULER_STATE }, select: { detail: true } });
    return operation(tx, parse(row?.detail));
  }, { timeout: 30_000, maxWait: 5_000 });
}
async function save(tx: Prisma.TransactionClient, organizationId: string, state: SupplySchedulerState) {
  // This reserved operational checkpoint is mutable; business audit records remain append-only.
  await tx.supplyAudit.upsert({ where: { id: stateId(organizationId) },
    create: { id: stateId(organizationId), organizationId, action: SUPPLY_SCHEDULER_STATE, detail: json(state) }, update: { detail: json(state) } });
}
async function launch(organizationId: string, generation: string): Promise<string> {
  const [{ start }, { productionSupplySchedulerWorkflow }] = await Promise.all([import('workflow/api'), import('./workflow')]);
  return (await start(productionSupplySchedulerWorkflow, [organizationId, generation], { deploymentId: 'latest' })).runId;
}
async function runStatus(runId: string): Promise<string> {
  const { getRun } = await import('workflow/api');
  return getRun(runId).status;
}

async function ensureOne(organizationId: string, db: PrismaClient, services: Services, previous?: Owner): Promise<EnsuredSupplyScheduler> {
  const now = (services.now ?? Date.now)(), env = services.env ?? process.env;
  return locked(db, organizationId, async (tx, state) => {
    if (!await tx.organization.findFirst({ where: enrolled(organizationId), select: { id: true } })) return { organizationId, status: 'disabled' as const };
    if (previous && !owns(state, previous)) return { organizationId, status: 'superseded' as const };
    const deployment = fingerprint(env);
    if (!previous && state && state.status !== 'STOPPED' && Date.parse(state.leaseUntil) > now && state.deployment === deployment) {
      // Recover a terminal run even before its heartbeat expires. An observation
      // outage is not evidence that the old run stopped, so it cannot split ownership.
      const runtimeStatus = await (services.runStatus ?? runStatus)(state.runId).catch(() => 'unknown');
      if (!['failed', 'cancelled', 'completed'].includes(runtimeStatus)) return { organizationId, status: 'healthy' as const, generation: state.generation, runId: state.runId, nextAt: state.nextDueAt };
    }
    const generation = randomUUID();
    // A replaced invocation may still be finishing provider work. Never overlap its lease.
    // Its claimed batch also consumes the current polling slot even if its
    // completion is fenced, so deployment recovery cannot repeat it early.
    const regular = state?.status === 'RUNNING' ? Math.max(Date.parse(state.nextRegularAt), Date.parse(state.heartbeatAt) + SUPPLY_POLL_MS) : state ? Date.parse(state.nextRegularAt) : now;
    const due = Math.max(now, regular, state ? Date.parse(state.nextDueAt) : now, state?.workUntil ? Date.parse(state.workUntil) : now);
    const runId = await (services.launch ?? launch)(organizationId, generation);
    await save(tx, organizationId, { version: 1, generation, runId, deployment,
      heartbeatAt: iso(now), nextDueAt: iso(due), pollIntervalMs: SUPPLY_POLL_MS,
      nextRegularAt: iso(regular), leaseUntil: iso(due + GRACE_MS),
      workUntil: state?.workUntil && Date.parse(state.workUntil) > now ? state.workUntil : null,
      status: 'STARTING', completedBatches: state?.completedBatches ?? 0, failedBatches: state?.failedBatches ?? 0, lastResult: state?.lastResult ?? null });
    return { organizationId, status: 'started' as const, generation, runId, nextAt: iso(due) };
  });
}

/** Watchdogs and manual requests only ensure ownership; they never run provider work. */
export async function ensureSupplySchedulers(db: PrismaClient = prisma, services: Services = {}, organizationId?: string) {
  if (!enabled(services.env ?? process.env)) return { environmentDisabled: true as const, schedulers: [], errors: 0 };
  const organizations = await db.organization.findMany({ where: enrolled(organizationId), select: { id: true }, orderBy: { id: 'asc' }, take: 50 });
  const schedulers: Array<Awaited<ReturnType<typeof ensureOne>>> = [];
  let errors = 0;
  for (const organization of organizations) {
    try { schedulers.push(await ensureOne(organization.id, db, services)); }
    catch { errors++; }
  }
  return { schedulers, errors };
}

/** Cron runs one bounded batch with the same fencing used by older Workflow runs. */
export async function runSupplyCronBatches(db: PrismaClient = prisma, services: Services = {}) {
  const env = services.env ?? process.env;
  if (!enabled(env)) return { environmentDisabled: true as const, batches: [], errors: 0 };
  const clock = services.now ?? Date.now;
  const organizations = await db.organization.findMany({ where: enrolled(), select: { id: true }, orderBy: { id: 'asc' }, take: 50 });
  const results = await Promise.allSettled(organizations.map(async ({ id: organizationId }) => {
    const claim = await locked(db, organizationId, async (tx, state) => {
      const now = clock();
      if (!await tx.organization.findFirst({ where: enrolled(organizationId), select: { id: true } })) return null;
      if (state?.workUntil && Date.parse(state.workUntil) > now) return null;
      if (state?.nextFullAt && Date.parse(state.nextDueAt) > now) return null;
      const legacyFullAt = state?.status === 'RUNNING'
        ? Math.max(Date.parse(state.nextRegularAt), Date.parse(state.heartbeatAt) + SUPPLY_POLL_MS)
        : state ? Date.parse(state.nextRegularAt) : now;
      const fullAt = state?.nextFullAt ? Date.parse(state.nextFullAt) : legacyFullAt;
      const full = fullAt <= now;
      const due = nextSupplyFreshMailSlot(now);
      const runId = `cron:${randomUUID()}`;
      const owner = { organizationId, generation: runId, runId };
      if (!state?.nextFullAt) {
        // Make legacy six-hour mailbox deadlines eligible without shortening provider backoff.
        await tx.supplyMailboxSync.updateMany({
          where: { organizationId, connectionId: { not: null }, status: { in: ['CONNECTED', 'INITIAL_IMPORT', 'PROCESSING'] },
            nextSyncAt: { gt: new Date(now) }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date(now) } }] },
          data: { nextSyncAt: new Date(now) },
        });
      }
      await save(tx, organizationId, {
        version: 1, generation: owner.generation, runId, deployment: fingerprint(env),
        heartbeatAt: iso(now), nextDueAt: iso(due), nextRegularAt: iso(due),
        nextFullAt: iso(full ? now + SUPPLY_POLL_MS : fullAt),
        leaseUntil: iso(now + SUPPLY_WORK_LEASE_MS + GRACE_MS), workUntil: iso(now + SUPPLY_WORK_LEASE_MS),
        pollIntervalMs: SUPPLY_FRESH_MAIL_MS,
        status: 'RUNNING', completedBatches: state?.completedBatches ?? 0, failedBatches: state?.failedBatches ?? 0, lastResult: state?.lastResult ?? null,
      });
      return { owner, full };
    });
    if (!claim) return { organizationId, status: 'not-due' as const };
    let result: Awaited<ReturnType<typeof runSupplyJobs>> | null = null;
    try { result = await (services.jobs ?? runSupplyJobs)(db, { organizationId, fastMail: true, recentMailOnly: !claim.full }); }
    catch { /* Provider details stay out of cron responses and checkpoints. */ }
    const failed = !result || result.mailboxErrors > 0 || result.replayErrors > 0;
    await locked(db, organizationId, async (tx, state) => {
      if (!state || !owns(state, claim.owner)) return;
      await save(tx, organizationId, {
        ...state, status: 'SLEEPING', heartbeatAt: iso(clock()), workUntil: null,
        leaseUntil: iso(Date.parse(state.nextDueAt) + GRACE_MS),
        completedBatches: state.completedBatches + Number(Boolean(result)), failedBatches: state.failedBatches + Number(failed),
        lastResult: result ? {
          mailboxChecks: result.mailboxChecks, mailboxErrors: result.mailboxErrors,
          evidenceReplays: result.evidenceReplays, replayErrors: result.replayErrors, continuation: result.continuation,
          backfillIncomplete: result.backfillIncomplete, earliestMailboxNextAt: result.earliestMailboxNextAt,
        } : null,
      });
    });
    return { organizationId, status: failed ? 'failed' as const : 'completed' as const, mode: claim.full ? 'full' as const : 'recent' as const };
  }));
  const batches = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  return { batches, errors: results.length - batches.length + batches.filter(batch => batch.status === 'failed').length };
}

/** Only fixed canonical destinations can receive the existing job credential. */
export function supplySchedulerOrigin(env: NodeJS.ProcessEnv = process.env) {
  if (env.VERCEL !== '1' || env.VERCEL_ENV !== 'production') return null;
  const environment = getAppEnvironment(env);
  return environment === 'production' ? 'https://crm.echospirits.com' : environment === 'test' ? 'https://neat-tst.vercel.app' : null;
}
async function latestControl(owner: Owner, env: NodeJS.ProcessEnv): Promise<Control> {
  const origin = supplySchedulerOrigin(env);
  if (!origin) return env.VERCEL === '1' ? 'disabled' : 'current';
  const secret = env.SUPPLY_JOB_SECRET || env.CRON_SECRET;
  if (!secret) return 'disabled';
  try {
    const response = await fetch(`${origin}/api/cron/production-supplies?organizationId=${encodeURIComponent(owner.organizationId)}`, {
      headers: { authorization: `Bearer ${secret}`, ...(env.SUPPLY_JOB_VERCEL_BYPASS ? { 'x-vercel-protection-bypass': env.SUPPLY_JOB_VERCEL_BYPASS } : {}) },
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return 'unavailable';
    const result: unknown = await response.json();
    const parsed = z.object({ environmentDisabled: z.boolean().optional(), schedulers: z.array(z.object({ organizationId: z.string(), generation: z.string().optional(), runId: z.string().optional() })).optional() }).safeParse(result);
    if (!parsed.success) return 'unavailable';
    if (parsed.data.environmentDisabled) return 'disabled';
    const current = parsed.data.schedulers?.find(row => row.organizationId === owner.organizationId);
    return current?.generation === owner.generation && current.runId === owner.runId ? 'current' : 'superseded';
  } catch { return 'unavailable'; }
}

/** One bounded, lease-fenced batch. Workflow sleep owns all waiting between batches. */
export async function runSupplySchedulerTick(owner: Owner, db: PrismaClient = prisma, services: Services = {}): Promise<Tick> {
  const env = services.env ?? process.env, clock = services.now ?? Date.now;
  if (!enabled(env)) return { continue: false, reason: 'environment-disabled' };
  // Probe before acquiring the database lease: the latest endpoint takes the same lock.
  const control = await (services.control ?? (input => latestControl(input, env)))(owner);
  if (control === 'disabled' || control === 'superseded') return { continue: false, reason: control };
  const claim = await locked(db, owner.organizationId, async (tx, state) => {
    if (!owns(state, owner) || !await tx.organization.findFirst({ where: enrolled(owner.organizationId), select: { id: true } })) return { stop: true as const };
    const now = clock(), checkpoint = state!;
    const due = Math.max(Date.parse(checkpoint.nextDueAt), checkpoint.workUntil ? Date.parse(checkpoint.workUntil) : 0);
    if (due > now) return { wait: iso(due) };
    if (control === 'unavailable') {
      checkpoint.nextDueAt = iso(now + SUPPLY_POLL_MS); checkpoint.nextRegularAt = checkpoint.nextDueAt;
      checkpoint.leaseUntil = iso(now + SUPPLY_POLL_MS + GRACE_MS); checkpoint.status = 'CONTROL_UNAVAILABLE';
      checkpoint.heartbeatAt = iso(now); checkpoint.failedBatches++; checkpoint.lastResult = null;
      await save(tx, owner.organizationId, checkpoint);
      return { wait: checkpoint.nextDueAt };
    }
    checkpoint.status = 'RUNNING'; checkpoint.heartbeatAt = iso(now); checkpoint.workUntil = iso(now + SUPPLY_WORK_LEASE_MS);
    // Reserve the next slot before provider work. A crashed invocation can be
    // replayed after its work lease expires without repeating this slot.
    checkpoint.nextDueAt = iso(now + SUPPLY_POLL_MS);
    checkpoint.leaseUntil = iso(now + SUPPLY_WORK_LEASE_MS + GRACE_MS); checkpoint.deployment = fingerprint(env);
    await save(tx, owner.organizationId, checkpoint);
    return { claimed: true as const };
  });
  if ('stop' in claim) return { continue: false, reason: 'ownership-or-entitlement-changed' };
  if ('wait' in claim) return { continue: true, nextAt: claim.wait };
  let result: Awaited<ReturnType<typeof runSupplyJobs>> | null = null;
  try { result = await (services.jobs ?? runSupplyJobs)(db, { organizationId: owner.organizationId }); }
  catch { /* Persist a bounded retry without serializing provider errors or correspondence. */ }
  return locked(db, owner.organizationId, async (tx, state) => {
    if (!owns(state, owner)) return { continue: false, reason: 'superseded' };
    const now = clock(), checkpoint = state!;
    // Count from completion so mailbox scans started during this batch are due
    // by the next tick, rather than missing an earlier fixed anchor by seconds.
    const regular = now + SUPPLY_POLL_MS;
    const failed = !result || result.mailboxErrors > 0 || result.replayErrors > 0;
    // Partial pages, provider backoff and failures retain their own checkpoints.
    // All automatic work resumes at the next six-hour slot rather than polling
    // early for catch-up or retries; per-mailbox leases/backoff still apply.
    checkpoint.nextRegularAt = iso(regular); checkpoint.nextDueAt = iso(regular); checkpoint.heartbeatAt = iso(now);
    checkpoint.leaseUntil = iso(regular + GRACE_MS); checkpoint.workUntil = null; checkpoint.status = 'SLEEPING';
    checkpoint.completedBatches += result ? 1 : 0; checkpoint.failedBatches += failed ? 1 : 0;
    checkpoint.lastResult = result ? { mailboxChecks: result.mailboxChecks, mailboxErrors: result.mailboxErrors, evidenceReplays: result.evidenceReplays, replayErrors: result.replayErrors, continuation: result.continuation, backfillIncomplete: result.backfillIncomplete,earliestMailboxNextAt:result.earliestMailboxNextAt ?? null } : null;
    await save(tx, owner.organizationId, checkpoint);
    return { continue: true, nextAt: checkpoint.nextDueAt };
  });
}

export async function rollSupplyScheduler(owner: Owner, db: PrismaClient = prisma, services: Services = {}): Promise<EnsuredSupplyScheduler | { status: 'disabled' }> {
  if (!enabled(services.env ?? process.env)) return { status: 'disabled' as const };
  return ensureOne(owner.organizationId, db, services, owner);
}
