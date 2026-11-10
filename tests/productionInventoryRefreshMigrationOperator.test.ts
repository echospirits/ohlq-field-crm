import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { INVENTORY_DAILY_INDEX, INVENTORY_INTRADAY_INDEX, INVENTORY_REFRESH_LIVE_HOSTS, INVENTORY_REFRESH_MIGRATION, REVIEWED_INVENTORY_REFRESH_CHECKSUM, inventoryRefreshMigrationConfiguration, inventoryRefreshMigrationState, inventoryRefreshMigrationStatements, verifyInventoryRefreshBaseline, type InventoryRefreshBaseline, type InventoryRefreshIndex } from '../scripts/production-inventory-refresh-migration';

const production = 'neon-ohlq-field-crm-prod', tst = 'neon-neat-tst';
const clone = 'ep-isolated-inventory.c-5.us-east-1.aws.neon.tech';
function fixture(target: keyof typeof INVENTORY_REFRESH_LIVE_HOSTS = tst, host: string = INVENTORY_REFRESH_LIVE_HOSTS[target]) {
  const environment = target === production ? 'production' : 'test';
  return { args: ['--env-file=private.env', `--expected-host=${host}`, `--expected-target=${target}`], env: [`APP_ENV=${environment}`, `DATABASE_ENVIRONMENT=${environment}`, `DATABASE_TARGET_ID=${target}`, `EXPECTED_DATABASE_TARGET=${target}`, `EXPECTED_DATABASE_HOST=${host}`, `DATABASE_URL=postgresql://operator:unit-private@${host}/neondb?sslmode=require`, `DIRECT_URL=postgresql://operator:unit-private@${host.replace('-pooler.', '.')}/neondb?sslmode=require`].join('\n') };
}
const columns = ['organizationId', 'productId', 'locationCode', 'businessDate'];
const index = (intraday = false, changes: Partial<InventoryRefreshIndex> = {}): InventoryRefreshIndex => ({ name: intraday ? INVENTORY_INTRADAY_INDEX : INVENTORY_DAILY_INDEX, table: 'CurrentDcInventoryObservation', schema: 'public', unique: true, valid: true, ready: true, partial: false, expressions: false, columns: intraday ? [...columns, 'sourceObservedAt'] : [...columns], ...changes });
const ledger = [{ checksum: REVIEWED_INVENTORY_REFRESH_CHECKSUM, finished_at: new Date(), rolled_back_at: null }];
const baseline = (): InventoryRefreshBaseline => ({ productCount: '155', productFingerprint: 'products-before', vendorFingerprint: 'vendors-before', configurationFingerprint: 'configuration-before', sharedCurrentRows: '498', sharedHistoryRows: '40706', retailSalesRows: '2725535', wholesaleSalesRows: '439742', forecastRows: '825', demandRows: '116', sourceImportRows: '59', inventoryRows: '36', inventoryFingerprint: 'immutable-observations-before', inventoryCheckRows: '36', inventoryCheckFingerprint: 'checks-before', inventoryConstraintFingerprint: 'constraints-before', otherMigrationFingerprint: 'other-ledger-before', targetStatus: 'EXCLUDED', targetActive: true, targetSharedCurrent: '0', targetSharedHistory: '0' });

test('both live targets require their exact labels and matching direct connection; pooled runtime URLs remain accepted', () => {
  for (const target of [tst, production] as const) {
    const f = fixture(target), context = inventoryRefreshMigrationConfiguration(f.args, f.env);
    assert.equal(context.target, target); assert.equal(context.mode, 'check'); assert.equal(context.apply, false);
    const pooled = fixture(target, INVENTORY_REFRESH_LIVE_HOSTS[target].replace('.c-', '-pooler.c-'));
    assert.equal(inventoryRefreshMigrationConfiguration(pooled.args, pooled.env).connection.hostname, INVENTORY_REFRESH_LIVE_HOSTS[target]);
    for (const contents of [f.env.replace(`APP_ENV=${context.environment}`, 'APP_ENV=wrong'), f.env.replace(`DATABASE_ENVIRONMENT=${context.environment}`, 'DATABASE_ENVIRONMENT=wrong'), f.env.replace(`DATABASE_TARGET_ID=${target}`, 'DATABASE_TARGET_ID=other'), f.env.replace(`EXPECTED_DATABASE_TARGET=${target}`, 'EXPECTED_DATABASE_TARGET=other')]) assert.throws(() => inventoryRefreshMigrationConfiguration(f.args, contents));
  }
});

