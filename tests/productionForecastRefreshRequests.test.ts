import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient, ProductionForecastRefreshRequest } from '@prisma/client';
import { enqueueForecastRefresh, getForecastRefreshState, heartbeatForecastRefresh, runProductionForecastRefresh, FORECAST_REFRESH_LEASE_MS, FORECAST_REFRESH_MAX_RUNNING_MS, FORECAST_REFRESH_QUEUED_TIMEOUT_MS, type ForecastRefreshServices } from '../lib/productionForecasting/refreshRequests';

const organizationId = 'org_echo_spirits';
const now = new Date('2026-11-10T18:00:00Z');
function matches(record: Record<string, unknown>, where: Record<string, any>) {
  return Object.entries(where).every(([name, value]) => {
    const stored = record[name];
    if (value instanceof Date) return stored instanceof Date && stored.getTime() === value.getTime();
    if (value && typeof value === 'object') {
      if ('in' in value) return value.in.includes(stored);
      if ('lte' in value) return stored instanceof Date && stored <= value.lte;
      if ('gt' in value) return stored instanceof Date && stored > value.gt;
    }
    return stored === value;
  });
}
function fixture() {
  const rows: ProductionForecastRefreshRequest[] = [];
  let enabled = true, requesterActive = true, configured = true, dispatches = 0, sourceRuns = 0;
  const tx: Record<string, any> = {
    $executeRaw: async () => 0,
    organization: { findFirst: async (args: any) => { assert.equal(args.where.id, organizationId); return enabled ? { id: organizationId, enabledStates: ['OH'], timezone: 'America/New_York', settings: { productionForecasting: { ohio: { historyStart: '2019-01-01', directInvoices: 'invoice-date' } } } } : null; } },
    organizationOhlqCredentials: { findUnique: async (args: any) => { assert.equal(args.where.organizationId, organizationId); assert.deepEqual(args.select, { organizationId: true }); return { organizationId }; } },
    user: { findFirst: async (args: any) => { assert.equal(args.where.organizationId, organizationId); assert.equal(args.where.isActive, true); assert.deepEqual(args.where.role.in, ['ADMIN', 'PLATFORM_ADMIN']); return requesterActive && ['admin', 'platform-admin'].includes(args.where.id) ? { id: args.where.id } : null; } },
    productionForecastRefreshRequest: {
      findFirst: async ({ where, orderBy }: any) => {
        assert.equal(where.organizationId, organizationId);
        const selected = rows.filter(row => matches(row, where));
        if (orderBy) selected.sort((a, b) => (where.status === 'SUCCEEDED' ? b.completedAt!.getTime() - a.completedAt!.getTime() : b.requestedAt.getTime() - a.requestedAt.getTime()) || b.id.localeCompare(a.id));
        return selected[0] ?? null;
      },
      create: async ({ data }: any) => {
        const row = { id: `cforecastrefresh${String(rows.length + 1).padStart(8, '0')}`, leaseToken: null, startedAt: null, completedAt: null, heartbeatAt: null, workflowRunId: null, failureCode: null, result: {}, ...data } as ProductionForecastRefreshRequest;
        rows.push(row); return row;
      },
      update: async ({ where, data }: any) => { const row = rows.find(row => matches(row, where)); assert(row); Object.assign(row, data); return row; },
      updateMany: async ({ where, data }: any) => { const selected = rows.filter(row => matches(row, where)); for (const row of selected) Object.assign(row, data); return { count: selected.length }; },
    },
  };
  let lock = Promise.resolve();
  const client = { ...tx, $transaction: async (work: (tx: any) => Promise<unknown>) => {
    const previous = lock; let release!: () => void; lock = new Promise<void>(resolve => { release = resolve; });
    await previous; try { return await work(tx); } finally { release(); }
  } } as unknown as PrismaClient;
  const services: ForecastRefreshServices = {
    configuration: () => configured ? { deploymentEnvironment: 'test', ref: 'tst', repository: 'echospirits/neat-tst', token: 'PRIVATE_CONFIGURATION_TOKEN', workflowId: 'production-forecast-refresh.yml' } : null,
    dispatch: async () => { dispatches++; return { ref: 'tst', repository: 'echospirits/neat-tst', workflowId: 'production-forecast-refresh.yml' }; },
    sources: async options => { sourceRuns++; await options?.onStage?.('FORECAST'); options?.onResult?.({ configuredOrganizations: 1, importedSources: 2, refreshedForecasts: 1, failedSources: [] }); return { configuredOrganizations: 1, importedSources: 2 }; },
    environment: () => 'test',
  };
  const enqueue = (overrides: Partial<ForecastRefreshServices> = {}, at = now, requester = 'admin') => enqueueForecastRefresh({ organizationId, requestedByUserId: requester, db: client, now: at, services: { ...services, ...overrides } });
  const run = (overrides: Partial<ForecastRefreshServices> = {}, clock = () => now) => runProductionForecastRefresh({ requestId: rows.at(-1)!.id, organizationId, workflowRunId: '1234', repository: 'echospirits/neat-tst', environment: 'test' }, { db: client, services: { ...services, ...overrides }, now: clock, heartbeatIntervalMs: 0 });
  return { rows, client, services, enqueue, run, dispatches: () => dispatches, sourceRuns: () => sourceRuns, setConfigured: (value: boolean) => { configured = value; }, revokeUser: () => { requesterActive = false; }, revokeFeature: () => { enabled = false; } };
}

