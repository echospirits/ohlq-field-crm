import assert from 'node:assert/strict';
import test from 'node:test';
import { warehouseInventoryConfiguration, warehouseMigrationState, warehouseMigrationStatements } from '../scripts/production-warehouse-inventory';

const args = ['--env-file=private.env', '--expected-host=ep-example-pooler.c-2.us-east-2.aws.neon.tech', '--expected-target=neon-neat-tst'];
const env = ['APP_ENV=test', 'DATABASE_ENVIRONMENT=test', 'DATABASE_TARGET_ID=neon-neat-tst', 'EXPECTED_DATABASE_HOST=ep-example-pooler.c-2.us-east-2.aws.neon.tech', 'DATABASE_URL=postgresql://user:never-print@ep-example-pooler.c-2.us-east-2.aws.neon.tech/neondb', 'DIRECT_URL=postgresql://user:never-print@ep-example.c-2.us-east-2.aws.neon.tech/neondb'].join('\n');

test('warehouse operator requires explicit TST identity and resolves only its matching direct host', () => {
  const context = warehouseInventoryConfiguration(args, env);
  assert.equal(context.connection.hostname, 'ep-example.c-2.us-east-2.aws.neon.tech');
  assert.equal(context.mode, 'check'); assert.equal(context.target, 'neon-neat-tst');
  assert.equal(warehouseInventoryConfiguration([...args, '--rehearsal'], env).rehearsal, true);
  assert.throws(() => warehouseInventoryConfiguration(args.slice(1), env));
});

test('production, mislabeled targets and foreign direct URLs fail closed even with rehearsal', () => {
  for (const value of [env.replace('APP_ENV=test', 'APP_ENV=production'), env.replace('DATABASE_ENVIRONMENT=test', 'DATABASE_ENVIRONMENT=production'), env.replace('DATABASE_TARGET_ID=neon-neat-tst', 'DATABASE_TARGET_ID=production'), env.replace('DIRECT_URL=postgresql://user:never-print@ep-example.', 'DIRECT_URL=postgresql://user:never-print@ep-foreign.'), env.replace('/neondb\nDIRECT_URL', '/other\nDIRECT_URL')]) {
    assert.throws(() => warehouseInventoryConfiguration([...args, '--rehearsal'], value));
  }
  assert.throws(() => warehouseInventoryConfiguration([...args.slice(0, -1), '--expected-target=production'], env));
});

test('only an absent migration or its exact finished ledger plus both tables is accepted', () => {
  const tables = ['CurrentDcInventoryObservation', 'CurrentDcInventoryCheck'];
  const ledger = [{ checksum: 'reviewed', finished_at: new Date(), rolled_back_at: null }];
  assert.equal(warehouseMigrationState([], [], 'reviewed'), 'unapplied');
  assert.equal(warehouseMigrationState(tables, ledger, 'reviewed'), 'applied');
  for (const [present, entries] of [[tables, []], [tables.slice(0, 1), ledger], [[], ledger], [tables, [...ledger, ...ledger]], [tables, [{ ...ledger[0], checksum: 'different' }]], [tables, [{ ...ledger[0], finished_at: null }]], [tables, [{ ...ledger[0], rolled_back_at: new Date() }]]] as const) {
    assert.throws(() => warehouseMigrationState(present, entries, 'reviewed'));
  }
});

test('migration execution refuses statements touching existing business tables', () => {
  assert.equal(warehouseMigrationStatements('CREATE TABLE "CurrentDcInventoryObservation" ("id" TEXT); CREATE INDEX "example" ON "CurrentDcInventoryObservation"("id");').length, 2);
  for (const sql of ['DROP TABLE "OrganizationProduct";', 'ALTER TABLE "OrganizationProduct" ADD COLUMN "x" TEXT;', 'UPDATE "OhlqAnnualSalesRow" SET "brand"=\'3150B\';']) assert.throws(() => warehouseMigrationStatements(sql));
});
