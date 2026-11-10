import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import { parseEnvironmentFile } from '../lib/environmentFile';

export const FORECAST_REFRESH_MIGRATION = '20261110020000_production_forecast_refresh_requests';
export const REVIEWED_FORECAST_REFRESH_CHECKSUM = 'b3acd625790e4081e36b80ff94d5633b86f49ebd64ef7033366cb17d35972753';
export const FORECAST_REFRESH_LIVE_HOSTS = {
  'neon-ohlq-field-crm-prod': 'ep-proud-recipe-amosj8m9.c-5.us-east-1.aws.neon.tech',
  'neon-neat-tst': 'ep-noisy-dew-avchokwr.c-11.us-east-1.aws.neon.tech',
} as const;
const table = 'ProductionForecastRefreshRequest';
const directHost = (value: string) => value.replace('-pooler.', '.');
const argument = (args: readonly string[], name: string) => {
  const values = args.filter(value => value.startsWith(`--${name}=`));
  if (values.length > 1) throw Error('Duplicate operator arguments are not allowed.');
  return values[0]?.slice(name.length + 3);
};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Explicit live targets and separately verified clone hosts cannot interchange. */
export function forecastRefreshMigrationConfiguration(args: readonly string[], contents: string) {
  const host = argument(args, 'expected-host'), target = argument(args, 'expected-target');
  if (!argument(args, 'env-file') || !host || !target || !Object.hasOwn(FORECAST_REFRESH_LIVE_HOSTS, target)) throw Error('Provide explicit env-file, expected-host and a reviewed expected-target.');
  const entries = parseEnvironmentFile(contents), config = Object.fromEntries(entries);
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw Error('Duplicate environment keys are not allowed.');
  const environment = target === 'neon-ohlq-field-crm-prod' ? 'production' : 'test';
  if (config.APP_ENV !== environment || config.DATABASE_ENVIRONMENT !== environment || config.DATABASE_TARGET_ID !== target || config.EXPECTED_DATABASE_HOST !== host || config.EXPECTED_DATABASE_TARGET && config.EXPECTED_DATABASE_TARGET !== target) throw Error('Explicit resource labels do not match the reviewed environment.');
  const configured = new URL(config.DATABASE_URL), connection = new URL(config.DIRECT_URL || config.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(configured.protocol) || !['postgres:', 'postgresql:'].includes(connection.protocol) || !host.endsWith('.neon.tech') || configured.hostname !== host || connection.hostname !== directHost(host) || connection.pathname !== configured.pathname || connection.username !== configured.username || connection.password !== configured.password || connection.port !== configured.port || !connection.username || !connection.password || connection.searchParams.get('sslmode') === 'disable') throw Error('A matching direct, unpooled connection identity is required.');
  const rehearsal = args.includes('--rehearsal'), unpooled = directHost(host);
  const live = FORECAST_REFRESH_LIVE_HOSTS[target as keyof typeof FORECAST_REFRESH_LIVE_HOSTS];
  if (rehearsal ? Object.values(FORECAST_REFRESH_LIVE_HOSTS).some(value => value === unpooled) : unpooled !== live) throw Error('Live and isolated rehearsal hosts cannot be interchanged.');
  const mode = argument(args, 'mode') ?? 'check', apply = args.includes('--apply'), verifyConstraints = args.includes('--verify-constraints');
  if (!['migrate', 'check'].includes(mode)) throw Error('Choose only migrate or check.');
  if (apply && argument(args, 'checksum') !== REVIEWED_FORECAST_REFRESH_CHECKSUM) throw Error('Mutations require the exact reviewed checksum.');
  if (verifyConstraints && (!rehearsal || !apply)) throw Error('Constraint probes require explicit rehearsal, apply and checksum.');
  if (mode === 'check' && apply && !verifyConstraints) throw Error('Read-only checks do not accept apply without explicit rehearsal probes.');
  return { config, connection, host, target, environment, rehearsal, apply, verifyConstraints, mode: mode as 'migrate' | 'check' };
}

