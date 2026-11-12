import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { getTrackingConfiguration, handleSupplyTrackingWebhook, lookupEasyPostTracking, nextTrackingCheck, parseEasyPostObservation, persistSupplyTrackingObservation, refreshSupplyShipmentTracking, SupplyTrackingError, verifyEasyPostWebhook } from '../lib/productionSupplies/tracking';

const now = new Date('2026-11-12T16:00:00Z');
const testEnv = { SUPPLY_TRACKING_MODE: 'test', EASYPOST_TEST_API_KEY: 'test-key', EASYPOST_WEBHOOK_SECRET: 'webhook-secret' };
const reference = { referenceType: 'PARCEL', reference: 'EZ2000000002', carrier: 'USPS', timezone: 'America/New_York' };
const fixture = (changes: Record<string, unknown> = {}) => ({ id: 'trk_sanitized', object: 'Tracker', mode: 'test', tracking_code: reference.reference, carrier: 'USPS', status: 'in_transit', status_detail: 'status_update', updated_at: now.toISOString(), est_delivery_date: null,
  carrier_detail: { est_delivery_date_local: '2026-11-14', est_delivery_time_local: null }, tracking_details: [], ...changes });
const response = (changes: Record<string, unknown> = {}) => new Response(JSON.stringify(fixture(changes)), { status: 200 });

test('tracking is off without configuration, separates test/live keys and requires charge approval', () => {
  assert.equal(getTrackingConfiguration({}).configured, false);
  assert.equal(getTrackingConfiguration(testEnv).providerMode, 'test');
  assert.equal(getTrackingConfiguration({ SUPPLY_TRACKING_MODE: 'live', EASYPOST_TEST_API_KEY: 'test' }).configured, false);
  assert.match(getTrackingConfiguration({ SUPPLY_TRACKING_MODE: 'live', EASYPOST_LIVE_API_KEY: 'live' }).reason!, /charges/);
  assert.equal(getTrackingConfiguration({ SUPPLY_TRACKING_MODE: 'live', EASYPOST_LIVE_API_KEY: 'live', SUPPLY_TRACKING_LIVE_ENABLED: 'true' }).configured, true);
});

test('date-only ETA retains the exact local calendar date and no invented arrival time', () => {
  const value = parseEasyPostObservation(fixture(), { timezone: 'America/Los_Angeles', observedAt: now });
  assert.equal(value.estimate?.startDate, '2026-11-14');
  assert.equal(value.estimate?.precision, 'DATE');
  assert.equal(value.estimate?.timeStart, null);
  assert.equal(parseEasyPostObservation(fixture({ carrier_detail: null, est_delivery_date: '2026-11-14' })).estimate?.startDate, '2026-11-14');
});

test('carrier timestamps are interpreted in destination timezone, explicit local time keeps precision', () => {
  const date = parseEasyPostObservation(fixture({ carrier_detail: null, est_delivery_date: '2026-11-14T01:00:00Z' }), { timezone: 'America/New_York' });
  assert.equal(date.estimate?.startDate, '2026-11-13');
  assert.equal(date.estimate?.precision, 'DATE');
  const appointment = parseEasyPostObservation(fixture({ carrier_detail: { est_delivery_date_local: '2026-11-14', est_delivery_time_local: '14:30:00' } }));
  assert.equal(appointment.estimate?.timeStart, '14:30:00');
  assert.equal(appointment.estimate?.precision, 'TIME_WINDOW');
});

test('missing ETA is unknown and malformed provider responses cannot create operational facts', () => {
  assert.equal(parseEasyPostObservation(fixture({ carrier_detail: null })).estimate, null);
  assert.equal(parseEasyPostObservation(fixture({ carrier_detail: { est_delivery_date_local: '2026-02-30' } })).estimate, null);
  assert.throws(() => parseEasyPostObservation(fixture({ updated_at: 'last Thursday' })), SupplyTrackingError);
});

