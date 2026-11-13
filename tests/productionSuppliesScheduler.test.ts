import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { ensureSupplySchedulers, rollSupplyScheduler, runSupplySchedulerTick, supplySchedulerOrigin, SUPPLY_POLL_MS, SUPPLY_WORK_LEASE_MS, type SupplySchedulerState } from '../lib/productionSupplies/scheduler';
import type { runSupplyJobs } from '../lib/productionSupplies/jobs';
import {runSupplyJobs as realSupplyJobs} from '../lib/productionSupplies/jobs';
import {chooseSupplyMailLane,supplyMailCursor} from '../lib/productionSupplies/mailDiscovery';
import type {syncSupplyMailbox} from '../lib/productionSupplies/mail';

const startAt = Date.parse('2026-11-12T12:00:00Z');
const env = { NODE_ENV: 'test' as const, APP_ENV: 'development', SUPPLY_JOBS_ENABLED: 'true', VERCEL_DEPLOYMENT_ID: 'deployment-one' };
const result = (patch: Partial<Awaited<ReturnType<typeof runSupplyJobs>>> = {}) => ({ organizations: 1, mailboxChecks: 1, mailboxErrors: 0, tracking: [], evidenceReplays: 0, replayErrors: 0, deferred: false, continuation: false, backfillIncomplete: false,earliestMailboxNextAt:null, ...patch });

function fixture() {
  let time = startAt, sequence = 0;
  const rows = new Map<string, { detail: SupplySchedulerState }>();
  const organizations = new Set(['org-one']);
  const launches: Array<{ organizationId: string; generation: string; runId: string }> = [];
  let queue: Promise<unknown> = Promise.resolve();
  const tx = {
    $executeRaw: async (_parts: TemplateStringsArray, key: string) => { assert.match(key, /^supply-scheduler:org-/); return 1; },
    organization: { findFirst: async ({ where }: { where: { id: string } }) => organizations.has(where.id) ? { id: where.id } : null },
    supplyAudit: {
      findFirst: async ({ where }: { where: { id: string; organizationId: string } }) => {
        assert.equal(where.id, `supply-scheduler:${where.organizationId}`);
        return rows.has(where.id) ? structuredClone(rows.get(where.id)) : null;
      },
      upsert: async ({ where, create, update }: { where: { id: string }; create: { organizationId: string; detail: SupplySchedulerState }; update: { detail: SupplySchedulerState } }) => {
        assert.ok(organizations.has(create.organizationId));
        rows.set(where.id, structuredClone({ detail: rows.has(where.id) ? update.detail : create.detail }));
        return rows.get(where.id);
      },
    },
  };
  const db = {
    organization: { findMany: async ({ where }: { where: { id?: string; features: unknown; active: boolean } }) => {
      assert.equal(where.active, true); assert.ok(where.features);
      return [...organizations].filter(id => !where.id || where.id === id).map(id => ({ id }));
    } },
    $transaction: async <T>(work: (transaction: typeof tx) => Promise<T>) => {
      const prior = queue;
      let release!: () => void;
      queue = new Promise<void>(resolve => { release = resolve; });
      await prior;
      try { return await work(tx); } finally { release(); }
    },
  } as unknown as PrismaClient;
  const services = { env, now: () => time, control: async () => 'current' as const, runStatus: async () => 'running',
    launch: async (organizationId: string, generation: string) => { const runId = `run-${++sequence}`; launches.push({ organizationId, generation, runId }); return runId; },
    jobs: (async () => result()) as typeof runSupplyJobs };
  const state = (organizationId = 'org-one') => rows.get(`supply-scheduler:${organizationId}`)!.detail;
  const owner = () => ({ organizationId: 'org-one', generation: state().generation, runId: state().runId });
  return { db, services, state, owner, launches, organizations, rows, advance: (ms: number) => { time += ms; } };
}

