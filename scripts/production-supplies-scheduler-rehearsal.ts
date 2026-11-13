import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { parseEnvironmentFile } from '../lib/environmentFile';
import type { runSupplyJobs } from '../lib/productionSupplies/jobs';
import type { SupplySchedulerState } from '../lib/productionSupplies/scheduler';

async function main() {
  const envFile = process.argv.find(argument => argument.startsWith('--env-file='))?.slice(11) || '.env.reconciliation.local';
  const environment = Object.fromEntries(parseEnvironmentFile(readFileSync(envFile, 'utf8')));
  const expected = 'ep-plain-lake-am56227f-pooler.c-5.us-east-1.aws.neon.tech';
  if (environment.APP_ENV !== 'development' || environment.DATABASE_ENVIRONMENT !== 'development' ||
      environment.DATABASE_TARGET_ID !== 'supplies-rehearsal' || environment.EXPECTED_DATABASE_HOST !== expected ||
      new URL(environment.DATABASE_URL).hostname !== expected) throw new Error('Rehearsal target guard failed.');
  for (const [key, value] of Object.entries(environment)) process.env[key] = value;
  for (const key of ['CALENDAR_SYNC_ENABLED', 'CRON_JOBS_ENABLED', 'EMAIL_SEND_ENABLED', 'FILE_UPLOADS_ENABLED', 'OHLQ_IMPORT_ENABLED', 'WEBHOOK_REGISTRATION_ENABLED', 'SUPPLY_JOBS_ENABLED', 'SUPPLY_MAIL_INGESTION_ENABLED', 'SUPPLY_TRACKING_LIVE_ENABLED']) process.env[key] = 'false';
  process.env.SUPPLY_TRACKING_MODE = 'disabled';
  delete process.env.VERCEL;
  const scheduler = await import('../lib/productionSupplies/scheduler');
  const db = new PrismaClient({ datasourceUrl: environment.DATABASE_URL });
  const organizationId = `org_scheduler_rehearsal_${randomUUID().replaceAll('-', '')}`;
  let clock = Date.now(), launches = 0, providerBatches = 0;
  const initial = clock;
  const checks: string[] = [], transitions: Array<Record<string, unknown>> = [];
  // Only the scheduler's injected test policy is enabled. Actual process effects
  // remain off; neither the real SDK launcher nor provider functions are invoked.
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'development', APP_ENV: 'development', SUPPLY_JOBS_ENABLED: 'true', VERCEL_DEPLOYMENT_ID: 'synthetic-deployment-one' };
  const result = (continuation = false) => ({ organizations: 1, mailboxChecks: 0, mailboxErrors: 0, tracking: [], evidenceReplays: 0, replayErrors: 0, deferred: false, continuation, backfillIncomplete: continuation });
  const services = { env, now: () => clock, control: async () => 'current' as const, runStatus: async () => 'running',
    launch: async (org: string) => { assert.equal(org, organizationId); return `synthetic-run-${++launches}`; },
    jobs: (async (_db, options) => { assert.equal(options?.organizationId, organizationId); providerBatches++; return result(); }) as typeof runSupplyJobs };
  async function state() {
    const row = await db.supplyAudit.findFirstOrThrow({ where: { id: `supply-scheduler:${organizationId}`, organizationId, action: scheduler.SUPPLY_SCHEDULER_STATE } });
    return row.detail as unknown as SupplySchedulerState;
  }
  async function owner() { const saved = await state(); return { organizationId, generation: saved.generation, runId: saved.runId }; }
  async function pass(label: string) {
    const saved = await state(); checks.push(label);
    transitions.push({ label, generation: saved.generation, runId: saved.runId, status: saved.status, nextDueAt: saved.nextDueAt, completedBatches: saved.completedBatches, failedBatches: saved.failedBatches });
    console.log(`PASS ${label}`);
  }
  try {
    await db.organization.create({ data: { id: organizationId, name: 'Synthetic scheduler rehearsal', displayName: 'Synthetic scheduler rehearsal', slug: organizationId, active: true, features: { create: { featureKey: 'PRODUCTION_SUPPLIES', enabled: true } } } });
    const concurrent = await Promise.all(Array.from({ length: 4 }, () => scheduler.ensureSupplySchedulers(db, services, organizationId)));
    assert.equal(launches, 1); assert.equal(concurrent.filter(item => item.schedulers[0]?.status === 'started').length, 1);
    assert.ok(concurrent.every(item => item.errors === 0));
    await pass('Four concurrent watchdogs persist one generation and one stub launch.');

    const first = await scheduler.runSupplySchedulerTick(await owner(), db, services);
    assert.equal(Date.parse(first.nextAt!), initial + scheduler.SUPPLY_POLL_MS);
    assert.equal((await state()).workUntil, null);
    await scheduler.runSupplySchedulerTick(await owner(), db, services); assert.equal(providerBatches, 1);
    await pass('A persisted completed batch waits for its 15-minute boundary; duplicate step does not repeat work.');

    clock = Date.parse(first.nextAt!);
    const partial = await scheduler.runSupplySchedulerTick(await owner(), db, { ...services, jobs: (async () => { providerBatches++; return result(true); }) as typeof runSupplyJobs });
    assert.equal(Date.parse(partial.nextAt!), clock + scheduler.SUPPLY_CATCHUP_MS);
    const regular = (await state()).nextRegularAt;
    clock = Date.parse(partial.nextAt!);
    const complete = await scheduler.runSupplySchedulerTick(await owner(), db, services);
    assert.equal(complete.nextAt, regular);
    await pass('One-minute catch-up persists separately from the unchanged regular poll boundary.');

    clock = Date.parse(complete.nextAt!);
    const old = await owner();
    let entered!: () => void, release!: () => void;
    const enteredGate = new Promise<void>(resolve => { entered = resolve; });
    const workGate = new Promise<void>(resolve => { release = resolve; });
    const running = scheduler.runSupplySchedulerTick(old, db, { ...services, jobs: (async () => { providerBatches++; entered(); await workGate; return result(); }) as typeof runSupplyJobs });
    await enteredGate;
    const inFlight = await state(); assert.equal(inFlight.status, 'RUNNING'); assert.ok(Date.parse(inFlight.workUntil!) > clock);
    const redeployed = { ...services, env: { ...env, VERCEL_DEPLOYMENT_ID: 'synthetic-deployment-two' } };
    assert.equal((await scheduler.ensureSupplySchedulers(db, redeployed, organizationId)).schedulers[0]?.status, 'started');
    const successor = await owner(); assert.notEqual(successor.generation, old.generation);
    const waits = await scheduler.runSupplySchedulerTick(successor, db, { ...redeployed, jobs: (async () => { assert.fail('Overlapped the prior work lease.'); }) as typeof runSupplyJobs });
    assert.equal(waits.nextAt, inFlight.workUntil);
    release(); assert.equal((await running).continue, false); assert.equal((await state()).generation, successor.generation);
    await pass('Deployment rotation fences an old completion and a successor waits for the in-flight database lease.');

    clock = Date.parse(inFlight.workUntil!);
    await scheduler.runSupplySchedulerTick(successor, db, redeployed);
    const obsolete = await owner(); clock = Date.parse((await state()).leaseUntil) + 1;
    assert.equal((await scheduler.ensureSupplySchedulers(db, redeployed, organizationId)).schedulers[0]?.status, 'started');
    assert.equal((await scheduler.runSupplySchedulerTick(obsolete, db, redeployed)).continue, false);
    await pass('An expired heartbeat is recoverable and its abandoned generation cannot run another batch.');

    const before = launches;
    const disabled = { ...redeployed, env: { ...env, SUPPLY_JOBS_ENABLED: 'false' } };
    assert.equal((await scheduler.ensureSupplySchedulers(db, disabled, organizationId)).environmentDisabled, true);
    assert.equal((await scheduler.runSupplySchedulerTick(await owner(), db, disabled)).continue, false);
    assert.equal(launches, before);
    await pass('Disabling the feature job flag neither launches nor executes another batch.');

    await db.organizationFeature.update({ where: { organizationId_featureKey: { organizationId, featureKey: 'PRODUCTION_SUPPLIES' } }, data: { enabled: false } });
    const previousBatches = providerBatches;
    assert.equal((await scheduler.runSupplySchedulerTick(await owner(), db, redeployed)).continue, false);
    assert.equal(providerBatches, previousBatches);
    await pass('A removed tenant entitlement stops persisted scheduling before provider work.');

    assert.equal(await db.supplyAudit.count({ where: { organizationId, action: scheduler.SUPPLY_SCHEDULER_STATE } }), 1);
    assert.equal(await db.supplyOrder.count({ where: { organizationId } }), 0);
    assert.equal(await db.supplySource.count({ where: { organizationId } }), 0);
    assert.equal(await db.supplyReceipt.count({ where: { organizationId } }), 0);
    const receipt = { synthetic: true, rehearsal: true, databaseTarget: 'supplies-rehearsal', organizationId, checks, transitions, stubLaunches: launches, stubBatches: providerBatches, realProviderCalls: 0, realSdkStarts: 0, scope: 'Persisted SQL ownership/lease behavior; hosted SDK sleep/resume still requires deployed acceptance.' };
    mkdirSync('output', { recursive: true });
    writeFileSync('output/production-supplies-scheduler-rehearsal.json', JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify({ passed: checks.length, synthetic: true, rehearsal: true, realProviderCalls: 0, realSdkStarts: 0, output: 'output/production-supplies-scheduler-rehearsal.json' }));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(JSON.stringify({ passed: false, error: error instanceof Error ? error.name : 'Error', message: 'Guarded synthetic scheduler rehearsal did not complete.' })); process.exitCode = 1; });
