import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { syncOperationalSignals } from '../lib/productionForecasting/operationalSignals/workflow';
import { syncProductionSources } from '../lib/productionForecasting/sourceWorkflow';
import type { DeliveryAvailabilityResult, OpenDockLocationConfig } from '../lib/productionForecasting/operationalSignals/types';

const locations: OpenDockLocationConfig[] = [
  { market: 'OH', locationCode: 'GPT', locationName: 'Groveport', warehouseId: '11111111-1111-4111-8111-111111111111', loadTypeId: '33333333-3333-4333-8333-333333333333', timezone: 'America/New_York', calendar: { coveredFrom: '2026-11-01', coveredThrough: '2026-12-31', openWeekdays: [1,2,3,4,5], closedDates: ['2026-11-26'] } },
  { market: 'OH', locationCode: 'GRN', locationName: 'Green', warehouseId: '22222222-2222-4222-8222-222222222222', loadTypeId: '44444444-4444-4444-8444-444444444444', timezone: 'America/New_York' },
];
const now = new Date('2026-11-03T11:00:00Z');
const settings = { productionForecasting: { operationalSignals: { opendock: { verifiedAt: now.toISOString(), locations } } } };
const product = { id: 'product-1', market: 'OH', code: 'RUM', name: 'Rum' };
function fixture(configuration: unknown = settings, completed: string[] = []) {
  const events: string[] = [], logs: string[] = [], recorded: DeliveryAvailabilityResult[] = [];
  const db = {
    organization: { findMany: async ({ where }: { where: Record<string, unknown> }) => {
      assert.equal(where.id, 'org_echo_spirits');
      assert.equal('ohlqCredentials' in where, false);
      return [{ id: 'org_echo_spirits', settings: configuration, timezone: 'America/New_York' }];
    } },
    currentDemandObservation: { findMany: async ({ where }: { where: { organizationId: string } }) => { assert.equal(where.organizationId, 'org_echo_spirits'); return completed.map(productId => ({ productId })); } },
  } as unknown as PrismaClient;
  const services = {
    deliveryCredentials: async () => ({ email: 'example@example.com', password: 'unit-private-password' }),
    deliveryClient: () => ({ availability: async (location: OpenDockLocationConfig, observedAt = now.toISOString()): Promise<DeliveryAvailabilityResult> => {
      events.push('delivery:' + location.locationCode);
      return { market: location.market, locationCode: location.locationCode, locationName: location.locationName, warehouseId: location.warehouseId, loadTypeId: location.loadTypeId, timezone: location.timezone, source: 'OPENDOCK', observedAt, status: location.locationCode === 'GPT' ? 'AUTH_FAILED' : 'SUCCESS', earliestAvailableAt: location.locationCode === 'GPT' ? null : '2026-11-10T11:00:00Z', calendarDays: location.locationCode === 'GPT' ? null : 7, businessDays: null, businessDayMethod: null, checkedThrough: '2026-12-03T11:00:00Z', diagnosticCode: null };
    } }),
    deliveryObserved: async () => false,
    recordDelivery: async (_organizationId: string, result: DeliveryAvailabilityResult) => { recorded.push(result); return { id: 'observation', replay: false, status: result.status }; },
    products: async () => [product],
    opsCredentials: async () => ({ username: 'ops-example', password: 'unit-private-ops-password' }),
    downloadDemand: async (options: { itemCodes: string[] }) => { events.push('demand:' + options.itemCodes.join(',')); return { products: [] }; },
    ingestDemand: async () => { events.push('ingest-demand'); return { results: [], available: 1, unavailable: 0, failed: 0, reused: 0 }; },
  };
  const logger = { log: (message: string) => logs.push(message), error: (message: string) => logs.push(message) };
  return { db, services, logger, events, logs, recorded };
}

test('morning signals isolate warehouse failures and still ingest current demand', async () => {
  const f = fixture();
  const result = await syncOperationalSignals({ ...f, now });
  assert.deepEqual(f.events, ['delivery:GPT','delivery:GRN','demand:RUM','ingest-demand']);
  assert.equal(result.deliveryObserved, 1);
  assert.equal(result.demandObserved, 1);
  assert.equal(result.failed, 1);
  assert.equal(f.recorded.length, 2);
  assert.equal(f.logs.some(line => /unit-private|example@example/.test(line)), false);
});