test('disabled scheduling returns before database/provider work and canonical credentials cannot follow arbitrary or preview targets', async () => {
  const disabled = { env: { ...env, SUPPLY_JOBS_ENABLED: 'false' } };
  assert.equal((await ensureSupplySchedulers({} as PrismaClient, disabled)).environmentDisabled, true);
  assert.equal((await ensureSupplySchedulers({} as PrismaClient, { env: { ...env, VERCEL: '1', VERCEL_ENV: 'preview', APP_ENV: 'test' } })).environmentDisabled, true);
  assert.equal((await runSupplySchedulerTick({ organizationId: 'org-one', generation: 'old', runId: 'old' }, {} as PrismaClient, disabled)).continue, false);
  assert.equal(supplySchedulerOrigin({ ...env, VERCEL: '1', VERCEL_ENV: 'production', APP_ENV: 'production', APP_BASE_URL: 'https://untrusted.example' }), 'https://crm.echospirits.com');
  assert.equal(supplySchedulerOrigin({ ...env, VERCEL: '1', VERCEL_ENV: 'production', APP_ENV: 'test' }), 'https://neat-tst.vercel.app');
  assert.equal(supplySchedulerOrigin({ ...env, VERCEL: '1', VERCEL_ENV: 'preview', APP_ENV: 'production' }), null);
});

test('concurrent authenticated watchdogs start one tenant generation; other tenants retain independent ownership', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([ensureSupplySchedulers(f.db, f.services), ensureSupplySchedulers(f.db, f.services)]);
  assert.equal(f.launches.length, 1);
  assert.deepEqual([a.schedulers[0].status, b.schedulers[0].status].sort(), ['healthy', 'started']);
  f.organizations.add('org-two');
  await ensureSupplySchedulers(f.db, f.services, 'org-two');
  assert.equal(f.launches.length, 2);
  assert.notEqual(f.state().generation, f.state('org-two').generation);
});

test('latest-deployment control authenticates only the fixed canonical URL, rejects redirects, and honors its disabled signal', async () => {
  const f = fixture(); await ensureSupplySchedulers(f.db, f.services);
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async (input, options) => {
    requests++;
    assert.equal(String(input), 'https://crm.echospirits.com/api/cron/production-supplies?organizationId=org-one');
    assert.equal(options?.redirect, 'error'); assert.equal(options?.cache, 'no-store');
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer synthetic-control-key');
    return Response.json({ environmentDisabled: true });
  }) as typeof fetch;
  try {
    const stopped = await runSupplySchedulerTick(f.owner(), f.db, { ...f.services, control: undefined,
      env: { ...env, VERCEL: '1', VERCEL_ENV: 'production', APP_ENV: 'production', APP_BASE_URL: 'https://untrusted.example', SUPPLY_JOB_SECRET: 'synthetic-control-key' },
      jobs: (async () => { assert.fail('the latest deployment disabled provider work'); }) as typeof runSupplyJobs });
    assert.equal(stopped.continue, false); assert.equal(stopped.reason, 'disabled'); assert.equal(requests, 1);
    assert.doesNotMatch(JSON.stringify(f.state()), /synthetic-control-key/);
  } finally { globalThis.fetch = original; }
});

test('a due batch persists ownership before provider work and schedules the next 15-minute boundary without drift', async () => {
  const f = fixture(); let calls = 0;
  await ensureSupplySchedulers(f.db, f.services);
  const services = { ...f.services, jobs: (async (_db, options) => {
    calls++; assert.equal(options?.organizationId, 'org-one');
    assert.equal(f.state().status, 'RUNNING');
    assert.equal(Date.parse(f.state().workUntil!), startAt + SUPPLY_WORK_LEASE_MS);
    f.advance(120_000); return result();
  }) as typeof runSupplyJobs };
  const first = await runSupplySchedulerTick(f.owner(), f.db, services);
  assert.equal(first.nextAt, new Date(startAt + SUPPLY_POLL_MS).toISOString());
  assert.equal(f.state().workUntil, null);
  assert.equal(f.state().completedBatches, 1);
  await runSupplySchedulerTick(f.owner(), f.db, services);
  assert.equal(calls, 1, 'a retried step does not re-run the completed provider batch');
});

test('an incomplete mailbox resumes after a durable minute and finishing catch-up preserves the regular due time', async () => {
  const f = fixture(); await ensureSupplySchedulers(f.db, f.services);
  const partial = await runSupplySchedulerTick(f.owner(), f.db, { ...f.services, jobs: (async () => result({ continuation: true, backfillIncomplete: true })) as typeof runSupplyJobs });
  assert.equal(Date.parse(partial.nextAt!), startAt + 60_000);
  assert.equal(Date.parse(f.state().nextRegularAt), startAt + SUPPLY_POLL_MS);
  f.advance(60_000);
  const finished = await runSupplySchedulerTick(f.owner(), f.db, f.services);
  assert.equal(Date.parse(finished.nextAt!), startAt + SUPPLY_POLL_MS);
});