test('actual delivery time requires a carrier delivery scan and never falls back to provider update time', () => {
  assert.equal(parseEasyPostObservation(fixture({ status: 'delivered' })).deliveredAt, null);
  assert.equal(parseEasyPostObservation(fixture({ status: 'delivered', tracking_details: [{ status: 'delivered', datetime: '2026-11-10T13:00:00' }] })).deliveredAt, null);
  const value = parseEasyPostObservation(fixture({ status: 'delivered', tracking_details: [{ status: 'in_transit', datetime: now.toISOString() }, { status: 'delivered', datetime: '2026-11-10T13:00:00-05:00' }] }));
  assert.equal(value.deliveredAt?.toISOString(), '2026-11-10T18:00:00.000Z');
  assert.equal(value.providerEventAt.toISOString(), now.toISOString());
});

test('return-to-sender delivery is never successful facility delivery and delayed states can recover', () => {
  const returned = parseEasyPostObservation(fixture({ status: 'delivered', tracking_details: [{ status: 'return_to_sender', datetime: '2026-11-11T10:00:00Z' }] }));
  assert.equal(returned.status, 'RETURNED');
  assert.equal(returned.deliveredAt, null);
  assert.match(returned.summary, /receipt remains unconfirmed/);
  assert.equal(parseEasyPostObservation(fixture({ status: 'delivered' }), { returnedAt: now }).status, 'RETURNED');
  assert.equal(parseEasyPostObservation(fixture({ status_detail: 'weather_delay' })).status, 'DELAYED');
  assert.equal(parseEasyPostObservation(fixture()).status, 'IN_TRANSIT');
});

test('external lookup registers supplied tracking without purchasing a label and reuses stored registration', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => { requests.push({ url: String(url), init: init! }); return response(); }) as typeof fetch;
  await lookupEasyPostTracking(reference, { env: testEnv, fetchImpl });
  await lookupEasyPostTracking({ ...reference, providerTrackingId: 'trk_sanitized', providerMode: 'test' }, { env: testEnv, fetchImpl });
  assert.equal(requests[0].url, 'https://api.easypost.com/v2/trackers');
  assert.equal(requests[0].init.method, 'POST');
  assert.equal(requests[0].init.redirect, 'error');
  assert.deepEqual(JSON.parse(requests[0].init.body as string), { tracker: { tracking_code: reference.reference, carrier: 'USPS' } });
  assert.equal(requests[1].url, 'https://api.easypost.com/v2/trackers/trk_sanitized');
  assert.equal(requests[1].init.method, 'GET');
});

test('freight identifiers, supplier references, arbitrary URLs and unknown carriers never enter parcel API', async () => {
  let called = false;
  const fetchImpl = (async () => { called = true; return response(); }) as typeof fetch;
  for (const invalid of [{ referenceType: 'FREIGHT_PRO' }, { referenceType: 'BILL_OF_LADING' }, { referenceType: 'SUPPLIER_ORDER' }, { carrier: 'GFS' }, { carrier: null }, { reference: 'https://internal.example/secret' }, { providerTrackingId: '../tokens' }]) {
    await assert.rejects(lookupEasyPostTracking({ ...reference, ...invalid }, { env: testEnv, fetchImpl }), SupplyTrackingError);
  }
  assert.equal(called, false);
});

test('provider retry is bounded and respects Retry-After without losing last stored information', async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const fetchImpl = (async () => ++calls === 1 ? new Response('', { status: 429, headers: { 'retry-after': '3' } }) : response()) as typeof fetch;
  await lookupEasyPostTracking(reference, { env: testEnv, fetchImpl, sleep: async ms => { sleeps.push(ms); } });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [3000]);
  calls = 0;
  await assert.rejects(lookupEasyPostTracking(reference, { env: testEnv, fetchImpl: (async () => { calls++; return new Response('', { status: 503 }); }) as typeof fetch, sleep: async () => {} }), error => error instanceof SupplyTrackingError && error.temporary);
  assert.equal(calls, 3);
});

