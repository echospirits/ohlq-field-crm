import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { getAppEnvironment } from '../appEnvironment';
import { prisma } from '../prisma';
import { supplyJobsEnabled } from './config';
import { runSupplyJobs } from './jobs';

export const SUPPLY_SCHEDULER_STATE = 'SUPPLY_SCHEDULER_STATE';
export const SUPPLY_POLL_MS = 15 * 60_000;
export const SUPPLY_CATCHUP_MS = 60_000;
export const SUPPLY_WORK_LEASE_MS = 330_000; // Longer than the platform's 300s step ceiling.
const GRACE_MS = 5 * 60_000;
const stateInput = z.object({
  version: z.literal(1), generation: z.string(), runId: z.string(), deployment: z.string(),
  heartbeatAt: z.string().datetime(), nextDueAt: z.string().datetime(), nextRegularAt: z.string().datetime(),
  leaseUntil: z.string().datetime(), workUntil: z.string().datetime().nullable(),
  status: z.enum(['STARTING', 'RUNNING', 'SLEEPING', 'CONTROL_UNAVAILABLE', 'STOPPED']),
  completedBatches: z.number().int().nonnegative(), failedBatches: z.number().int().nonnegative(),
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
const parse = (detail: unknown) => { const result = stateInput.safeParse(detail); return result.success ? result.data : null; };
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
    const due = Math.max(now, state?.workUntil ? Date.parse(state.workUntil) : now);
    const runId = await (services.launch ?? launch)(organizationId, generation);
    await save(tx, organizationId, { version: 1, generation, runId, deployment,
      heartbeatAt: iso(now), nextDueAt: iso(previous ? Math.max(due, Date.parse(state!.nextDueAt)) : due),
      nextRegularAt: state?.nextRegularAt ?? iso(due), leaseUntil: iso(Math.max(due, previous ? Date.parse(state!.nextDueAt) : due) + GRACE_MS),
      workUntil: state?.workUntil && Date.parse(state.workUntil) > now ? state.workUntil : null,
      status: 'STARTING', completedBatches: state?.completedBatches ?? 0, failedBatches: state?.failedBatches ?? 0, lastResult: state?.lastResult ?? null });
    return { organizationId, status: 'started' as const, generation, runId, nextAt: iso(due) };
  });
}

/** Daily watchdogs and manual requests only ensure ownership; they never run provider work. */
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
      checkpoint.nextDueAt = iso(now + GRACE_MS); checkpoint.leaseUntil = iso(now + 2 * GRACE_MS); checkpoint.status = 'CONTROL_UNAVAILABLE';
      checkpoint.heartbeatAt = iso(now); checkpoint.failedBatches++; checkpoint.lastResult = null;
      await save(tx, owner.organizationId, checkpoint);
      return { wait: checkpoint.nextDueAt };
    }
    checkpoint.status = 'RUNNING'; checkpoint.heartbeatAt = iso(now); checkpoint.workUntil = iso(now + SUPPLY_WORK_LEASE_MS);
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
    let regular = Date.parse(checkpoint.nextRegularAt);
    if (regular <= now) regular += (Math.floor((now - regular) / SUPPLY_POLL_MS) + 1) * SUPPLY_POLL_MS;
    const failed = !result || result.mailboxErrors > 0 || result.replayErrors > 0;
    const mailboxAt=result?.earliestMailboxNextAt?Date.parse(result.earliestMailboxNextAt):null;
    const mailboxWake=mailboxAt!==null && Number.isFinite(mailboxAt)?mailboxAt>now?mailboxAt:now+SUPPLY_CATCHUP_MS:Infinity;
    // Persisted mailbox due/backoff/lease is authoritative. Only work without a
    // concrete future due time needs the generic one-minute continuation retry.
    const catchup=result && !failed && (result.deferred || result.continuation && mailboxAt===null);
    const next = Math.min(regular,mailboxWake,failed ? now + GRACE_MS : catchup ? now + SUPPLY_CATCHUP_MS : regular);
    checkpoint.nextRegularAt = iso(regular); checkpoint.nextDueAt = iso(next); checkpoint.heartbeatAt = iso(now);
    checkpoint.leaseUntil = iso(next + GRACE_MS); checkpoint.workUntil = null; checkpoint.status = 'SLEEPING';
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
