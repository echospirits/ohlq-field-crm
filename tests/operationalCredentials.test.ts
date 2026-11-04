import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { getOperationalSignalConfiguration, getOrganizationOperationalCredentials, openDockConfiguration, operationalCredentialKeyStatus, saveOrganizationOperationalCredentials } from '../lib/productionForecasting/operationalSignals/credentials';

const originalKey = process.env.OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY;
const originalDedicatedKey = process.env.PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY;
afterEach(() => {
  if (originalDedicatedKey === undefined) delete process.env.PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY;
  else process.env.PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY = originalDedicatedKey;
  if (originalKey === undefined) delete process.env.OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY;
  else process.env.OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY = originalKey;
});
const configured = { productionForecasting: { operationalSignals: { opendock: { verifiedAt: '2026-11-03T12:00:00Z', locations: [
  { market: 'OH', locationCode: 'GPT', locationName: 'Groveport', warehouseId: '11111111-1111-4111-8111-111111111111', loadTypeId: '33333333-3333-4333-8333-333333333333', timezone: 'America/New_York' },
  { market: 'OH', locationCode: 'GRN', locationName: 'Green', warehouseId: '22222222-2222-4222-8222-222222222222', loadTypeId: '44444444-4444-4444-8444-444444444444', timezone: 'America/New_York' },
] } } } };
function fixture({ entitled = true, ohio = true } = {}) {
  let row: Record<string, unknown> | null = null, reads = 0;
  const db = {
    organization: { findFirst: async () => entitled ? { id: 'org_echo_spirits', enabledStates: ohio ? ['OH'] : [], settings: configured, timezone: 'America/New_York' } : null },
    organizationOperationalCredential: {
      upsert: async ({ create }: { create: Record<string, unknown> }) => { row = create; return { configuredAt: create.configuredAt, usernameHint: create.usernameHint }; },
      findUnique: async ({ where }: { where: { organizationId_provider: { organizationId: string; provider: string } } }) => { reads++; assert.equal(where.organizationId_provider.organizationId, 'org_echo_spirits'); assert.equal(where.organizationId_provider.provider, 'OPENDOCK'); return row; },
    },
  } as unknown as PrismaClient;
  return { db, get row() { return row; }, replace(value: Record<string, unknown>) { row = value; }, get reads() { return reads; } };
}
function strongKey() { delete process.env.PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY; process.env.OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY = 'unit-test-operational-key-over-thirty-two-characters'; }

test('operational provider credentials are encrypted, safely summarized, and tenant scoped', async () => {
  strongKey();
  const f = fixture();
  const saved = await saveOrganizationOperationalCredentials({ db: f.db, organizationId: 'org_echo_spirits', provider: 'OPENDOCK', username: 'example@example.com', password: 'test-only-open-dock-password' });
  assert.equal(saved.usernameHint, 'ex***@example.com');
  assert.equal(JSON.stringify(saved).includes('Encrypted'), false);
  assert.notEqual(f.row!.usernameEncrypted, 'example@example.com');
  assert.notEqual(f.row!.passwordEncrypted, 'test-only-open-dock-password');
  assert.deepEqual(await getOrganizationOperationalCredentials('org_echo_spirits', 'OPENDOCK', f.db), { email: 'example@example.com', password: 'test-only-open-dock-password' });
  const status = await getOperationalSignalConfiguration('org_echo_spirits', f.db);
  assert.equal(status.opendock.credentials.configured, true);
  assert.equal(status.opendock.configured, true);
  assert.equal(JSON.stringify(status).includes('test-only-open-dock-password'), false);
  assert.equal(JSON.stringify(status).includes(String(f.row!.passwordEncrypted)), false);
  const reads = f.reads;
  await assert.rejects(getOrganizationOperationalCredentials('foreign', 'OPENDOCK', f.db), /restricted to Echo/);
  await assert.rejects(saveOrganizationOperationalCredentials({ db: f.db, organizationId: 'foreign', provider: 'OPENDOCK', username: 'other@example.com', password: 'private' }), /restricted to Echo/);
  assert.equal(f.reads, reads);
});

test('authenticated encryption rejects swapped fields, ciphertext changes, and the wrong key', async () => {
  strongKey();
  const f = fixture();
  await saveOrganizationOperationalCredentials({ db: f.db, organizationId: 'org_echo_spirits', provider: 'OPENDOCK', username: 'example@example.com', password: 'test-private-password' });
  const original = { ...f.row! };
  f.replace({ ...original, usernameEncrypted: original.passwordEncrypted });
  await assert.rejects(getOrganizationOperationalCredentials('org_echo_spirits', 'OPENDOCK', f.db), /could not be decrypted/);
  f.replace({ ...original, passwordEncrypted: String(original.passwordEncrypted).slice(0, -2) + 'XX' });
  await assert.rejects(getOrganizationOperationalCredentials('org_echo_spirits', 'OPENDOCK', f.db), /could not be decrypted/);
  f.replace(original);
  process.env.OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY = 'different-unit-test-key-over-thirty-two-characters';
  await assert.rejects(getOrganizationOperationalCredentials('org_echo_spirits', 'OPENDOCK', f.db), /could not be decrypted/);
});