export function forecastRefreshMigrationStatements(sql: string) {
  const normalized = sql.replace(/\r\n/g, '\n');
  if (createHash('sha256').update(normalized).digest('hex') !== REVIEWED_FORECAST_REFRESH_CHECKSUM) throw Error('Migration differs from the exact reviewed SQL.');
  const statements = normalized.replace(/^\s*--.*$/gm, '').split(';').map(value => value.trim()).filter(Boolean);
  if (statements.length !== 7 || !/^CREATE UNIQUE INDEX IF NOT EXISTS "User_organizationId_id_key" ON "User"\("organizationId", "id"\)$/.test(statements[0]) || statements.slice(1).some(value => !/^(?:CREATE TABLE "ProductionForecastRefreshRequest"|CREATE (?:UNIQUE )?INDEX "forecast_refresh_[a-z_]+" ON "ProductionForecastRefreshRequest"|ALTER TABLE "ProductionForecastRefreshRequest" ADD CONSTRAINT "forecast_refresh_[a-z_]+")/.test(value))) throw Error('Only the reviewed new table and compatible User identity index may change.');
  return statements;
}

export function forecastRefreshMigrationState(tables: readonly string[], ledger: ReadonlyArray<{ checksum: string; finished_at: unknown; rolled_back_at: unknown }>, checksum = REVIEWED_FORECAST_REFRESH_CHECKSUM) {
  if (checksum !== REVIEWED_FORECAST_REFRESH_CHECKSUM) throw Error('Unexpected migration checksum.');
  if (!tables.length && !ledger.length) return 'unapplied' as const;
  if (tables.length !== 1 || tables[0] !== table || ledger.length !== 1 || ledger[0].checksum !== checksum || !ledger[0].finished_at || ledger[0].rolled_back_at !== null) throw Error('Request table and its own migration ledger do not match. No unrelated drift is reconciled.');
  return 'applied' as const;
}

export type RefreshMigrationIndex = { name: string; table: string; unique: boolean; valid: boolean; ready: boolean; partial: boolean; expressions: boolean; columns: string[] };
const expectedIndexes = [
  { name: 'User_organizationId_id_key', table: 'User', unique: true, columns: ['organizationId', 'id'] },
  { name: 'forecast_refresh_active_tenant_key', table, unique: true, columns: ['activeKey'] },
  { name: 'forecast_refresh_tenant_id_key', table, unique: true, columns: ['organizationId', 'id'] },
  { name: 'forecast_refresh_history_idx', table, unique: false, columns: ['organizationId', 'requestedAt'] },
];
export function verifyForecastRefreshIndexes(indexes: readonly RefreshMigrationIndex[], applied: boolean) {
  for (const expected of expectedIndexes) {
    const found = indexes.filter(value => value.name === expected.name);
    if (!found.length && !applied) continue;
    assert.equal(found.length, 1, 'A reviewed request index is missing or ambiguous.');
    const actual = found[0];
    assert(actual.valid && actual.ready && !actual.partial && !actual.expressions && actual.table === expected.table && actual.unique === expected.unique && JSON.stringify(actual.columns) === JSON.stringify(expected.columns), 'A reviewed index has an unexpected definition.');
    if (!applied && expected.table !== 'User') throw Error('Request indexes exist without their own finished migration.');
  }
  return { reviewedIndexes: applied ? 4 : indexes.length };
}