test('requests coalesce concurrent clicks before dispatch completes and return no secret configuration', async () => {
  const f = fixture(); let entered!: () => void, release!: () => void;
  const dispatchEntered = new Promise<void>(resolve => { entered = resolve; }), dispatchReleased = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const first = f.enqueue({ dispatch: async () => { calls++; entered(); await dispatchReleased; return { ref: 'tst', repository: 'echospirits/neat-tst', workflowId: 'production-forecast-refresh.yml' }; } });
  await dispatchEntered;
  const second = await f.enqueue();
  assert.equal(second.ok, true); assert.equal(second.state.job?.status, 'QUEUED'); assert.equal(f.rows.length, 1);
  assert.equal(calls, 1); assert.equal(f.dispatches(), 0);
  release(); const result = await first;
  assert.equal(result.state.job?.id, second.state.job?.id);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CONFIGURATION_TOKEN|leaseToken|workflowRunId/);
  assert.equal(f.rows[0].expiresAt!.getTime() - f.rows[0].requestedAt.getTime(), FORECAST_REFRESH_QUEUED_TIMEOUT_MS);
});

test('missing narrow dispatch setup disables requests without creating a job or running any provider', async () => {
  const f = fixture(); f.setConfigured(false);
  const result = await f.enqueue(); assert.equal(result.ok, false); assert.equal(result.state.configured, false);
  assert.match(result.state.unavailableReason!, /background connection/);
  assert.equal(f.rows.length, 0); assert.equal(f.dispatches(), 0); assert.equal(f.sourceRuns(), 0);
});

test('Sales, foreign users, disabled features and forged organizations stop before dispatch', async () => {
  for (const user of ['sales', 'foreign-admin']) {
    const f = fixture(); await assert.rejects(() => f.enqueue({}, now, user)); assert.equal(f.dispatches(), 0); assert.equal(f.rows.length, 0);
  }
  const f = fixture(); f.revokeFeature(); await assert.rejects(() => f.enqueue());
  await assert.rejects(() => enqueueForecastRefresh({ organizationId: 'outside', requestedByUserId: 'admin', db: f.client, services: f.services, now }));
});