test('wrong mode or mismatched provider tracking number cannot overwrite a shipment', async () => {
  await assert.rejects(lookupEasyPostTracking(reference, { env: testEnv, fetchImpl: (async () => response({ mode: 'production' })) as typeof fetch }), /wrong credential mode/);
  await assert.rejects(lookupEasyPostTracking(reference, { env: testEnv, fetchImpl: (async () => response({ tracking_code: 'wrong-number' })) as typeof fetch }), /different shipment reference/);
});

const path = '/api/production-supplies/tracking/webhook';
function signed(body: string, timestamp = now.toUTCString(), signedPath = path) {
  const signature = createHmac('sha256', testEnv.EASYPOST_WEBHOOK_SECRET).update(`${timestamp}POST${signedPath}${body}`).digest('hex');
  return new Headers({ 'x-timestamp': timestamp, 'x-path': signedPath, 'x-hmac-signature-v2': `hmac-sha256-hex=${signature}` });
}
test('webhook HMAC v2 authenticates exact body, path and fresh timestamp', () => {
  const body = '{"example":true}';
  assert.doesNotThrow(() => verifyEasyPostWebhook(body, signed(body), path, testEnv, now));
  assert.throws(() => verifyEasyPostWebhook(body + ' ', signed(body), path, testEnv, now), /authentication failed/);
  assert.throws(() => verifyEasyPostWebhook(body, signed(body), '/another-path', testEnv, now), /authentication failed/);
  assert.throws(() => verifyEasyPostWebhook(body, signed(body, new Date(now.getTime() - 61_000).toUTCString()), path, testEnv, now), /authentication failed/);
  assert.throws(() => verifyEasyPostWebhook(body, signed(body, new Date(now.getTime() + 31_000).toUTCString()), path, testEnv, now), /authentication failed/);
  assert.throws(() => verifyEasyPostWebhook(body, new Headers(), path, testEnv, now), /authentication failed/);
});

function fakeDb(initial: Record<string, unknown> = {}) {
  let watched = true;
  const shipment = { id: 'shipment-one', organizationId: 'tenant-one', ...reference, orderId: 'order-one', status: 'IN_TRANSIT', statusEventAt: new Date('2026-11-11T10:00:00Z'), lastCheckedAt: null as Date | null, failureCount: 0,
    leaseId: null as string | null, leaseUntil: null, providerTrackingId: null, providerMode: null, returnedAt: null, deliveredAt: null, arrivalEstimates: [] as Record<string, unknown>[], ...initial };
  const observations: Record<string, unknown>[] = [];
  const estimates: Record<string, unknown>[] = [];
  const notifications: Record<string, unknown>[] = [];
  const calls: string[] = [];
  const matches = (where: Record<string, unknown>) => where.organizationId === shipment.organizationId && where.id === shipment.id && (!where.leaseId || where.leaseId === shipment.leaseId);
  const db = {
    organizationFeature: { findFirst: async () => ({ id: 'entitlement' }) },
    supplyNeed: { findMany: async () => watched ? [{ id: 'need-one', description: 'Fixture material', location: 'Location unknown', unit: 'ea', source: 'DISTILLX5_EMAIL', catalogItemId: 'catalog-one', latestWarningAt: now, resolvedAt: null, warnings: [], allocations: [], catalogItem: { id: 'catalog-one', name: 'Fixture material', confirmed: true, sharedUse: false, departments: ['PRODUCTION'], aliases: [], rules: [] } }] : [] },
    supplyClassificationRule: { findMany: async () => [] },
    supplyCatalogItem: { findMany: async () => [{ id: 'catalog-one', name: 'Fixture material', confirmed: true, sharedUse: false, departments: ['PRODUCTION'], aliases: [], rules: [] }] },
    supplyOrder: { findFirst: async ({ where }: { where: { organizationId: string; id: string } }) => where.organizationId === shipment.organizationId && where.id === shipment.orderId ? { id: shipment.orderId, supplier: 'Fixture supplier', destination: null, ignored: false, lines: [{ description: 'Fixture material', catalogItemId: 'catalog-one', ignored: false, unit: 'ea', allocations: [{ needId: 'need-one' }] }] } : null },
    $executeRaw: async () => 1,
    supplyShipment: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => matches(where) ? shipment : null,
      findMany: async () => [],
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => { if (!matches(where)) return { count: 0 }; calls.push('shipment'); Object.assign(shipment, data); return { count: 1 }; },
    },
    supplyTrackingObservation: { findUnique: async ({ where }: { where: { organizationId_shipmentId_eventKey: { eventKey: string } } }) => observations.find(item => item.eventKey === where.organizationId_shipmentId_eventKey.eventKey) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { calls.push('observation'); observations.push(data); return data; } },
    supplyArrivalEstimate: { updateMany: async () => { calls.push('supersede-carrier'); return { count: 1 }; }, create: async ({ data }: { data: Record<string, unknown> }) => { estimates.push(data); return data; } },
    supplyNotification: { upsert: async ({ create }: { create: Record<string, unknown> }) => { notifications.push(create); return create; } },
  };
  return { db: { ...db, $transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db) } as unknown as PrismaClient, shipment, observations, estimates, notifications, calls, removeWatch: () => { watched = false; } };
}