test('an early regular tick retains the future mailbox wake and resumes overdue incremental work before catch-up',async()=>{
  const f=fixture();await ensureSupplySchedulers(f.db,f.services);await runSupplySchedulerTick(f.owner(),f.db,f.services);
  const cursor=supplyMailCursor(null,{now:new Date(startAt),backfillComplete:false,lastSuccessfulSyncAt:new Date(startAt+5000),broadQuery:'synthetic broad query',priorityQueries:{DX5:'synthetic Dx5',PRODUCTION_ORDERS:'synthetic production',MATERIALS:null}});
  const untouchedScans=structuredClone(cursor.scans);
  const mailbox={organizationId:'org-one',userId:'person',status:'INITIAL_IMPORT',backfillCompletedAt:null,cursor,leaseUntil:null as Date|null,nextSyncAt:new Date(startAt+SUPPLY_POLL_MS+40_000)};
  let checks=0;const lanes:string[]=[];
  Object.assign(f.db,{supplyAudit:{findMany:async()=>[]},supplyMailboxSync:{findMany:async(args:{where:{nextSyncAt?:{lte:Date}};select:{nextSyncAt?:boolean}})=>args.select.nextSyncAt?[mailbox]:args.where.nextSyncAt && mailbox.nextSyncAt<=args.where.nextSyncAt.lte?[mailbox]:[]}});
  const services={...f.services,jobs:(async(db,options)=>realSupplyJobs(db,{organizationId:options?.organizationId,clock:f.services.now,reconcile:async()=>[],watchScope:async organizationId=>({materials:[],orderWhere:{organizationId}}),mailbox:(async()=>{checks++;lanes.push(chooseSupplyMailLane(cursor,new Date(f.services.now()),15)!);cursor.lastIncrementalAt=new Date(f.services.now()).toISOString();mailbox.nextSyncAt=new Date(f.services.now()+60_000);return{processed:0,processedMessages:0,ignoredInlineImages:0,continuation:true,backfillIncomplete:true,catchupPhase:'INCREMENTAL'};}) as typeof syncSupplyMailbox})) as typeof runSupplyJobs};
  f.advance(SUPPLY_POLL_MS+1000);
  const early=await runSupplySchedulerTick(f.owner(),f.db,services);
  assert.equal(checks,0);assert.equal(early.nextAt,mailbox.nextSyncAt.toISOString());assert.equal(Date.parse(f.state().nextRegularAt),startAt+2*SUPPLY_POLL_MS);
  assert.equal(f.state().lastResult?.backfillIncomplete,true);assert.equal(f.state().lastResult?.continuation,true);assert.equal(cursor.lastIncrementalAt,new Date(startAt+5000).toISOString());assert.deepEqual(cursor.scans,untouchedScans);
  f.advance(39_000);await runSupplySchedulerTick(f.owner(),f.db,services);
  assert.equal(checks,1);assert.deepEqual(lanes,['INCREMENTAL']);assert.deepEqual(cursor.scans,untouchedScans);assert.equal(Date.parse(f.state().nextRegularAt),startAt+2*SUPPLY_POLL_MS);
});

test('future mailbox leases and Retry-After do not become generic minute polls, while past-due debt is bounded',async()=>{
  for(const [offset,expected] of [[330_000,330_000],[3_600_000,SUPPLY_POLL_MS],[-1,60_000]]){
    const f=fixture();await ensureSupplySchedulers(f.db,f.services);
    const next=await runSupplySchedulerTick(f.owner(),f.db,{...f.services,jobs:(async()=>result({mailboxChecks:0,continuation:true,backfillIncomplete:true,earliestMailboxNextAt:new Date(startAt+offset).toISOString()})) as typeof runSupplyJobs});
    assert.equal(Date.parse(next.nextAt!),startAt+expected);assert.ok(Date.parse(next.nextAt!)>startAt);
  }
});