test('dispatch errors store only a safe failed state and permit a later request', async () => {
  const f = fixture(), result = await f.enqueue({ dispatch: async () => { throw new Error('PRIVATE_PROVIDER_RESPONSE Bearer SECRET'); } });
  assert.equal(result.ok, false); assert.equal(result.state.job?.status, 'FAILED');
  assert.equal(f.rows[0].activeKey, null); assert.equal(f.rows[0].failureCode, 'DISPATCH_FAILED');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|Bearer|SECRET/);
  assert.equal((await f.enqueue({}, new Date(now.getTime() + 1000))).state.job?.status, 'QUEUED');
  assert.equal(f.rows.length, 2);
});

test('a dispatch acknowledgement race never overwrites an already claimed running request', async () => {
  const f = fixture();
  const result = await f.enqueue({ dispatch: async () => { Object.assign(f.rows[0], { status: 'RUNNING', startedAt: now, leaseToken: 'owned', expiresAt: new Date(Date.now() + FORECAST_REFRESH_LEASE_MS) }); throw new Error('unknown acknowledgement'); } });
  assert.equal(result.ok, true); assert.equal(result.state.job?.status, 'RUNNING'); assert.equal(f.rows[0].leaseToken, 'owned');
});

test('expired queued and running jobs become retryable history without advancing last successful refresh', async () => {
  const f = fixture(); await f.enqueue();
  f.rows[0].expiresAt = new Date(now.getTime() - 1);
  const state = await getForecastRefreshState(organizationId, f.client, now, f.services);
  assert.equal(state.job?.status, 'TIMED_OUT'); assert.equal(state.lastSuccessfulAt, null);
  await f.enqueue({}, new Date(now.getTime() + 1000));
  Object.assign(f.rows[1], { status: 'RUNNING', startedAt: now, leaseToken: 'old-worker', expiresAt: new Date(now.getTime() - 1) });
  await getForecastRefreshState(organizationId, f.client, now, f.services);
  assert.equal(f.rows[1].status, 'TIMED_OUT');
  assert.equal(await heartbeatForecastRefresh({ requestId: f.rows[1].id, organizationId, leaseToken: 'old-worker', startedAt: now, db: f.client, now }), false);
  assert.equal((await f.run()).replayed, true); assert.equal(f.sourceRuns(), 0);
});

test('heartbeat fencing rejects wrong ownership and expiry and respects the absolute running deadline', async () => {
  const f = fixture(); await f.enqueue();
  Object.assign(f.rows[0], { status: 'RUNNING', startedAt: now, leaseToken: 'owner', expiresAt: new Date(now.getTime() + 60000) });
  const input = { requestId: f.rows[0].id, organizationId, leaseToken: 'owner', startedAt: now, db: f.client, now };
  assert.equal(await heartbeatForecastRefresh({ ...input, leaseToken: 'foreign' }), false);
  assert.equal(await heartbeatForecastRefresh(input), true);
  assert.equal(f.rows[0].expiresAt!.getTime(), now.getTime() + FORECAST_REFRESH_LEASE_MS);
  f.rows[0].expiresAt = new Date(now.getTime() + FORECAST_REFRESH_MAX_RUNNING_MS + 1000);
  const nearDeadline = new Date(now.getTime() + FORECAST_REFRESH_MAX_RUNNING_MS - 1000);
  assert.equal(await heartbeatForecastRefresh({ ...input, now: nearDeadline }), true);
  assert.equal(f.rows[0].expiresAt!.getTime(), now.getTime() + FORECAST_REFRESH_MAX_RUNNING_MS);
  assert.equal(await heartbeatForecastRefresh({ ...input, now: new Date(now.getTime() + FORECAST_REFRESH_MAX_RUNNING_MS) }), false);
});

test('only complete expected source work and a saved forecast succeed; duplicate workers never rerun providers', async () => {
  const f = fixture(); await f.enqueue(); const result = await f.run();
  assert.equal(result.status, 'SUCCEEDED'); assert.equal(result.importedSources, 2); assert.equal(result.replayed, false);
  assert.equal(f.rows[0].activeKey, null); assert.equal(f.rows[0].leaseToken, null);
  const state = await getForecastRefreshState(organizationId, f.client, now, f.services);
  assert.equal(state.lastSuccessfulAt, now.toISOString()); assert.match(state.job!.message, /daily warehouse and demand snapshots retained/);
  assert.equal((await f.run()).replayed, true); assert.equal(f.sourceRuns(), 1);
});