test('new ETA persists alongside supplier promise; delivered never confirms receipt or resolves needs', async () => {
  const fake = fakeDb({ arrivalEstimates: [{ source: 'SUPPLIER_PROMISE', startDate: '2026-11-13', current: true }] });
  const observation = parseEasyPostObservation(fixture({ mode: 'production', status: 'delivered' }), { observedAt: now });
  const result = await persistSupplyTrackingObservation('tenant-one', 'shipment-one', observation, fake.db);
  assert.equal(result.status, 'updated');
  assert.equal(fake.shipment.status, 'DELIVERED');
  assert.equal(fake.estimates[0].startDate, '2026-11-14');
  assert.equal(fake.shipment.arrivalEstimates[0].source, 'SUPPLIER_PROMISE');
  assert.equal(fake.shipment.arrivalEstimates[0].startDate, '2026-11-13');
  assert.equal(fake.notifications.length, 1);
  assert.match(String(fake.notifications[0].body), /original promise remains/);
  // No need, receipt or inventory delegate exists in this mock: an accidental write would fail.
});

test('old webhook remains evidence without regressing current ETA or status; duplicate execution is idempotent', async () => {
  const fake = fakeDb({ status: 'OUT_FOR_DELIVERY', statusEventAt: new Date('2026-11-13T10:00:00Z') });
  const observation = parseEasyPostObservation(fixture(), { observedAt: now, eventKey: 'evt_old' });
  assert.equal((await persistSupplyTrackingObservation('tenant-one', 'shipment-one', observation, fake.db)).status, 'stale');
  assert.equal((await persistSupplyTrackingObservation('tenant-one', 'shipment-one', observation, fake.db)).status, 'stale');
  assert.equal(fake.observations.length, 1);
  assert.equal(fake.shipment.status, 'OUT_FOR_DELIVERY');
  assert.equal(fake.estimates.length, 0);
  assert.equal(fake.notifications.length, 0);
});

test('initial historical tracking updates populate evidence without flooding delivery notifications', async () => {
  const fake = fakeDb({ order: { sources: [{ sourceId: 'historical-source' }] } });
  const result = await persistSupplyTrackingObservation('tenant-one', 'shipment-one', parseEasyPostObservation(fixture({ mode: 'production', status: 'delivered' }), { observedAt: now }), fake.db);
  assert.equal(result.status, 'updated');
  assert.equal(fake.observations.length, 1);
  assert.equal(fake.shipment.status, 'DELIVERED');
  assert.equal(fake.notifications.length, 0);
});

test('provider withdrawal of an ETA supersedes its current estimate, retaining history', async () => {
  const fake = fakeDb({ arrivalEstimates: [{ source: 'CARRIER', startDate: '2026-11-14' }] });
  const result = await persistSupplyTrackingObservation('tenant-one', 'shipment-one', parseEasyPostObservation(fixture({ carrier_detail: null, est_delivery_date: null }), { observedAt: now }), fake.db);
  assert.equal(result.status, 'updated');
  assert.ok(fake.calls.includes('supersede-carrier'));
  assert.equal(fake.estimates.length, 0);
});