test('unconfigured delivery still runs demand, and missing optional credentials are explicit skips', async () => {
  const f = fixture({});
  const result = await syncOperationalSignals({ ...f, now });
  assert.deepEqual(f.events, ['demand:RUM','ingest-demand']);
  assert.equal(result.failed, 0);
  assert.equal(result.skipped, 1);
  assert.ok(f.logs.some(line => line.includes('NOT_CONFIGURED')));
  const missing = fixture();
  const skipped = await syncOperationalSignals({ ...missing, services: { ...missing.services, deliveryCredentials: async () => null, opsCredentials: async () => null }, now });
  assert.equal(skipped.failed, 0);
  assert.equal(skipped.skipped, 3);
  assert.equal(missing.recorded.length, 2);
  assert.equal(missing.recorded[0].status, 'NOT_CONFIGURED');
  assert.equal('calendar' in missing.recorded[0], false);
  assert.deepEqual(missing.events, []);
});

test('daily successful observations skip provider calls while failed/missing locations remain retryable', async () => {
  const f = fixture(settings, ['product-1']);
  const result = await syncOperationalSignals({ ...f, services: { ...f.services, deliveryObserved: async (_id, location) => location.locationCode === 'GRN' }, now });
  assert.deepEqual(f.events, ['delivery:GPT']);
  assert.equal(result.reused, 2);
  assert.equal(result.failed, 1);
});

test('unexpected one-warehouse failures retain safe failure status and do not stop independent work', async () => {
  const f = fixture();
  const result = await syncOperationalSignals({ ...f, services: { ...f.services, deliveryClient: () => ({ availability: async () => { throw new Error('unsafe provider token that must not be logged'); } }) }, now });
  assert.equal(result.failed, 2);
  assert.equal(result.demandObserved, 1);
  assert.equal(f.recorded.length, 2);
  assert.ok(f.recorded.every(row => row.status === 'UNAVAILABLE' && row.diagnosticCode === 'INGESTION_FAILED' && !('calendar' in row)));
  assert.equal(f.logs.some(line => line.includes('unsafe provider token')), false);
});

test('source workflow retains legacy service injection and always runs its optional operational hook', async () => {
  let operationalRuns = 0;
  const db = { organization: { findMany: async () => [] } } as unknown as PrismaClient;
  const services = { credentials: async () => null, bailment: async () => { throw Error('unused'); }, dc: async () => { throw Error('unused'); }, importCsv: async () => { throw Error('unused'); }, refresh: async () => { throw Error('unused'); } };
  assert.deepEqual(await syncProductionSources({ db, services }), { configuredOrganizations: 0, importedSources: 0 });
  const operations = async () => { operationalRuns++; return { configuredOrganizations: 1, deliveryObserved: 0, demandObserved: 1, reused: 0, skipped: 1, failed: 0, unavailableDemand: 0, warnings: 0 }; };
  assert.deepEqual(await syncProductionSources({ db, services: { ...services, operations } }), { configuredOrganizations: 0, importedSources: 0 });
  assert.equal(operationalRuns, 1);
});


test('operational refresh still runs after historical source imports fail', async () => {
  let operationalRuns = 0;
  const db = {
    organization: { findMany: async () => [{ id: 'org_echo_spirits', settings: {}, timezone: 'America/New_York' }] },
    productionSourceImport: { upsert: async () => ({}) },
  } as unknown as PrismaClient;
  const services = {
    credentials: async () => null, bailment: async () => { throw Error('unused'); }, dc: async () => { throw Error('unused'); }, importCsv: async () => { throw Error('unused'); },
    refresh: async () => ({ id: 'forecast', replay: false, products: 0 }),
    operations: async () => { operationalRuns++; return { configuredOrganizations: 1, deliveryObserved: 1, demandObserved: 0, reused: 0, skipped: 1, failed: 0, unavailableDemand: 0, warnings: 0 }; },
  };
  await assert.rejects(syncProductionSources({ db, services, logger: { log() {}, error() {} }, now }), /Production source failures/);
  assert.equal(operationalRuns, 1);
});

