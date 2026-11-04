import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { UserRole, type PrismaClient } from '@prisma/client';
import { checkManualDeliveryAvailability, type ManualDeliveryServices } from '../lib/productionForecasting/operationalSignals/manualDelivery';
import { requireOperationalSignalOrganization } from '../lib/productionForecasting/operationalSignals/credentials';
import type { DeliveryAvailabilityResult, OpenDockLocationConfig } from '../lib/productionForecasting/operationalSignals/types';

const at = new Date('2026-11-04T13:00:00Z');
const locations: OpenDockLocationConfig[] = [
  { market: 'OH', locationCode: 'GPT', locationName: 'Groveport', warehouseId: '11111111-1111-4111-8111-111111111111', loadTypeId: '33333333-3333-4333-8333-333333333333', timezone: 'America/New_York' },
  { market: 'OH', locationCode: 'GRN', locationName: 'Green', warehouseId: '22222222-2222-4222-8222-222222222222', loadTypeId: '44444444-4444-4444-8444-444444444444', timezone: 'America/New_York' },
];
const settings = { productionForecasting: { operationalSignals: { opendock: { verifiedAt: '2026-11-04T12:00:00Z', locations } } } };
const secret = 'test-only-private-provider-value';
function result(location: OpenDockLocationConfig, status: DeliveryAvailabilityResult['status'] = 'SUCCESS'): DeliveryAvailabilityResult {
  const good = status === 'SUCCESS';
  return { market: location.market, locationCode: location.locationCode, locationName: location.locationName, warehouseId: location.warehouseId, loadTypeId: location.loadTypeId, timezone: location.timezone,
    observedAt: at.toISOString(), source: 'OPENDOCK', status, diagnosticCode: null,
    earliestAvailableAt: good ? '2026-11-10T14:00:00Z' : null, calendarDays: good ? 6 : null,
    businessDays: null, businessDayMethod: null, checkedThrough: good || status === 'NO_AVAILABILITY' ? '2026-12-04T13:00:00Z' : null };
}
function fixture({ role = UserRole.ADMIN, organizationId = 'org_echo_spirits', configured = true, entitled = true }: {
  role?: UserRole; organizationId?: string; configured?: boolean; entitled?: boolean;
} = {}) {
  const calls = { admin: 0, context: 0, organization: 0, credentials: 0, client: 0, observed: 0 };
  const requests: string[] = [], records: DeliveryAvailabilityResult[] = [];
  const facts = new Map<string, DeliveryAvailabilityResult>();
  const db = { organization: { findFirst: async () => entitled ? { id: 'org_echo_spirits', enabledStates: ['OH'], settings: configured ? settings : {}, timezone: 'America/New_York' } : null } } as unknown as PrismaClient;
  const services: ManualDeliveryServices = {
    admin: async () => { calls.admin++; return { id: 'actor', role, organizationId }; },
    context: async () => { calls.context++; return { organizationId }; },
    organization: async id => { calls.organization++; return requireOperationalSignalOrganization(id, db); },
    credentials: async () => { calls.credentials++; return { email: 'authorized@example.test', password: secret }; },
    observed: async (_id, location) => { calls.observed++; return facts.has(location.locationCode); },
    client: () => { calls.client++; return { availability: async location => { requests.push(location.locationCode); return result(location); } }; },
    record: async (_id, observation) => {
      records.push(observation);
      if (['SUCCESS', 'NO_AVAILABILITY'].includes(observation.status) && !facts.has(observation.locationCode)) facts.set(observation.locationCode, observation);
    },
  };
  const run = (overrides: Partial<ManualDeliveryServices> = {}) => checkManualDeliveryAvailability({ services: { ...services, ...overrides }, now: () => at });
  return { calls, services, requests, records, facts, run };
}

test('manual delivery capture rejects non-admins, foreign tenants and missing entitlement before provider access', async () => {
  const denied = fixture({ role: UserRole.USER });
  await assert.rejects(denied.run(), /Administrator access required/);
  assert.equal(denied.calls.context, 0);
  for (const f of [fixture({ organizationId: 'foreign' }), fixture({ entitled: false })]) {
    await assert.rejects(f.run(), /restricted to Echo|unavailable/);
    assert.equal(f.calls.credentials, 0); assert.equal(f.calls.client, 0); assert.deepEqual(f.requests, []);
  }
  const redirected = fixture();
  await assert.rejects(redirected.run({ admin: async () => { throw Error('Login required.'); } }), /Login required/);
  assert.equal(redirected.calls.context, 0);
});

test('unverified configuration causes no credential read, external request or observation write', async () => {
  const f = fixture({ configured: false });
  assert.deepEqual(await f.run(), { status: 'not-configured', observed: 0, reused: 0, warehouses: [] });
  assert.equal(f.calls.credentials, 0); assert.equal(f.calls.observed, 0); assert.equal(f.calls.client, 0); assert.deepEqual(f.records, []);
});