test('tenant-scoped worker refuses foreign shipment and manual refresh is persisted/rate-limited', async () => {
  const fake = fakeDb({ lastCheckedAt: now });
  await assert.rejects(refreshSupplyShipmentTracking('tenant-two', 'shipment-one', fake.db, { manual: true, now }), /not found/);
  assert.equal((await refreshSupplyShipmentTracking('tenant-one', 'shipment-one', fake.db, { manual: true, now })).status, 'rate_limited');
  assert.equal(fake.calls.length, 0);
});

test('temporary outage leaves previous valid ETA/status and schedules bounded retry', async () => {
  const fake = fakeDb({ arrivalEstimates: [{ source: 'CARRIER', startDate: '2026-11-14' }] });
  const result = await refreshSupplyShipmentTracking('tenant-one', 'shipment-one', fake.db, { manual: true, now, env: testEnv, fetchImpl: (async () => { throw new Error('offline'); }) as typeof fetch, sleep: async () => {} });
  assert.equal(result.status, 'failed');
  assert.equal(fake.shipment.status, 'IN_TRANSIT');
  assert.equal(fake.shipment.arrivalEstimates[0].startDate, '2026-11-14');
  assert.equal(fake.shipment.failureCount, 1);
  assert.equal(fake.shipment.leaseId, null);
});

test('unwatched retained shipment cannot register or query a provider and retains its existing evidence', async () => {
  const fake = fakeDb({ arrivalEstimates: [{ source: 'CARRIER', startDate: '2026-11-14' }] });
  fake.removeWatch();
  const result = await refreshSupplyShipmentTracking('tenant-one', 'shipment-one', fake.db, { manual: true, now, env: testEnv, fetchImpl: (async () => { assert.fail('unwatched references never reach tracking registration'); }) as typeof fetch });
  assert.equal(result.status, 'out_of_scope');
  assert.equal(fake.shipment.arrivalEstimates.length, 1);
  assert.equal(fake.calls.length, 0);
});

test('scope removal while provider request is in flight blocks observation, ETA and notification persistence', async () => {
  const fake = fakeDb();
  const result = await refreshSupplyShipmentTracking('tenant-one', 'shipment-one', fake.db, { manual: true, now, env: testEnv, fetchImpl: (async () => { fake.removeWatch(); return response(); }) as typeof fetch });
  assert.equal(result.status, 'out_of_scope');
  assert.equal(fake.shipment.status, 'IN_TRANSIT');
  assert.equal(fake.shipment.leaseId, null);
  assert.equal(fake.observations.length, 0);
  assert.equal(fake.estimates.length, 0);
  assert.equal(fake.notifications.length, 0);
});

test('webhook authenticates before database access and ignores unmapped tracker payload tenant claims', async () => {
  const fake = fakeDb();
  await assert.rejects(handleSupplyTrackingWebhook('{}', new Headers(), path, fake.db, testEnv, now), /authentication failed/);
  const body = JSON.stringify({ id: 'evt_sanitized', object: 'Event', description: 'tracker.updated', mode: 'test', result: fixture(), organizationId: 'attacker-tenant' });
  assert.deepEqual(await handleSupplyTrackingWebhook(body, signed(body), path, fake.db, testEnv, now), { accepted: true });
  assert.equal(fake.observations.length, 0);
});

test('polling reduces after delivery, stops returns/cancellation and backs off outages', () => {
  assert.equal(nextTrackingCheck('RETURNED', 0, now), null);
  assert.equal(nextTrackingCheck('CANCELLED', 0, now), null);
  assert.equal(nextTrackingCheck('DELIVERED', 0, now)?.getTime(), now.getTime() + 24 * 60 * 60_000);
  assert.equal(nextTrackingCheck('OUT_FOR_DELIVERY', 0, now)?.getTime(), now.getTime() + 60 * 60_000);
  assert.equal(nextTrackingCheck('IN_TRANSIT', 10, now)?.getTime(), now.getTime() + 24 * 60 * 60_000);
});