test('failed batches persist only safe status and use bounded retry; canonical unavailability never runs providers', async () => {
  const f = fixture(); await ensureSupplySchedulers(f.db, f.services);
  const failed = await runSupplySchedulerTick(f.owner(), f.db, { ...f.services, jobs: (async () => { throw new Error('private provider correspondence'); }) as typeof runSupplyJobs });
  assert.equal(Date.parse(failed.nextAt!), startAt + 300_000);
  assert.equal(f.state().failedBatches, 1);
  assert.doesNotMatch(JSON.stringify(f.state()), /private provider/);
  f.advance(300_000);
  await runSupplySchedulerTick(f.owner(), f.db, { ...f.services, control: async () => 'unavailable', jobs: (async () => { assert.fail('control outage must fail closed'); }) as typeof runSupplyJobs });
  assert.equal(Date.parse(f.state().nextDueAt), startAt + 600_000);
});

test('stale heartbeat recovery replaces ownership and fences the abandoned run', async () => {
  const f = fixture(); await ensureSupplySchedulers(f.db, f.services); const old = f.owner();
  f.advance(300_001);
  const recovered = await ensureSupplySchedulers(f.db, f.services);
  assert.equal(recovered.schedulers[0].status, 'started');
  assert.notEqual(f.owner().generation, old.generation);
  assert.equal((await runSupplySchedulerTick(old, f.db, f.services)).continue, false);
});

test('watchdogs recover a known terminal runtime; a metadata outage cannot create competing ownership', async () => {
  const f = fixture(); await ensureSupplySchedulers(f.db, f.services);
  assert.equal((await ensureSupplySchedulers(f.db, { ...f.services, runStatus: async () => { throw new Error('metadata unavailable'); } })).schedulers[0].status, 'healthy');
  assert.equal(f.launches.length, 1);
  assert.equal((await ensureSupplySchedulers(f.db, { ...f.services, runStatus: async () => 'failed' })).schedulers[0].status, 'started');
  assert.equal(f.launches.length, 2);
});

test('a redeployment rotates the generation but respects in-flight work and an old completion cannot overwrite its successor', async () => {
  const f = fixture(); await ensureSupplySchedulers(f.db, f.services); const old = f.owner();
  let entered!: () => void, release!: () => void;
  const running = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const oldTick = runSupplySchedulerTick(old, f.db, { ...f.services, jobs: (async () => { entered(); await gate; return result(); }) as typeof runSupplyJobs });
  await running;
  await ensureSupplySchedulers(f.db, { ...f.services, env: { ...env, VERCEL_DEPLOYMENT_ID: 'deployment-two' } });
  const next = f.owner();
  assert.notEqual(next.generation, old.generation);
  const waiting = await runSupplySchedulerTick(next, f.db, { ...f.services, jobs: (async () => { assert.fail('old work lease still active'); }) as typeof runSupplyJobs });
  assert.equal(Date.parse(waiting.nextAt!), startAt + SUPPLY_WORK_LEASE_MS);
  release(); assert.equal((await oldTick).continue, false);
  assert.equal(f.state().generation, next.generation);
  assert.equal(f.state().completedBatches, 0);
});

test('latest disabled/superseded signals and removed tenant entitlement stop before provider work', async () => {
  for (const control of ['disabled', 'superseded'] as const) {
    const f = fixture(); await ensureSupplySchedulers(f.db, f.services);
    const stopped = await runSupplySchedulerTick(f.owner(), f.db, { ...f.services, control: async () => control, jobs: (async () => { assert.fail('stopped generation'); }) as typeof runSupplyJobs });
    assert.equal(stopped.continue, false);
  }
  const f = fixture(); await ensureSupplySchedulers(f.db, f.services); const owner = f.owner(); f.organizations.clear();
  assert.equal((await runSupplySchedulerTick(owner, f.db, f.services)).continue, false);
});

test('finite-run rollover starts one successor and retrying a retired handoff cannot create duplicates', async () => {
  const f = fixture(); await ensureSupplySchedulers(f.db, f.services); const old = f.owner();
  assert.equal((await rollSupplyScheduler(old, f.db, f.services)).status, 'started');
  assert.equal((await rollSupplyScheduler(old, f.db, f.services)).status, 'superseded');
  assert.equal(f.launches.length, 2);
});
