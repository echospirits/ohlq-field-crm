import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import { parseEnvironmentFile } from '../lib/environmentFile';

export const INVENTORY_REFRESH_MIGRATION = '20261110030000_dc_inventory_intraday_observations';
export const REVIEWED_INVENTORY_REFRESH_CHECKSUM = '778cec015f061b721d36113ef0100b262b86035d7fcf5fefa55b35b1e4fc4ac6';
export const INVENTORY_REFRESH_LIVE_HOSTS = {
  'neon-ohlq-field-crm-prod': 'ep-proud-recipe-amosj8m9.c-5.us-east-1.aws.neon.tech',
  'neon-neat-tst': 'ep-noisy-dew-avchokwr.c-11.us-east-1.aws.neon.tech',
} as const;
export const INVENTORY_DAILY_INDEX = 'dc_inventory_tenant_product_location_day_key';
export const INVENTORY_INTRADAY_INDEX = 'dc_inventory_tenant_product_location_day_observed_key';
const table = 'CurrentDcInventoryObservation';
const oldColumns = ['organizationId', 'productId', 'locationCode', 'businessDate'];
const newColumns = [...oldColumns, 'sourceObservedAt'];
const argument = (args: readonly string[], name: string) => {
  const values = args.filter(value => value.startsWith(`--${name}=`));
  if (values.length > 1) throw Error('Duplicate operator arguments are not allowed.');
  return values[0]?.slice(name.length + 3);
};
const directHost = (value: string) => value.replace('-pooler.', '.');

export function inventoryRefreshMigrationConfiguration(args: readonly string[], contents: string) {
  if (args.some(value => !['--apply', '--rehearsal'].includes(value) && !/^--(?:env-file|expected-host|expected-target|mode|checksum)=.+$/.test(value))) throw Error('Unknown or malformed migration argument.');
  const host = argument(args, 'expected-host'), target = argument(args, 'expected-target');
  if (!argument(args, 'env-file') || !host || !target || !Object.hasOwn(INVENTORY_REFRESH_LIVE_HOSTS, target)) throw Error('Provide explicit env-file, expected-host and reviewed expected-target.');
  const entries = parseEnvironmentFile(contents), config = Object.fromEntries(entries);
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw Error('Duplicate environment keys are not allowed.');
  const environment = target === 'neon-ohlq-field-crm-prod' ? 'production' : 'test';
  if (config.APP_ENV !== environment || config.DATABASE_ENVIRONMENT !== environment || config.DATABASE_TARGET_ID !== target || config.EXPECTED_DATABASE_HOST !== host || config.EXPECTED_DATABASE_TARGET && config.EXPECTED_DATABASE_TARGET !== target) throw Error('Resource labels do not match the reviewed environment.');
  const configured = new URL(config.DATABASE_URL), connection = new URL(config.DIRECT_URL || config.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(configured.protocol) || !['postgres:', 'postgresql:'].includes(connection.protocol) || !host.endsWith('.neon.tech') || configured.hostname !== host || connection.hostname !== directHost(host) || connection.pathname !== configured.pathname || connection.username !== configured.username || connection.password !== configured.password || connection.port !== configured.port || !connection.username || !connection.password || connection.searchParams.get('sslmode') === 'disable') throw Error('A matching direct, unpooled connection identity is required.');
  const rehearsal = args.includes('--rehearsal'), endpoint = directHost(host);
  const live = INVENTORY_REFRESH_LIVE_HOSTS[target as keyof typeof INVENTORY_REFRESH_LIVE_HOSTS];
  if (rehearsal ? Object.values(INVENTORY_REFRESH_LIVE_HOSTS).some(value => value === endpoint) : endpoint !== live) throw Error('Live and isolated rehearsal hosts cannot interchange.');
  const mode = argument(args, 'mode') ?? 'check', apply = args.includes('--apply');
  if (!['migrate', 'check'].includes(mode)) throw Error('Choose only migrate or check.');
  if (apply && (mode !== 'migrate' || argument(args, 'checksum') !== REVIEWED_INVENTORY_REFRESH_CHECKSUM)) throw Error('Migration writes require mode=migrate, apply and the exact reviewed checksum.');
  if (argument(args, 'checksum') && argument(args, 'checksum') !== REVIEWED_INVENTORY_REFRESH_CHECKSUM) throw Error('Unexpected migration checksum.');
  return { config, connection, host, target, environment, rehearsal, apply, mode: mode as 'migrate' | 'check' };
}

