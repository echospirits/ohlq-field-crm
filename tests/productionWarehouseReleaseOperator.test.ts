import assert from 'node:assert/strict';
import test from 'node:test';
import { productionWarehouseReleaseConfiguration, productionWarehouseMigrationState, productionWarehouseMigrationStatements, REVIEWED_WAREHOUSE_MIGRATION_CHECKSUM, VERIFIED_PRODUCTION_HOST } from '../scripts/production-warehouse-release';
import { warehouseInventoryConfiguration } from '../scripts/production-warehouse-inventory';

const args = ['--env-file=private.env', '--expected-host=ep-proud-recipe-amosj8m9-pooler.c-5.us-east-1.aws.neon.tech', '--expected-target=neon-ohlq-field-crm-prod'];
const env = ['APP_ENV=production', 'DATABASE_ENVIRONMENT=production', 'DATABASE_TARGET_ID=neon-ohlq-field-crm-prod', 'EXPECTED_DATABASE_TARGET=neon-ohlq-field-crm-prod', 'EXPECTED_DATABASE_HOST=ep-proud-recipe-amosj8m9-pooler.c-5.us-east-1.aws.neon.tech', 'DATABASE_URL=postgresql://owner:never-print@ep-proud-recipe-amosj8m9-pooler.c-5.us-east-1.aws.neon.tech/neondb', 'DIRECT_URL=postgresql://owner:never-print@ep-proud-recipe-amosj8m9.c-5.us-east-1.aws.neon.tech/neondb'].join('\n');
const cloneArgs = args.map(value => value.replace('ep-proud-recipe-amosj8m9', 'ep-shy-snow-amkljwrq'));
const cloneEnv = env.replaceAll('ep-proud-recipe-amosj8m9', 'ep-shy-snow-amkljwrq');

test('production release driver accepts only the explicit production resource and matching direct connection', () => {
  const context = productionWarehouseReleaseConfiguration(args, env);
  assert.equal(context.target, 'neon-ohlq-field-crm-prod'); assert.equal(context.mode, 'check');
  assert.equal(context.connection.hostname, VERIFIED_PRODUCTION_HOST);
  assert.equal(context.rehearsal, false);
  assert.equal(productionWarehouseReleaseConfiguration([...cloneArgs, '--rehearsal'], cloneEnv).rehearsal, true);
  assert.throws(() => warehouseInventoryConfiguration(args, env), 'the TST operator must continue rejecting production');
});

test('test/development identities, deployment health labels and foreign direct targets cannot masquerade as production', () => {
  for (const contents of [env.replace('APP_ENV=production', 'APP_ENV=test'), env.replace('DATABASE_ENVIRONMENT=production', 'DATABASE_ENVIRONMENT=development'), env.replace('DATABASE_TARGET_ID=neon-ohlq-field-crm-prod', 'DATABASE_TARGET_ID=neon-neat-tst'), env.replace('EXPECTED_DATABASE_TARGET=neon-ohlq-field-crm-prod', 'EXPECTED_DATABASE_TARGET=other'), env.replace('DIRECT_URL=postgresql://owner:never-print@ep-proud-recipe-amosj8m9.', 'DIRECT_URL=postgresql://owner:never-print@ep-foreign.'), env.replace('DIRECT_URL=postgresql://owner:', 'DIRECT_URL=postgresql://different-role:'), env.replace('/neondb\nDIRECT_URL', '/foreign\nDIRECT_URL')]) {
    assert.throws(() => productionWarehouseReleaseConfiguration(args, contents));
  }
  for (const target of ['ohlq-field-crm', 'neon-neat-tst', 'production']) assert.throws(() => productionWarehouseReleaseConfiguration([...args.slice(0, -1), `--expected-target=${target}`], env));
});

test('production release arguments cannot be omitted, duplicated or widened into live CSV ingestion', () => {
  assert.throws(() => productionWarehouseReleaseConfiguration(args.slice(1), env));
  assert.throws(() => productionWarehouseReleaseConfiguration([...args, '--expected-target=neon-neat-tst'], env));
  assert.throws(() => productionWarehouseReleaseConfiguration([...args, '--mode=ingest'], env));
  assert.throws(() => productionWarehouseReleaseConfiguration([...args, '--mode=unknown'], env));
  assert.equal(productionWarehouseReleaseConfiguration([...cloneArgs, '--mode=ingest', '--rehearsal'], cloneEnv).mode, 'ingest');
});

test('rehearsal can never enable live CSV or constraint writes and a clone can never be mistaken for live production', () => {
  for (const mode of ['--mode=check', '--mode=migrate', '--mode=ingest']) assert.throws(() => productionWarehouseReleaseConfiguration([...args, mode, '--rehearsal', '--apply', '--verify-constraints'], env));
  assert.throws(() => productionWarehouseReleaseConfiguration(cloneArgs, cloneEnv));
  assert.throws(() => productionWarehouseReleaseConfiguration([...cloneArgs, '--mode=migrate', '--apply'], cloneEnv));
  assert.equal(productionWarehouseReleaseConfiguration([...args, '--mode=migrate', '--apply'], env).connection.hostname, VERIFIED_PRODUCTION_HOST);
});

test('only the exact reviewed release checksum and one complete non-rolled-back ledger entry are accepted', () => {
  const tables = ['CurrentDcInventoryObservation', 'CurrentDcInventoryCheck'];
  const checksum = REVIEWED_WAREHOUSE_MIGRATION_CHECKSUM;
  const ledger = [{ checksum, finished_at: new Date(), rolled_back_at: null }];
  assert.equal(productionWarehouseMigrationState([], [], checksum), 'unapplied');
  assert.equal(productionWarehouseMigrationState(tables, ledger, checksum), 'applied');
  for (const [present, entries] of [[tables, []], [tables.slice(0, 1), ledger], [[], ledger], [tables, [...ledger, ...ledger]], [tables, [{ ...ledger[0], checksum: 'different' }]], [tables, [{ ...ledger[0], finished_at: null }]], [tables, [{ ...ledger[0], rolled_back_at: new Date() }]]] as const) assert.throws(() => productionWarehouseMigrationState(present, entries, checksum));
  assert.throws(() => productionWarehouseMigrationState([], [], 'different'), 'even an empty database cannot authorize different release SQL');
});

test('production migration statement allowlist refuses changes to existing business data', () => {
  assert.equal(productionWarehouseMigrationStatements('CREATE TABLE "CurrentDcInventoryCheck" ("id" TEXT);').length, 1);
  for (const sql of ['DROP TABLE "OrganizationProduct";', 'ALTER TABLE "OrganizationProduct" ADD COLUMN "x" TEXT;', 'DELETE FROM "OhlqAnnualSalesRow";', 'CREATE TABLE "TastingEvent" ("id" TEXT);']) assert.throws(() => productionWarehouseMigrationStatements(sql));
});