test('every rehearsal excludes both live hosts and every live invocation excludes a clone or the other environment host', () => {
  for (const target of [tst, production] as const) {
    const isolated = fixture(target, clone);
    assert.equal(inventoryRefreshMigrationConfiguration([...isolated.args, '--rehearsal'], isolated.env).rehearsal, true);
    assert.throws(() => inventoryRefreshMigrationConfiguration(isolated.args, isolated.env));
    for (const host of Object.values(INVENTORY_REFRESH_LIVE_HOSTS)) {
      const f = fixture(target, host);
      assert.throws(() => inventoryRefreshMigrationConfiguration([...f.args, '--rehearsal'], f.env));
      if (host !== INVENTORY_REFRESH_LIVE_HOSTS[target]) assert.throws(() => inventoryRefreshMigrationConfiguration(f.args, f.env));
    }
  }
});

test('mismatched role/password/database/direct host and ambiguous or unsupported arguments fail closed', () => {
  const f = fixture();
  for (const contents of [f.env.replace('DIRECT_URL=postgresql://operator:unit-private@', 'DIRECT_URL=postgresql://different:unit-private@'), f.env.replace('DIRECT_URL=postgresql://operator:unit-private@', 'DIRECT_URL=postgresql://operator:different@'), f.env.replace('DIRECT_URL=postgresql://operator:unit-private@ep-noisy-dew', 'DIRECT_URL=postgresql://operator:unit-private@ep-foreign'), f.env.replace('/neondb?sslmode=require\nDIRECT_URL', '/other?sslmode=require\nDIRECT_URL'), f.env.replace('DIRECT_URL=postgresql:', 'DIRECT_URL=https:'), f.env + '\nAPP_ENV=test']) assert.throws(() => inventoryRefreshMigrationConfiguration(f.args, contents));
  for (const args of [f.args.slice(1), [...f.args, '--expected-target=neon-neat-tst'], [...f.args, '--mode=ingest'], [...f.args, '--verify-constraints'], [...f.args, '--force']]) assert.throws(() => inventoryRefreshMigrationConfiguration(args, f.env));
});

test('only explicit migrate/apply/exact-checksum can write; check stays read-only and offline migration metadata needs no apply', () => {
  const f = fixture(production), checksum = `--checksum=${REVIEWED_INVENTORY_REFRESH_CHECKSUM}`;
  assert.equal(inventoryRefreshMigrationConfiguration([...f.args, '--mode=migrate'], f.env).apply, false);
  assert.equal(inventoryRefreshMigrationConfiguration([...f.args, '--mode=migrate', '--apply', checksum], f.env).apply, true);
  for (const args of [[...f.args, '--apply', checksum], [...f.args, '--mode=migrate', '--apply'], [...f.args, '--mode=migrate', '--apply', '--checksum=other'], [...f.args, '--checksum=other']]) assert.throws(() => inventoryRefreshMigrationConfiguration(args, f.env));
});