export function inventoryRefreshMigrationStatements(sql: string) {
  const normalized = sql.replace(/\r\n/g, '\n');
  if (createHash('sha256').update(normalized).digest('hex') !== REVIEWED_INVENTORY_REFRESH_CHECKSUM) throw Error('Migration differs from the exact reviewed SQL.');
  const statements = normalized.replace(/^\s*--.*$/gm, '').split(';').map(value => value.trim()).filter(Boolean);
  const expected = [
    `CREATE UNIQUE INDEX "${INVENTORY_INTRADAY_INDEX}" ON "${table}"("organizationId","productId","locationCode","businessDate","sourceObservedAt")`,
    `DROP INDEX "${INVENTORY_DAILY_INDEX}"`,
  ];
  assert.deepEqual(statements, expected, 'Only the reviewed intraday index replacement is permitted.');
  return statements;
}

export type InventoryRefreshIndex = { name: string; table: string; schema: string; unique: boolean; valid: boolean; ready: boolean; partial: boolean; expressions: boolean; columns: string[] };
type Ledger = ReadonlyArray<{ checksum: string; finished_at: unknown; rolled_back_at: unknown }>;
export function inventoryRefreshMigrationState(indexes: readonly InventoryRefreshIndex[], ledger: Ledger) {
  if (ledger.length > 1 || ledger.some(row => row.checksum !== REVIEWED_INVENTORY_REFRESH_CHECKSUM || !row.finished_at || row.rolled_back_at !== null)) throw Error('Own migration ledger is partial or differs from reviewed SQL.');
  const applied = ledger.length === 1;
  const expectedName = applied ? INVENTORY_INTRADAY_INDEX : INVENTORY_DAILY_INDEX;
  const expectedColumns = applied ? newColumns : oldColumns;
  assert.equal(indexes.length, 1, 'Exactly one reviewed daily/intraday index must exist.');
  const found = indexes[0];
  assert(found.name === expectedName && found.table === table && found.schema === 'public' && found.unique && found.valid && found.ready && !found.partial && !found.expressions && JSON.stringify(found.columns) === JSON.stringify(expectedColumns), 'Index columns or state do not match the own migration ledger. No drift is reconciled.');
  return applied ? 'applied' as const : 'unapplied' as const;
}

export type InventoryRefreshBaseline = {
  productCount: string; productFingerprint: string; vendorFingerprint: string; configurationFingerprint: string;
  sharedCurrentRows: string; sharedHistoryRows: string; retailSalesRows: string; wholesaleSalesRows: string;
  forecastRows: string; demandRows: string; sourceImportRows: string;
  inventoryRows: string; inventoryFingerprint: string; inventoryCheckRows: string; inventoryCheckFingerprint: string;
  inventoryConstraintFingerprint: string; otherMigrationFingerprint: string;
  targetStatus: string | null; targetActive: boolean | null; targetSharedCurrent: string; targetSharedHistory: string;
};
export function verifyInventoryRefreshBaseline(before: InventoryRefreshBaseline, after: InventoryRefreshBaseline) {
  const required = ['productCount','productFingerprint','vendorFingerprint','configurationFingerprint','sharedCurrentRows','sharedHistoryRows','retailSalesRows','wholesaleSalesRows','forecastRows','demandRows','sourceImportRows','inventoryRows','inventoryFingerprint','inventoryCheckRows','inventoryCheckFingerprint','inventoryConstraintFingerprint','otherMigrationFingerprint','targetStatus','targetActive','targetSharedCurrent','targetSharedHistory'];
  assert(required.every(key => Object.hasOwn(before, key) && Object.hasOwn(after, key)), 'A protected baseline field is missing.');
  assert.equal(before.targetStatus, 'EXCLUDED', '3150B must remain sales-excluded.');
  assert.equal(before.targetSharedCurrent, '0', '3150B must remain absent from current shared inventory.');
  assert.equal(before.targetSharedHistory, '0', '3150B must remain absent from shared inventory history.');
  assert.deepEqual(after, before, 'Protected rows, inventory history, checks, constraints or unrelated migration records changed.');
  return { existingDataPreserved: true, inventoryHistoryPreserved: true };
}