test('a duplicate workflow while the owner is running exits without another provider call', async () => {
  const f = fixture(); await f.enqueue(); let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), finished = new Promise<void>(resolve => { release = resolve; });
  const owner = f.run({ sources: async options => { entered(); await finished; options?.onResult?.({ configuredOrganizations: 1, importedSources: 2, refreshedForecasts: 1, failedSources: [] }); return { configuredOrganizations: 1, importedSources: 2 }; } });
  await started; const duplicate = await f.run();
  assert.equal(duplicate.status, 'RUNNING'); assert.equal(duplicate.replayed, true); assert.equal(f.sourceRuns(), 0);
  release(); assert.equal((await owner).status, 'SUCCEEDED');
});

test('partial source work retains a warning and safe source names while zero organizations cannot succeed', async () => {
  const partial = fixture(); await partial.enqueue();
  const result = await partial.run({ sources: async options => { options?.onResult?.({ configuredOrganizations: 1, importedSources: 1, refreshedForecasts: 1, failedSources: ['DISTRIBUTION_CENTER'] }); throw new Error('PRIVATE SQL password provider body'); } });
  assert.equal(result.status, 'PARTIAL'); assert.equal(result.failedSources, 1);
  const state = await getForecastRefreshState(organizationId, partial.client, now, partial.services);
  assert.match(state.job!.message, /distribution-center guidance/); assert.equal(state.lastSuccessfulAt, null);
  assert.doesNotMatch(JSON.stringify(partial.rows), /PRIVATE SQL|password provider/);
  const empty = fixture(); await empty.enqueue();
  assert.equal((await empty.run({ sources: async options => { options?.onResult?.({ configuredOrganizations: 0, importedSources: 0, refreshedForecasts: 0, failedSources: [] }); return { configuredOrganizations: 0, importedSources: 0 }; } })).status, 'FAILED');
});

test('revoked administrator or feature access is rechecked before a worker starts', async () => {
  for (const revoke of ['user', 'feature']) {
    const f = fixture(); await f.enqueue(); if (revoke === 'user') f.revokeUser(); else f.revokeFeature();
    assert.equal((await f.run()).status, 'FAILED'); assert.equal(f.sourceRuns(), 0); assert.equal(f.rows[0].failureCode, 'REQUESTER_UNAVAILABLE');
  }
});

test('late completion cannot report success after losing its lease', async () => {
  const f = fixture(); await f.enqueue(); let time = now;
  const result = await f.run({ sources: async options => { options?.onResult?.({ configuredOrganizations: 1, importedSources: 2, refreshedForecasts: 1, failedSources: [] }); time = new Date(now.getTime() + FORECAST_REFRESH_LEASE_MS + 1); return { configuredOrganizations: 1, importedSources: 2 }; } }, () => time);
  assert.equal(result.status, 'TIMED_OUT'); assert.equal(f.rows[0].activeKey, null);
});

test('status read failure degrades only refresh state and invalid runner provenance stops before work', async () => {
  const f = fixture();
  const broken = { $transaction: async () => { throw new Error('PRIVATE database error'); } } as unknown as PrismaClient;
  const state = await getForecastRefreshState(organizationId, broken, now, f.services);
  assert.equal(state.configured, false); assert.match(state.unavailableReason!, /temporarily unavailable/); assert.doesNotMatch(JSON.stringify(state), /PRIVATE/);
  await f.enqueue();
  await assert.rejects(() => runProductionForecastRefresh({ requestId: f.rows[0].id, organizationId, workflowRunId: '123', repository: 'echospirits/ohlq-field-crm', environment: 'test' }, { db: f.client, services: f.services }));
  assert.equal(f.sourceRuns(), 0);
});