test('the exact normalized SQL creates timestamped uniqueness before removing daily-only uniqueness and cannot change rows', () => {
  const sql = readFileSync(`prisma/migrations/${INVENTORY_REFRESH_MIGRATION}/migration.sql`, 'utf8');
  const statements = inventoryRefreshMigrationStatements(sql);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /CREATE UNIQUE INDEX .*sourceObservedAt/); assert.match(statements[1], /^DROP INDEX/);
  assert.deepEqual(inventoryRefreshMigrationStatements(sql.replace(/\r?\n/g, '\r\n')), statements);
  for (const changed of [sql + '\nDELETE FROM "CurrentDcInventoryObservation";', sql.replace('DROP INDEX', 'DROP INDEX IF EXISTS'), sql.replace('CREATE UNIQUE INDEX', 'CREATE INDEX'), sql.replace(',"sourceObservedAt"', ''), sql.replace('"businessDate","sourceObservedAt"', '"sourceObservedAt","businessDate"')]) assert.throws(() => inventoryRefreshMigrationStatements(changed));
});

test('only exact old index without own ledger or exact new index with finished own ledger is replay-safe', () => {
  assert.equal(inventoryRefreshMigrationState([index()], []), 'unapplied');
  assert.equal(inventoryRefreshMigrationState([index(true)], ledger), 'applied');
  for (const [indexes, entries] of [[[], []], [[index(), index(true)], []], [[index(true)], []], [[index()], ledger], [[], ledger], [[index(), index(true)], ledger], [[index(true)], [...ledger, ...ledger]], [[index(true)], [{ ...ledger[0], checksum: 'other' }]], [[index(true)], [{ ...ledger[0], finished_at: null }]], [[index(true)], [{ ...ledger[0], rolled_back_at: new Date() }]]] as const) assert.throws(() => inventoryRefreshMigrationState(indexes, entries));
});

test('actual index readback must match table/schema/order/columns and valid unconditional uniqueness in either state', () => {
  for (const intraday of [false, true]) {
    const expectedColumns = intraday ? [...columns, 'sourceObservedAt'] : [...columns];
    for (const changes of [{ schema: 'other' }, { table: 'CurrentDcInventoryCheck' }, { unique: false }, { valid: false }, { ready: false }, { partial: true }, { expressions: true }, { columns: expectedColumns.slice().reverse() }, { columns: expectedColumns.slice(1) }, { columns: [...expectedColumns, 'id'] }]) assert.throws(() => inventoryRefreshMigrationState([index(intraday, changes)], intraday ? ledger : []));
  }
});

test('row fingerprints catch inventory-history edits even with unchanged counts, including checks/constraints and other migration records', () => {
  const before = baseline(); assert.deepEqual(verifyInventoryRefreshBaseline(before, { ...before }), { existingDataPreserved: true, inventoryHistoryPreserved: true });
  for (const key of ['inventoryFingerprint', 'inventoryCheckFingerprint', 'inventoryConstraintFingerprint', 'otherMigrationFingerprint', 'productFingerprint', 'vendorFingerprint', 'configurationFingerprint'] as const) assert.throws(() => verifyInventoryRefreshBaseline(before, { ...before, [key]: 'changed' }));
  for (const key of ['inventoryRows', 'inventoryCheckRows', 'retailSalesRows', 'wholesaleSalesRows', 'sharedCurrentRows', 'sharedHistoryRows', 'forecastRows', 'demandRows', 'sourceImportRows'] as const) assert.throws(() => verifyInventoryRefreshBaseline(before, { ...before, [key]: '999' }));
  const missing = { ...before }; delete (missing as Partial<InventoryRefreshBaseline>).inventoryFingerprint;
  assert.throws(() => verifyInventoryRefreshBaseline(missing, missing), 'an omitted history fingerprint cannot count as preservation');
});

test('3150B cannot silently enter sales/shared inventory and its prior active decision remains unchanged', () => {
  const before = baseline();
  for (const changes of [{ targetStatus: 'OWNED' }, { targetSharedCurrent: '1' }, { targetSharedHistory: '1' }]) {
    const unsafe = { ...before, ...changes }; assert.throws(() => verifyInventoryRefreshBaseline(unsafe, unsafe));
  }
  assert.throws(() => verifyInventoryRefreshBaseline(before, { ...before, targetActive: false }));
});
