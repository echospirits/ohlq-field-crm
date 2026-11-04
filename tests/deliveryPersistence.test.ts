import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DeliveryAvailabilityCheck, DeliveryAvailabilityObservation, PrismaClient } from '@prisma/client';
import { deliveryAlreadyObservedToday, getDeliveryAvailabilityHistory, getDeliveryAvailabilitySignals, recordDeliveryAvailability } from '../lib/productionForecasting/operationalSignals/persistence';
import type { DeliveryAvailabilityResult, OpenDockLocationConfig } from '../lib/productionForecasting/operationalSignals/types';

const locations: OpenDockLocationConfig[] = [
  { market: 'OH', locationCode: 'GPT', locationName: 'Groveport', warehouseId: '11111111-1111-4111-8111-111111111111', loadTypeId: '33333333-3333-4333-8333-333333333333', timezone: 'America/New_York' },
  { market: 'OH', locationCode: 'GRN', locationName: 'Green', warehouseId: '22222222-2222-4222-8222-222222222222', loadTypeId: '44444444-4444-4444-8444-444444444444', timezone: 'America/New_York' },
];
const settings = { productionForecasting: { operationalSignals: { opendock: { verifiedAt: '2026-11-03T11:00:00Z', locations } } } };
type Key = { organizationId: string; market: string; locationCode: string; source: string; observedOn: Date };
const identity = (key: Key) => JSON.stringify([key.organizationId, key.market, key.locationCode, key.source, key.observedOn.toISOString()]);
function fixture(configuration: unknown = settings) {
  const observations = new Map<string, DeliveryAvailabilityObservation>(), checks = new Map<string, DeliveryAvailabilityCheck>();
  let observationQueries = 0;
  const tx = {
    organization: { findFirst: async () => ({ id: 'org_echo_spirits', enabledStates: ['OH'], settings: configuration, timezone: 'America/New_York' }) },
    $executeRaw: async () => 1,
    deliveryAvailabilityObservation: {
      findUnique: async ({ where }: { where: { organizationId_market_locationCode_source_observedOn: Key } }) => observations.get(identity(where.organizationId_market_locationCode_source_observedOn)) ?? null,
      create: async ({ data }: { data: DeliveryAvailabilityObservation }) => { const row = { ...data, id: 'observation-' + observations.size }; observations.set(identity(row), row); return row; },
      findMany: async ({ where, take }: { where: { organizationId: string; locationCode: string | { in: string[] } }; take: number }) => {
        observationQueries++;
        assert.equal(where.organizationId, 'org_echo_spirits');
        return [...observations.values()].filter(row => typeof where.locationCode === 'string' ? row.locationCode === where.locationCode : where.locationCode.in.includes(row.locationCode)).sort((a,b) => b.observedAt.getTime() - a.observedAt.getTime()).slice(0,take);
      },
    },
    deliveryAvailabilityCheck: {
      findUnique: async ({ where }: { where: { organizationId_market_locationCode_source_observedOn: Key } }) => checks.get(identity(where.organizationId_market_locationCode_source_observedOn)) ?? null,
      upsert: async ({ create, update }: { create: DeliveryAvailabilityCheck; update: Omit<DeliveryAvailabilityCheck, 'attemptCount'> & { attemptCount: { increment: number } } }) => {
        const key = identity(create), prior = checks.get(key);
        const row = prior ? { ...prior, ...update, attemptCount: prior.attemptCount + update.attemptCount.increment } : { ...create, id: 'check-' + checks.size, attemptCount: 1 };
        checks.set(key, row); return row;
      },
      findMany: async ({ where }: { where: { organizationId: string } }) => { assert.equal(where.organizationId, 'org_echo_spirits'); return [...checks.values()].sort((a,b) => b.attemptedAt.getTime() - a.attemptedAt.getTime()); },
    },
  };
  const db = { ...tx, $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as PrismaClient;
  return { db, observations, checks, get observationQueries() { return observationQueries; } };
}
function result(location = locations[0], overrides: Partial<DeliveryAvailabilityResult> = {}): DeliveryAvailabilityResult {
  return { ...location, source: 'OPENDOCK', observedAt: '2026-11-03T11:00:00Z', status: 'SUCCESS', earliestAvailableAt: '2026-11-10T09:00:00-05:00', calendarDays: 7, businessDays: null, businessDayMethod: null, checkedThrough: '2026-12-03T11:00:00Z', diagnosticCode: null, ...overrides };
}
const failed = (observedAt: string): Partial<DeliveryAvailabilityResult> => ({ observedAt, status: 'AUTH_FAILED', earliestAvailableAt: null, calendarDays: null, businessDays: null, businessDayMethod: null, checkedThrough: null, diagnosticCode: 'AUTH_FAILED' });

test('delivery snapshots separate GPT/GRN and preserve original date/time with idempotent retries', async () => {
  const f = fixture();
  await recordDeliveryAvailability('org_echo_spirits', result(), f.db);
  await recordDeliveryAvailability('org_echo_spirits', result(locations[1], { earliestAvailableAt: '2026-11-08T08:00:00-05:00', calendarDays: 5 }), f.db);
  assert.equal(f.observations.size, 2);
  assert.deepEqual([...f.observations.values()].map(row => [row.locationCode, row.calendarDays]), [['GPT',7], ['GRN',5]]);
  const gpt = [...f.observations.values()][0];
  assert.equal(gpt.rawEarliestAvailableAt, '2026-11-10T09:00:00-05:00');
  assert.equal(gpt.earliestAvailableDate!.toISOString().slice(0,10), '2026-11-10');
  assert.equal((await recordDeliveryAvailability('org_echo_spirits', result(), f.db)).replay, true);
  assert.equal(f.observations.size, 2);
  assert.equal([...f.checks.values()][0].attemptCount, 1);
  assert.equal(await deliveryAlreadyObservedToday('org_echo_spirits', locations[0], new Date('2026-11-03T20:00:00Z'), f.db), true);
});

test('failed retrieval never replaces a successful snapshot and another day remains historical', async () => {
  const f = fixture();
  await recordDeliveryAvailability('org_echo_spirits', result(), f.db);
  await recordDeliveryAvailability('org_echo_spirits', result(locations[0], failed('2026-11-04T11:00:00Z')), f.db);
  assert.equal(f.observations.size, 1);
  const signals = await getDeliveryAvailabilitySignals('org_echo_spirits', f.db, new Date('2026-11-04T12:00:00Z'));
  const gpt = signals.warehouses[0];
  assert.equal(gpt.latestCheck!.status, 'AUTH_FAILED');
  assert.equal(gpt.lastSuccessfulCheckAt, '2026-11-03T11:00:00.000Z');
  assert.equal(gpt.latestObservation!.calendarDays, 7);
  assert.equal(gpt.freshness, 'delayed');
  assert.equal(gpt.baseline.classification, null);
  await recordDeliveryAvailability('org_echo_spirits', result(locations[0], { observedAt: '2026-11-04T12:00:00Z', earliestAvailableAt: '2026-11-10T09:00:00-05:00', calendarDays: 6 }), f.db);
  assert.equal(f.observations.size, 2);
  assert.equal((await getDeliveryAvailabilityHistory('org_echo_spirits', 'GPT', f.db)).length, 2);
});

test('same-day failure can recover without deleting facts, and a same-day later result cannot replace its snapshot', async () => {
  const f = fixture();
  await recordDeliveryAvailability('org_echo_spirits', result(locations[0], failed('2026-11-03T10:00:00Z')), f.db);
  assert.equal(f.observations.size, 0);
  await recordDeliveryAvailability('org_echo_spirits', result(), f.db);
  assert.equal(f.observations.size, 1);
  await recordDeliveryAvailability('org_echo_spirits', result(locations[0], failed('2026-11-03T12:00:00Z')), f.db);
  assert.equal([...f.observations.values()][0].calendarDays, 7);
  assert.equal([...f.checks.values()][0].status, 'AUTH_FAILED');
  await recordDeliveryAvailability('org_echo_spirits', result(locations[0], { observedAt: '2026-11-03T13:00:00Z', earliestAvailableAt: '2026-11-09T09:00:00-05:00', calendarDays: 6 }), f.db);
  assert.equal(f.observations.size, 1);
  assert.equal([...f.observations.values()][0].calendarDays, 7);
  assert.equal([...f.checks.values()][0].status, 'SUCCESS');
});

test('no availability is a bounded unknown lead time, with previous available appointment retained separately', async () => {
  const f = fixture();
  await recordDeliveryAvailability('org_echo_spirits', result(), f.db);
  const noSlot = result(locations[0], { ...failed('2026-11-04T11:00:00Z'), status: 'NO_AVAILABILITY', diagnosticCode: null, checkedThrough: '2026-12-04T11:00:00Z' });
  await recordDeliveryAvailability('org_echo_spirits', noSlot, f.db);
  const data = (await getDeliveryAvailabilitySignals('org_echo_spirits', f.db, new Date('2026-11-04T12:00:00Z'))).warehouses[0];
  assert.equal(data.latestObservation!.status, 'NO_AVAILABILITY');
  assert.equal(data.latestObservation!.calendarDays, null);
  assert.equal(data.lastAvailableObservation!.calendarDays, 7);
  assert.equal(data.latestObservation!.checkedThrough, '2026-12-04T11:00:00.000Z');
  assert.equal(data.baseline.classification, null);
  await assert.rejects(recordDeliveryAvailability('org_echo_spirits', { ...noSlot, checkedThrough: null }, f.db), /bounded search range/);
});

test('delivery writes reject forged mappings, inconsistent lead times, unsafe diagnostics and foreign tenants', async () => {
  const f = fixture();
  await assert.rejects(recordDeliveryAvailability('foreign', result(), f.db), /restricted to Echo/);
  await assert.rejects(recordDeliveryAvailability('org_echo_spirits', result(locations[0], { warehouseId: locations[1].warehouseId }), f.db), /verified organization warehouse mapping/);
  await assert.rejects(recordDeliveryAvailability('org_echo_spirits', result(locations[0], { calendarDays: 8 }), f.db), /does not match/);
  await assert.rejects(recordDeliveryAvailability('org_echo_spirits', result(locations[0], { businessDays: 5, businessDayMethod: 'SOURCE_OPERATING_CALENDAR' }), f.db), /complete matching source calendar/);
  await assert.rejects(recordDeliveryAvailability('org_echo_spirits', result(locations[0], { diagnosticCode: 'password=secret' }), f.db));
  assert.equal(f.observations.size, 0);
  await assert.rejects(getDeliveryAvailabilityHistory('foreign', 'GPT', f.db), /restricted to Echo/);
});

test('delivery dashboard batches both warehouses and distinguishes missing data from zero', async () => {
  const f = fixture();
  const signals = await getDeliveryAvailabilitySignals('org_echo_spirits', f.db, new Date('2026-11-03T12:00:00Z'));
  assert.equal(f.observationQueries, 1);
  assert.equal(signals.warehouses.length, 2);
  for (const row of signals.warehouses) {
    assert.equal(row.latestObservation, null);
    assert.equal(row.freshness, 'unavailable');
    assert.equal(row.baseline.typicalDays, null);
  }
});


test('changed warehouse configuration never reuses old daily snapshots or old attempt state', async () => {
  const changed = structuredClone(settings);
  const f = fixture(changed);
  await recordDeliveryAvailability('org_echo_spirits', result(), f.db);
  changed.productionForecasting.operationalSignals.opendock.locations[0].loadTypeId = '55555555-5555-4555-8555-555555555555';
  const mapping = changed.productionForecasting.operationalSignals.opendock.locations[0];
  assert.equal(await deliveryAlreadyObservedToday('org_echo_spirits', mapping, new Date('2026-11-03T12:00:00Z'), f.db), false);
  const before = (await getDeliveryAvailabilitySignals('org_echo_spirits', f.db, new Date('2026-11-03T12:00:00Z'))).warehouses[0];
  assert.equal(before.latestObservation, null);
  assert.equal(before.latestCheck, null);
  await assert.rejects(recordDeliveryAvailability('org_echo_spirits', result(mapping, { observedAt: '2026-11-03T12:00:00Z' }), f.db), /mapping changed/);
  await recordDeliveryAvailability('org_echo_spirits', result(mapping, { ...failed('2026-11-03T12:00:00Z'), status: 'UNAVAILABLE', diagnosticCode: 'CONFIGURATION_CHANGED' }), f.db);
  const after = (await getDeliveryAvailabilitySignals('org_echo_spirits', f.db, new Date('2026-11-03T12:00:00Z'))).warehouses[0];
  assert.equal(after.latestObservation, null);
  assert.equal(after.latestCheck!.status, 'UNAVAILABLE');
  assert.equal(f.observations.size, 1);
  assert.equal((await getDeliveryAvailabilityHistory('org_echo_spirits', 'GPT', f.db)).length, 1);
});