function deliveryResult(location: OpenDockLocationConfig, status: DeliveryAvailabilityResult['status'], diagnosticCode: string | null): DeliveryAvailabilityResult {
  return { market: location.market, locationCode: location.locationCode, locationName: location.locationName,
    warehouseId: location.warehouseId, loadTypeId: location.loadTypeId, timezone: location.timezone,
    source: 'OPENDOCK', observedAt: now.toISOString(), status, diagnosticCode,
    earliestAvailableAt: null, calendarDays: null, businessDays: null, businessDayMethod: null, checkedThrough: null };
}

test('temporary provider lookup failures persist unavailable state, warn and allow the complete source workflow to succeed', async () => {
  for (const code of ['OPENDOCK_TIMEOUT', 'OPENDOCK_NETWORK_OR_TIMEOUT', 'OPENDOCK_UPSTREAM_UNAVAILABLE', 'OPENDOCK_RATE_LIMITED']) {
    const f = fixture();
    const operations = () => syncOperationalSignals({ ...f, now, services: { ...f.services,
      deliveryClient: () => ({ availability: async (location: OpenDockLocationConfig) => deliveryResult(location, 'UNAVAILABLE', code) }),
    } });
    const result = await operations();
    assert.equal(result.failed, 0);
    assert.equal(result.warnings, 2);
    assert.equal(result.deliveryObserved, 0);
    assert.equal(result.demandObserved, 1);
    assert.ok(f.recorded.every(row => row.status === 'UNAVAILABLE' && row.earliestAvailableAt === null));
    assert.ok(f.logs.some(line => line.includes(code) && line.includes('Previous successful observations retained')));
    const core = { credentials: async () => null, bailment: async () => { throw Error('unused'); }, dc: async () => { throw Error('unused'); }, importCsv: async () => { throw Error('unused'); }, refresh: async () => { throw Error('unused'); }, operations };
    assert.deepEqual(await syncProductionSources({ db: { organization: { findMany: async () => [] } } as unknown as PrismaClient, services: core, logger: f.logger }), { configuredOrganizations: 0, importedSources: 0 });
  }
});

test('authentication, response validation, unknown unavailable and failed warning persistence still fail operational sources', async () => {
  for (const [status, code] of [['AUTH_FAILED', 'OPENDOCK_AUTHENTICATION_REQUIRED'], ['INVALID_RESPONSE', 'OPENDOCK_RESPONSE_FORMAT_CHANGED'], ['UNAVAILABLE', 'INGESTION_FAILED'], ['UNAVAILABLE', null]] as const) {
    const f = fixture();
    const result = await syncOperationalSignals({ ...f, now, services: { ...f.services,
      deliveryClient: () => ({ availability: async (location: OpenDockLocationConfig) => deliveryResult(location, status, code) }),
    } });
    assert.equal(result.failed, 2);
    assert.equal(result.warnings, 0);
    assert.equal(result.demandObserved, 1);
  }
  const f = fixture();
  const operations = () => syncOperationalSignals({ ...f, now, services: { ...f.services,
    deliveryClient: () => ({ availability: async (location: OpenDockLocationConfig) => deliveryResult(location, 'UNAVAILABLE', 'OPENDOCK_TIMEOUT') }),
    recordDelivery: async () => { throw new Error('private database exception'); },
  } });
  const result = await operations();
  assert.equal(result.failed, 2);
  assert.equal(result.warnings, 0);
  assert.equal(f.logs.some(line => /Previous successful|private database/.test(line)), false);
  const core = { credentials: async () => null, bailment: async () => { throw Error('unused'); }, dc: async () => { throw Error('unused'); }, importCsv: async () => { throw Error('unused'); }, refresh: async () => { throw Error('unused'); }, operations };
  await assert.rejects(syncProductionSources({ db: { organization: { findMany: async () => [] } } as unknown as PrismaClient, services: core, logger: f.logger }), /OPERATIONAL_SIGNALS/);
});