test('manual first capture stores both independent warehouses and a duplicate action reuses daily facts without credentials or requests', async () => {
  const f = fixture();
  const first = await f.run();
  assert.equal(first.status, 'complete'); assert.equal(first.observed, 2); assert.equal(first.reused, 0);
  assert.deepEqual(f.requests.sort(), ['GPT', 'GRN']);
  const before = JSON.stringify([...f.facts]);
  const second = await f.run();
  assert.equal(second.status, 'complete'); assert.equal(second.observed, 0); assert.equal(second.reused, 2);
  assert.equal(f.calls.credentials, 1); assert.equal(f.requests.length, 2); assert.equal(f.records.length, 2);
  assert.equal(JSON.stringify([...f.facts]), before);
  assert.ok(!JSON.stringify([first, second]).includes(secret));
});

test('one failed warehouse persists its check without suppressing success; retry reuses the successful daily observation', async () => {
  const f = fixture();
  let fail = true;
  const client: ManualDeliveryServices['client'] = () => ({ availability: async location => {
    f.requests.push(location.locationCode);
    return result(location, location.locationCode === 'GRN' && fail ? 'AUTH_FAILED' : 'SUCCESS');
  } });
  const partial = await f.run({ client });
  assert.equal(partial.status, 'partial'); assert.equal(partial.observed, 1);
  assert.deepEqual(f.records.map(value => [value.locationCode, value.status]).sort(), [['GPT', 'SUCCESS'], ['GRN', 'AUTH_FAILED']]);
  assert.equal(f.facts.size, 1);
  const saved = f.facts.get('GPT');
  fail = false;
  const recovered = await f.run({ client });
  assert.equal(recovered.status, 'complete'); assert.equal(recovered.reused, 1); assert.equal(recovered.observed, 1);
  assert.equal(f.requests.length, 3); assert.equal(f.facts.get('GPT'), saved); assert.equal(f.facts.size, 2);
});

test('provider exceptions and failed writes are sanitized and remain independent per warehouse', async () => {
  for (const failure of ['provider', 'persistence'] as const) {
    const f = fixture();
    const outcome = await f.run({
      client: () => ({ availability: async location => { if (failure === 'provider' && location.locationCode === 'GPT') throw Error(secret); return result(location); } }),
      record: async (id, observation) => { if (failure === 'persistence' && observation.locationCode === 'GPT' && observation.status === 'SUCCESS') throw Error(secret); return f.services.record(id, observation); },
    });
    assert.equal(outcome.status, 'partial'); assert.equal(outcome.observed, 1);
    assert.equal(f.records.find(value => value.locationCode === 'GPT')?.status, 'UNAVAILABLE');
    assert.equal(f.facts.get('GRN')?.status, 'SUCCESS');
    assert.ok(!JSON.stringify([outcome, f.records]).includes(secret));
  }
});

test('missing or unreadable server credentials persist safe checks without calling OpenDock', async () => {
  for (const missing of [true, false]) {
    const f = fixture();
    const outcome = await f.run({ credentials: async () => { if (missing) return null; throw Error(secret); } });
    assert.equal(outcome.status, missing ? 'not-configured' : 'failed');
    assert.equal(f.calls.client, 0); assert.deepEqual(f.requests, []);
    assert.equal(f.records.length, 2);
    assert.ok(f.records.every(value => value.status === (missing ? 'NOT_CONFIGURED' : 'AUTH_FAILED') && value.calendarDays === null));
    assert.ok(!JSON.stringify([outcome, f.records]).includes(secret));
  }
});

test('daily lookup failure does not issue an untracked provider request, while the other warehouse can succeed', async () => {
  const f = fixture();
  const outcome = await f.run({ observed: async (_id, location) => { if (location.locationCode === 'GPT') throw Error(secret); return false; } });
  assert.equal(outcome.status, 'partial');
  assert.deepEqual(f.requests, ['GRN']);
  assert.equal(f.records.find(value => value.locationCode === 'GPT')?.diagnosticCode, 'OPENDOCK_DAILY_LOOKUP_FAILED');
  assert.ok(!JSON.stringify(outcome).includes(secret));
});

test('qualified no-availability snapshots are successful checks and remain unknown rather than zero', async () => {
  const f = fixture();
  const outcome = await f.run({ client: () => ({ availability: async location => result(location, 'NO_AVAILABILITY') }) });
  assert.equal(outcome.status, 'complete'); assert.equal(outcome.observed, 2);
  assert.ok(f.records.every(value => value.calendarDays === null && value.earliestAvailableAt === null));
});

test('the settings action uses the guarded delivery-only helper; render never initiates provider checks', () => {
  const helper = readFileSync(new URL('../lib/productionForecasting/operationalSignals/manualDelivery.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(helper, /from ['"][^'"]*(?:demandIngestion|sourceWorkflow|operationalSignals\/workflow)['"]/);
  const action = readFileSync(new URL('../app/analytics/production/settings/actions.ts', import.meta.url), 'utf8');
  assert.match(action, /export async function checkOpenDockAvailability\(\)/);
  assert.match(action, /await checkManualDeliveryAvailability\(\)/);
  const page = readFileSync(new URL('../app/analytics/production/settings/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /form action=\{checkOpenDockAvailability\}/);
  assert.doesNotMatch(page, /checkManualDeliveryAvailability\(|\.availability\(/);
});