type Db = PrismaClient | Prisma.TransactionClient;
async function indexReadback(db: Db) {
  return db.$queryRaw<InventoryRefreshIndex[]>`SELECT ci.relname AS name,ct.relname AS "table",nt.nspname AS schema,i.indisunique AS "unique",i.indisvalid AS valid,i.indisready AS ready,(i.indpred IS NOT NULL) AS partial,(i.indexprs IS NOT NULL) AS expressions,ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum,ord) JOIN pg_attribute a ON a.attrelid=ct.oid AND a.attnum=k.attnum ORDER BY k.ord) AS columns FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid JOIN pg_class ct ON ct.oid=i.indrelid JOIN pg_namespace ni ON ni.oid=ci.relnamespace JOIN pg_namespace nt ON nt.oid=ct.relnamespace WHERE ni.nspname='public' AND ci.relname IN ('dc_inventory_tenant_product_location_day_key','dc_inventory_tenant_product_location_day_observed_key')`;
}
async function migrationState(db: Db) {
  const prerequisite = await db.$queryRaw<Array<{ ledger: string | null; observations: string | null; checks: string | null }>>`SELECT to_regclass('public._prisma_migrations')::text AS ledger,to_regclass('public."CurrentDcInventoryObservation"')::text AS observations,to_regclass('public."CurrentDcInventoryCheck"')::text AS checks`;
  assert(prerequisite[0]?.ledger && prerequisite[0]?.observations && prerequisite[0]?.checks, 'Existing warehouse tables and migration ledger are required.');
  const [indexes, ledger] = await Promise.all([
    indexReadback(db),
    db.$queryRaw<Array<{ checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>>`SELECT checksum,finished_at,rolled_back_at FROM "_prisma_migrations" WHERE migration_name=${INVENTORY_REFRESH_MIGRATION}`,
  ]);
  return { state: inventoryRefreshMigrationState(indexes, ledger), indexes };
}
async function baseline(db: Db) {
  const rows = await db.$queryRaw<InventoryRefreshBaseline[]>`SELECT
    (SELECT count(*)::text FROM "OrganizationProduct") AS "productCount",
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id)::text,'')) FROM "OrganizationProduct" p) AS "productFingerprint",
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.id)::text,'')) FROM "OrganizationVendorIdentifier" v) AS "vendorFingerprint",
    md5(jsonb_build_object('organizations',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM (SELECT id,settings,"enabledStates",timezone,active FROM "Organization") c),'features',(SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM "OrganizationFeature" f))::text) AS "configurationFingerprint",
    (SELECT count(*)::text FROM "OhlqAgencyInventoryCurrent") AS "sharedCurrentRows",
    (SELECT count(*)::text FROM "OhlqAgencyInventorySnapshot") AS "sharedHistoryRows",
    (SELECT count(*)::text FROM "OhlqAnnualSalesRow") AS "retailSalesRows",
    (SELECT count(*)::text FROM "OhlqAnnualSalesByWholesaleRow") AS "wholesaleSalesRows",
    (SELECT count(*)::text FROM "ProductionForecastSnapshot") AS "forecastRows",
    (SELECT count(*)::text FROM "CurrentDemandObservation") AS "demandRows",
    (SELECT count(*)::text FROM "ProductionSourceImport") AS "sourceImportRows",
    (SELECT count(*)::text FROM "CurrentDcInventoryObservation") AS "inventoryRows",
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id)::text,'')) FROM "CurrentDcInventoryObservation" o) AS "inventoryFingerprint",
    (SELECT count(*)::text FROM "CurrentDcInventoryCheck") AS "inventoryCheckRows",
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id)::text,'')) FROM "CurrentDcInventoryCheck" c) AS "inventoryCheckFingerprint",
    (SELECT md5(coalesce(string_agg(c.conname||':'||c.contype::text||':'||c.convalidated::text||':'||pg_get_constraintdef(c.oid),'|' ORDER BY c.conname),'')) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname IN ('CurrentDcInventoryObservation','CurrentDcInventoryCheck')) AS "inventoryConstraintFingerprint",
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id)::text,'')) FROM "_prisma_migrations" m WHERE migration_name<>${INVENTORY_REFRESH_MIGRATION}) AS "otherMigrationFingerprint",
    (SELECT status FROM "OrganizationProduct" WHERE "organizationId"='org_echo_spirits' AND market='OH' AND "externalItemCode"='3150B') AS "targetStatus",
    (SELECT active FROM "OrganizationProduct" WHERE "organizationId"='org_echo_spirits' AND market='OH' AND "externalItemCode"='3150B') AS "targetActive",
    (SELECT count(*)::text FROM "OhlqAgencyInventoryCurrent" WHERE "organizationId"='org_echo_spirits' AND "itemCode"='3150B') AS "targetSharedCurrent",
    (SELECT count(*)::text FROM "OhlqAgencyInventorySnapshot" WHERE "organizationId"='org_echo_spirits' AND "itemCode"='3150B') AS "targetSharedHistory"`;
  assert.equal(rows.length, 1, 'Protected baseline read failed.');
  return rows[0];
}

let phase = 'configuration';
async function main() {
  const args = process.argv.slice(2), envFile = argument(args, 'env-file');
  if (!envFile) throw Error('Provide an explicit env-file.');
  const context = inventoryRefreshMigrationConfiguration(args, readFileSync(path.resolve(envFile), 'utf8'));
  const statements = inventoryRefreshMigrationStatements(readFileSync(path.join(process.cwd(), 'prisma/migrations', INVENTORY_REFRESH_MIGRATION, 'migration.sql'), 'utf8'));
  if (context.mode === 'migrate' && !context.apply) { console.log(JSON.stringify({ migration: INVENTORY_REFRESH_MIGRATION, checksum: REVIEWED_INVENTORY_REFRESH_CHECKSUM, target: context.target, host: context.host, rehearsal: context.rehearsal, applied: false })); return; }
  const db = new PrismaClient({ datasourceUrl: context.connection.toString() });
  try {
    phase = 'read-only-identity-and-baseline';
    const identity = await db.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
    assert.equal(identity[0].database, decodeURIComponent(context.connection.pathname.slice(1)), 'Database identity mismatch.');
    const before = await baseline(db); verifyInventoryRefreshBaseline(before, before);
    let current = await migrationState(db), alreadyApplied = current.state === 'applied';
    if (context.mode === 'migrate') {
      phase = 'reviewed-inventory-index-migration';
      await db.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout='15s'`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('production-inventory-refresh-migration'))`;
        current = await migrationState(tx); alreadyApplied = current.state === 'applied';
        if (alreadyApplied) return;
        for (const statement of statements) await tx.$executeRawUnsafe(statement);
        const indexes = await indexReadback(tx);
        inventoryRefreshMigrationState(indexes, [{ checksum: REVIEWED_INVENTORY_REFRESH_CHECKSUM, finished_at: new Date(), rolled_back_at: null }]);
        await tx.$executeRaw`INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count) VALUES (${randomUUID()},${REVIEWED_INVENTORY_REFRESH_CHECKSUM},${INVENTORY_REFRESH_MIGRATION},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,1)`;
      }, { maxWait: 20000, timeout: 60000 });
    }
    phase = 'read-only-history-and-index-verification';
    const after = await baseline(db), preserved = verifyInventoryRefreshBaseline(before, after);
    current = await migrationState(db);
    console.log(JSON.stringify({ migration: INVENTORY_REFRESH_MIGRATION, checksum: REVIEWED_INVENTORY_REFRESH_CHECKSUM, target: context.target, host: context.host, mode: context.mode, rehearsal: context.rehearsal, migrationState: current.state, alreadyApplied, ...preserved, indexes: current.indexes, baseline: after }));
  } finally { await db.$disconnect(); }
}
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/production-inventory-refresh-migration.ts')) main().catch(() => { console.error(JSON.stringify({ operation: 'inventory-refresh-migration', status: 'failed', phase })); process.exitCode = 1; });