test('credential storage requires the existing entitlement, enabled market and encryption key', async () => {
  strongKey();
  for (const f of [fixture({ entitled: false }), fixture({ ohio: false })]) {
    await assert.rejects(getOrganizationOperationalCredentials('org_echo_spirits', 'OPENDOCK', f.db), /unavailable/);
    assert.equal(f.reads, 0);
  }
  process.env.OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY = 'too-short';
  await assert.rejects(saveOrganizationOperationalCredentials({ db: fixture().db, organizationId: 'org_echo_spirits', provider: 'OPENDOCK', username: 'example@example.com', password: 'private' }), /at least 32 characters/);
});

test('OpenDock mappings require distinct verified warehouses, valid delivery types and explicit calendar coverage', () => {
  assert.equal(openDockConfiguration(null).configured, false);
  assert.equal(openDockConfiguration(configured).configured, true);
  const changed = structuredClone(configured);
  changed.productionForecasting.operationalSignals.opendock.locations[1].warehouseId = changed.productionForecasting.operationalSignals.opendock.locations[0].warehouseId;
  assert.equal(openDockConfiguration(changed).configured, false);
  const invalid = structuredClone(configured);
  invalid.productionForecasting.operationalSignals.opendock.locations[0].timezone = 'not/a-timezone';
  assert.equal(openDockConfiguration(invalid).configured, false);
  const badCalendar = structuredClone(configured) as typeof configured & { productionForecasting: { operationalSignals: { opendock: { locations: Array<Record<string, unknown>> } } } };
  badCalendar.productionForecasting.operationalSignals.opendock.locations[0].calendar = { coveredFrom: '2026-02-30', coveredThrough: '2026-11-30', openWeekdays: [1,2,3,4,5], closedDates: [] };
  assert.equal(openDockConfiguration(badCalendar).configured, false);
});


test('dedicated operational key works independently from the OPS runner key', async () => {
  delete process.env.OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY;
  process.env.PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY = 'dedicated-test-open-dock-key-over-thirty-two-characters';
  const f = fixture();
  await saveOrganizationOperationalCredentials({ db: f.db, organizationId: 'org_echo_spirits', provider: 'OPENDOCK', username: 'example@example.com', password: 'dedicated-test-password' });
  process.env.OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY = 'different-test-ops-key-over-thirty-two-characters';
  assert.deepEqual(await getOrganizationOperationalCredentials('org_echo_spirits', 'OPENDOCK', f.db), { email: 'example@example.com', password: 'dedicated-test-password' });
  delete process.env.PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY;
  await assert.rejects(getOrganizationOperationalCredentials('org_echo_spirits', 'OPENDOCK', f.db), /could not be decrypted/);
});

test('malformed dedicated keys fail closed despite a valid legacy fallback', async () => {
  strongKey();
  for (const invalid of ['', 'short', '                              ']) {
    process.env.PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY = invalid;
    await assert.rejects(saveOrganizationOperationalCredentials({ db: fixture().db, organizationId: 'org_echo_spirits', provider: 'OPENDOCK', username: 'example@example.com', password: 'private' }), /PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY must contain at least 32 characters/);
  }
  delete process.env.PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY;
  delete process.env.OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY;
  await assert.rejects(saveOrganizationOperationalCredentials({ db: fixture().db, organizationId: 'org_echo_spirits', provider: 'OPENDOCK', username: 'example@example.com', password: 'private' }), /Configure PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY/);
});


test('encryption readiness exposes names and booleans only with the exact encryption preference', async () => {
  delete process.env.PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY;
  delete process.env.OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY;
  assert.deepEqual(operationalCredentialKeyStatus(), { configured: false, keyVariable: 'OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY' });
  const legacyValue = 'private-test-legacy-key-over-thirty-two-characters';
  const dedicatedValue = 'private-test-dedicated-key-over-thirty-two-characters';
  process.env.OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY = legacyValue;
  assert.deepEqual(operationalCredentialKeyStatus(), { configured: true, keyVariable: 'OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY' });
  process.env.PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY = dedicatedValue;
  assert.deepEqual(operationalCredentialKeyStatus(), { configured: true, keyVariable: 'PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY' });
  const configuredStatus = await getOperationalSignalConfiguration('org_echo_spirits', fixture().db);
  assert.deepEqual(configuredStatus.opendock.encryption, operationalCredentialKeyStatus());
  assert.equal(JSON.stringify(configuredStatus).includes(legacyValue), false);
  assert.equal(JSON.stringify(configuredStatus).includes(dedicatedValue), false);
  assert.deepEqual(Object.keys(configuredStatus.opendock.encryption).sort(), ['configured','keyVariable']);
  for (const invalid of ['', 'short', '                                ']) {
    process.env.PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY = invalid;
    assert.deepEqual(operationalCredentialKeyStatus(), { configured: false, keyVariable: 'PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY' });
    assert.equal((await getOperationalSignalConfiguration('org_echo_spirits', fixture().db)).opendock.encryption.configured, false);
  }
});