type Db = PrismaClient | Prisma.TransactionClient;
async function indexes(db: Db) {
  return db.$queryRaw<RefreshMigrationIndex[]>`SELECT ci.relname AS name, ct.relname AS "table", i.indisunique AS "unique", i.indisvalid AS valid, i.indisready AS ready, (i.indpred IS NOT NULL) AS partial, (i.indexprs IS NOT NULL) AS expressions, ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum,ord) JOIN pg_attribute a ON a.attrelid=ct.oid AND a.attnum=k.attnum ORDER BY k.ord) AS columns FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid JOIN pg_class ct ON ct.oid=i.indrelid JOIN pg_namespace n ON n.oid=ct.relnamespace WHERE n.nspname='public' AND ci.relname IN ('User_organizationId_id_key','forecast_refresh_active_tenant_key','forecast_refresh_tenant_id_key','forecast_refresh_history_idx')`;
}
async function migrationState(db: Db) {
  const relation = await db.$queryRaw<Array<{ name: string | null }>>`SELECT to_regclass('public._prisma_migrations')::text AS name`;
  assert(relation[0]?.name, 'Existing migration ledger is required.');
  const [tables, ledger] = await Promise.all([
    db.$queryRaw<Array<{ name: string }>>`SELECT tablename AS name FROM pg_tables WHERE schemaname='public' AND tablename='ProductionForecastRefreshRequest'`,
    db.$queryRaw<Array<{ checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>>`SELECT checksum,finished_at,rolled_back_at FROM "_prisma_migrations" WHERE migration_name=${FORECAST_REFRESH_MIGRATION}`,
  ]);
  const state = forecastRefreshMigrationState(tables.map(value => value.name), ledger);
  verifyForecastRefreshIndexes(await indexes(db), state === 'applied');
  return state;
}
async function constraints(db: Db) {
  const found = await db.$queryRaw<Array<{ name: string; valid: boolean; type: string }>>`SELECT c.conname AS name,c.convalidated AS valid,c.contype::text AS type FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='ProductionForecastRefreshRequest' AND c.contype IN ('c','f')`;
  const expected = ['forecast_refresh_status_check', 'forecast_refresh_stage_check', 'forecast_refresh_lifecycle_check', 'forecast_refresh_organization_fkey', 'forecast_refresh_requester_fkey'];
  assert.equal(found.length, 5, 'Unexpected request-table constraint drift.');
  assert(expected.every(name => found.some(value => value.name === name && value.valid && value.type === (name.endsWith('_fkey') ? 'f' : 'c'))), 'Reviewed request constraints are missing or invalid.');
  return { validatedConstraints: 5, ...verifyForecastRefreshIndexes(await indexes(db), true) };
}
async function baseline(db: Db) {
  const organizationId = 'org_echo_spirits';
  const [products, vendors, organizations, features, currentInventoryRows, inventoryHistoryRows, retailSalesRows, wholesaleSalesRows, forecastSnapshots, demandObservations, dcInventoryObservations, sourceImports] = await Promise.all([
    db.organizationProduct.findMany({ orderBy: { id: 'asc' }, select: { id: true, organizationId: true, market: true, externalItemCode: true, status: true, active: true, discontinued: true } }),
    db.organizationVendorIdentifier.findMany({ orderBy: { id: 'asc' } }),
    db.organization.findMany({ orderBy: { id: 'asc' }, select: { id: true, settings: true, enabledStates: true, timezone: true, active: true } }),
    db.organizationFeature.findMany({ orderBy: { id: 'asc' } }),
    db.ohlqAgencyInventoryCurrent.count(), db.ohlqAgencyInventorySnapshot.count(), db.ohlqAnnualSalesRow.count(), db.ohlqAnnualSalesByWholesaleRow.count(), db.productionForecastSnapshot.count(), db.currentDemandObservation.count(), db.currentDcInventoryObservation.count(), db.productionSourceImport.count(),
  ]);
  const target = products.find(value => value.organizationId === organizationId && value.market === 'OH' && value.externalItemCode === '3150B');
  const targetSharedRows = await Promise.all([db.ohlqAgencyInventoryCurrent.count({ where: { organizationId, itemCode: '3150B' } }), db.ohlqAgencyInventorySnapshot.count({ where: { organizationId, itemCode: '3150B' } })]);
  assert(target, '3150B forecasting identity is missing.'); assert.equal(target.status, 'EXCLUDED', '3150B must remain sales-excluded.'); assert.deepEqual(targetSharedRows, [0, 0], '3150B must remain absent from shared inventory.');
  return { productCount: products.length, productStateHash: hash(products), vendorStateHash: hash(vendors), configurationHash: hash({ organizations, features }), currentInventoryRows, inventoryHistoryRows, retailSalesRows, wholesaleSalesRows, forecastSnapshots, demandObservations, dcInventoryObservations, sourceImports, targetStatus: target.status, targetActive: target.active, targetSharedRows };
}
export function forecastRefreshProbeRejected(error: unknown, probe: 'requester' | 'activeKey' | 'lifecycle', successfulProbeInserts: number) {
  if (!error || typeof error !== 'object' || !('meta' in error) || !error.meta || typeof error.meta !== 'object' || !('code' in error.meta)) return false;
  if (probe === 'requester') return error.meta.code === '23503' && 'message' in error.meta && typeof error.meta.message === 'string' && error.meta.message.includes('forecast_refresh_requester_fkey');
  // Prisma's unique/check responses can omit PostgreSQL's constraint name.
  // The preceding read/first insert and distinct IDs isolate activeKey; the
  // RUNNING/FORECAST probe supplies valid identities/status/stage and an invalid
  // lifecycle. Require the exact SQLSTATE and expected successful insert count.
  if (probe === 'activeKey') return error.meta.code === '23505' && successfulProbeInserts === 1;
  return error.meta.code === '23514' && successfulProbeInserts === 0;
}
async function rehearseConstraints(db: PrismaClient) {
  const requester = await db.user.findFirstOrThrow({ where: { organizationId: 'org_echo_spirits', isActive: true }, select: { id: true, organizationId: true } });
  for (const test of ['requester', 'activeKey', 'lifecycle'] as const) {
    phase = `rehearsal-${test}-probe`;
    const prefix = `qa_refresh_${randomUUID().replaceAll('-', '')}`, foreignId = `${prefix}_org`;
    let rejected = false, successfulProbeInserts = 0;
    try {
      await db.$transaction(async tx => {
        if (test === 'requester') {
          await tx.organization.create({ data: { id: foreignId, name: foreignId, slug: foreignId, displayName: foreignId } });
          await tx.$executeRaw`INSERT INTO "ProductionForecastRefreshRequest" (id,"organizationId","requestedByUserId",status,stage,"activeKey","expiresAt") VALUES (${prefix},${foreignId},${requester.id},'QUEUED','QUEUED',${foreignId},CURRENT_TIMESTAMP + INTERVAL '1 hour')`;
        } else if (test === 'activeKey') {
          const active = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM "ProductionForecastRefreshRequest" WHERE "activeKey"=${requester.organizationId}`;
          assert.equal(Number(active[0].count), 0, 'Rehearsal clone has an active request; do not alter it.');
          for (const id of [prefix, `${prefix}_duplicate`]) { await tx.$executeRaw`INSERT INTO "ProductionForecastRefreshRequest" (id,"organizationId","requestedByUserId",status,stage,"activeKey","expiresAt") VALUES (${id},${requester.organizationId},${requester.id},'QUEUED','QUEUED',${requester.organizationId},CURRENT_TIMESTAMP + INTERVAL '1 hour')`; successfulProbeInserts++; }
        } else await tx.$executeRaw`INSERT INTO "ProductionForecastRefreshRequest" (id,"organizationId","requestedByUserId",status,stage) VALUES (${prefix},${requester.organizationId},${requester.id},'RUNNING','FORECAST')`;
        throw Error('Constraint was not enforced; rolling back rehearsal.');
      }, { timeout: 30000 });
    } catch (error) {
      rejected = forecastRefreshProbeRejected(error, test, successfulProbeInserts);
      if (!rejected) {
        const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^P\d{4}$/.test(error.code) ? error.code : null;
        const sqlState = error && typeof error === 'object' && 'meta' in error && error.meta && typeof error.meta === 'object' && 'code' in error.meta && typeof error.meta.code === 'string' && /^[A-Z0-9]{5}$/.test(error.meta.code) ? error.meta.code : null;
        console.error(JSON.stringify({ operation: 'forecast-refresh-constraint-probe', probe: test, code, sqlState }));
      }
    }
    assert(rejected, `Reviewed ${test} constraint did not reject the probe.`);
    const remaining = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM "ProductionForecastRefreshRequest" WHERE id LIKE ${prefix + '%'}`;
    assert.equal(Number(remaining[0].count), 0, 'Synthetic requests were not rolled back.');
    assert.equal(await db.organization.count({ where: { id: foreignId } }), 0, 'Synthetic rehearsal organization was not rolled back.');
  }
  return { crossTenantRequesterRejected: true, duplicateActiveKeyRejected: true, invalidLifecycleRejected: true, rehearsalRowsRolledBack: true };
}

let phase = 'configuration';
async function main() {
  const args = process.argv.slice(2), envFile = argument(args, 'env-file');
  if (!envFile) throw Error('Provide an explicit env-file.');
  const context = forecastRefreshMigrationConfiguration(args, readFileSync(path.resolve(envFile), 'utf8'));
  const statements = forecastRefreshMigrationStatements(readFileSync(path.join(process.cwd(), 'prisma/migrations', FORECAST_REFRESH_MIGRATION, 'migration.sql'), 'utf8'));
  if (context.mode === 'migrate' && !context.apply) { console.log(JSON.stringify({ migration: FORECAST_REFRESH_MIGRATION, checksum: REVIEWED_FORECAST_REFRESH_CHECKSUM, target: context.target, host: context.host, rehearsal: context.rehearsal, applied: false })); return; }
  const db = new PrismaClient({ datasourceUrl: context.connection.toString() });
  try {
    phase = 'read-only-baseline';
    const identity = await db.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
    assert.equal(identity[0].database, decodeURIComponent(context.connection.pathname.slice(1)), 'Database identity mismatch.');
    const before = await baseline(db);
    let state = await migrationState(db), alreadyApplied = state === 'applied';
    if (context.mode === 'migrate') {
      phase = 'reviewed-additive-request-migration';
      await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('production-forecast-refresh-migration'))`;
        state = await migrationState(tx); alreadyApplied = state === 'applied';
        if (state === 'applied') { await constraints(tx); return; }
        for (const statement of statements) await tx.$executeRawUnsafe(statement);
        await constraints(tx);
        await tx.$executeRaw`INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count) VALUES (${randomUUID()},${REVIEWED_FORECAST_REFRESH_CHECKSUM},${FORECAST_REFRESH_MIGRATION},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,1)`;
      }, { maxWait: 20000, timeout: 60000 });
      state = 'applied';
    }
    phase = 'read-only-postcheck';
    const verified = state === 'applied' ? await constraints(db) : null;
    const rehearsal = context.verifyConstraints ? await rehearseConstraints(db) : null;
    phase = 'read-only-baseline-comparison';
    const after = await baseline(db); assert.deepEqual(after, before, 'Existing product, vendor, configuration, sales, inventory, source or forecast facts changed.');
    console.log(JSON.stringify({ migration: FORECAST_REFRESH_MIGRATION, checksum: REVIEWED_FORECAST_REFRESH_CHECKSUM, target: context.target, host: context.host, mode: context.mode, rehearsal: context.rehearsal, migrationState: state, alreadyApplied, constraints: verified, constraintRehearsal: rehearsal, existingDataPreserved: true, baseline: after }));
  } finally { await db.$disconnect(); }
}
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/production-forecast-refresh-migration.ts')) main().catch(() => { console.error(JSON.stringify({ operation: 'forecast-refresh-migration', status: 'failed', phase })); process.exitCode = 1; });
