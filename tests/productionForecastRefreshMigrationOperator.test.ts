import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FORECAST_REFRESH_LIVE_HOSTS, FORECAST_REFRESH_MIGRATION, REVIEWED_FORECAST_REFRESH_CHECKSUM, forecastRefreshMigrationConfiguration, forecastRefreshMigrationState, forecastRefreshMigrationStatements, forecastRefreshProbeRejected, verifyForecastRefreshIndexes, type RefreshMigrationIndex } from '../scripts/production-forecast-refresh-migration';

const production = 'neon-ohlq-field-crm-prod', tst = 'neon-neat-tst';
const clone = 'ep-isolated-rehearsal.c-5.us-east-1.aws.neon.tech';
function fixture(target: keyof typeof FORECAST_REFRESH_LIVE_HOSTS = tst, host: string = FORECAST_REFRESH_LIVE_HOSTS[target]) {
  const environment = target === production ? 'production' : 'test';
  return {
    args: ['--env-file=private.env', `--expected-host=${host}`, `--expected-target=${target}`],
    env: [`APP_ENV=${environment}`, `DATABASE_ENVIRONMENT=${environment}`, `DATABASE_TARGET_ID=${target}`, `EXPECTED_DATABASE_TARGET=${target}`, `EXPECTED_DATABASE_HOST=${host}`, `DATABASE_URL=postgresql://operator:unit-private@${host}/neondb?sslmode=require`, `DIRECT_URL=postgresql://operator:unit-private@${host.replace('-pooler.', '.')}/neondb?sslmode=require`].join('\n'),
  };
}
const definitions: RefreshMigrationIndex[] = [
  { name: 'User_organizationId_id_key', table: 'User', unique: true, columns: ['organizationId', 'id'] },
  { name: 'forecast_refresh_active_tenant_key', table: 'ProductionForecastRefreshRequest', unique: true, columns: ['activeKey'] },
  { name: 'forecast_refresh_tenant_id_key', table: 'ProductionForecastRefreshRequest', unique: true, columns: ['organizationId', 'id'] },
  { name: 'forecast_refresh_history_idx', table: 'ProductionForecastRefreshRequest', unique: false, columns: ['organizationId', 'requestedAt'] },
].map(value => ({ ...value, valid: true, ready: true, partial: false, expressions: false }));

test('each live environment requires its own pinned resource labels and matching unpooled identity', () => {
  for (const target of [tst, production] as const) {
    const f = fixture(target), context = forecastRefreshMigrationConfiguration(f.args, f.env);
    assert.equal(context.target, target); assert.equal(context.connection.hostname, FORECAST_REFRESH_LIVE_HOSTS[target]); assert.equal(context.mode, 'check');
    const pooled = fixture(target, FORECAST_REFRESH_LIVE_HOSTS[target].replace('.c-', '-pooler.c-'));
    assert.equal(forecastRefreshMigrationConfiguration(pooled.args, pooled.env).connection.hostname, FORECAST_REFRESH_LIVE_HOSTS[target]);
    for (const contents of [f.env.replace(`APP_ENV=${context.environment}`, 'APP_ENV=wrong'), f.env.replace(`DATABASE_ENVIRONMENT=${context.environment}`, 'DATABASE_ENVIRONMENT=wrong'), f.env.replace(`DATABASE_TARGET_ID=${target}`, 'DATABASE_TARGET_ID=other'), f.env.replace(`EXPECTED_DATABASE_TARGET=${target}`, 'EXPECTED_DATABASE_TARGET=other')]) assert.throws(() => forecastRefreshMigrationConfiguration(f.args, contents));
  }
});

test('rehearsal always rejects both live hosts; clone hosts cannot be used without rehearsal', () => {
  for (const target of [tst, production] as const) {
    const isolated = fixture(target, clone);
    assert.equal(forecastRefreshMigrationConfiguration([...isolated.args, '--rehearsal'], isolated.env).rehearsal, true);
    assert.throws(() => forecastRefreshMigrationConfiguration(isolated.args, isolated.env));
    for (const host of Object.values(FORECAST_REFRESH_LIVE_HOSTS)) {
      const live = fixture(target, host);
      assert.throws(() => forecastRefreshMigrationConfiguration([...live.args, '--rehearsal'], live.env));
      if (host !== FORECAST_REFRESH_LIVE_HOSTS[target]) assert.throws(() => forecastRefreshMigrationConfiguration(live.args, live.env));
    }
  }
});

test('foreign direct hosts, database, role, password and malformed or ambiguous configuration fail closed', () => {
  const f = fixture();
  for (const contents of [f.env.replace('DIRECT_URL=postgresql://operator:unit-private@', 'DIRECT_URL=postgresql://other:unit-private@'), f.env.replace('DIRECT_URL=postgresql://operator:unit-private@', 'DIRECT_URL=postgresql://operator:different@'), f.env.replace('DIRECT_URL=postgresql://operator:unit-private@ep-noisy-dew', 'DIRECT_URL=postgresql://operator:unit-private@ep-foreign'), f.env.replace('/neondb?sslmode=require\nDIRECT_URL', '/other?sslmode=require\nDIRECT_URL'), f.env.replace('DIRECT_URL=postgresql:', 'DIRECT_URL=https:'), f.env + '\nAPP_ENV=test']) assert.throws(() => forecastRefreshMigrationConfiguration(f.args, contents));
  assert.throws(() => forecastRefreshMigrationConfiguration(f.args.slice(1), f.env));
  assert.throws(() => forecastRefreshMigrationConfiguration([...f.args, '--expected-target=neon-neat-tst'], f.env));
  assert.throws(() => forecastRefreshMigrationConfiguration([...f.args, '--mode=ingest'], f.env));
});

test('mutations need apply plus the exact checksum; constraint probes are clone-only and explicitly opted in', () => {
  const live = fixture(production), isolated = fixture(production, clone), checksum = `--checksum=${REVIEWED_FORECAST_REFRESH_CHECKSUM}`;
  assert.equal(forecastRefreshMigrationConfiguration([...live.args, '--mode=migrate'], live.env).apply, false, 'offline migration metadata mode is valid');
  assert.equal(forecastRefreshMigrationConfiguration([...live.args, '--mode=migrate', '--apply', checksum], live.env).apply, true);
  for (const args of [[...live.args, '--mode=migrate', '--apply'], [...live.args, '--mode=migrate', '--apply', '--checksum=changed'], [...live.args, '--apply', checksum], [...live.args, '--verify-constraints', '--apply', checksum], [...isolated.args, '--rehearsal', '--verify-constraints'], [...isolated.args, '--rehearsal', '--verify-constraints', '--apply']]) assert.throws(() => forecastRefreshMigrationConfiguration(args, args.includes('--rehearsal') ? isolated.env : live.env));
  const verified = forecastRefreshMigrationConfiguration([...isolated.args, '--rehearsal', '--verify-constraints', '--apply', checksum], isolated.env);
  assert.equal(verified.mode, 'check'); assert.equal(verified.verifyConstraints, true);
});

test('only the exact normalized reviewed SQL permits the new request table and conditional User identity index', () => {
  const sql = readFileSync(`prisma/migrations/${FORECAST_REFRESH_MIGRATION}/migration.sql`, 'utf8');
  assert.equal(forecastRefreshMigrationStatements(sql).length, 7);
  assert.equal(forecastRefreshMigrationStatements(sql.replace(/\r?\n/g, '\r\n')).length, 7);
  for (const changed of [sql + '\nDROP TABLE "User";', sql.replace('"organizationId", "id"', '"id", "organizationId"'), sql.replace("'TIMED_OUT'", "'UNKNOWN'"), sql.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS')]) assert.throws(() => forecastRefreshMigrationStatements(changed));
});

test('only absent schema or one exact finished own ledger/table is accepted; partial or mismatched history is rejected', () => {
  const ledger = [{ checksum: REVIEWED_FORECAST_REFRESH_CHECKSUM, finished_at: new Date(), rolled_back_at: null }];
  assert.equal(forecastRefreshMigrationState([], []), 'unapplied');
  assert.equal(forecastRefreshMigrationState(['ProductionForecastRefreshRequest'], ledger), 'applied');
  for (const [tables, entries] of [[['ProductionForecastRefreshRequest'], []], [[], ledger], [['Other'], ledger], [['ProductionForecastRefreshRequest'], [...ledger, ...ledger]], [['ProductionForecastRefreshRequest'], [{ ...ledger[0], checksum: 'wrong' }]], [['ProductionForecastRefreshRequest'], [{ ...ledger[0], finished_at: null }]], [['ProductionForecastRefreshRequest'], [{ ...ledger[0], rolled_back_at: new Date() }]]] as const) assert.throws(() => forecastRefreshMigrationState(tables, entries));
  assert.throws(() => forecastRefreshMigrationState([], [], 'different'));
});

test('conditional existing User uniqueness must be valid and have exactly organizationId,id; request indexes cannot predate their ledger', () => {
  assert.equal(verifyForecastRefreshIndexes([], false).reviewedIndexes, 0);
  assert.equal(verifyForecastRefreshIndexes([definitions[0]], false).reviewedIndexes, 1);
  assert.equal(verifyForecastRefreshIndexes(definitions, true).reviewedIndexes, 4);
  for (const mutation of [{ columns: ['id', 'organizationId'] }, { columns: ['organizationId', 'id', 'email'] }, { table: 'Organization' }, { unique: false }, { valid: false }, { ready: false }, { partial: true }, { expressions: true }]) assert.throws(() => verifyForecastRefreshIndexes([{ ...definitions[0], ...mutation }], false));
  assert.throws(() => verifyForecastRefreshIndexes(definitions.slice(1), true));
  assert.throws(() => verifyForecastRefreshIndexes(definitions, false));
  assert.throws(() => verifyForecastRefreshIndexes([...definitions, definitions[0]], true));
});

test('rehearsal proof accepts connector SQLSTATE without a constraint name only for the isolated duplicate/lifecycle probes', () => {
  const error = (code: string, message = '') => ({ code: 'P2010', meta: { code, message } });
  assert.equal(forecastRefreshProbeRejected(error('23505'), 'activeKey', 1), true);
  assert.equal(forecastRefreshProbeRejected(error('23505'), 'activeKey', 0), false, 'a first-insert failure cannot prove the deliberate duplicate');
  assert.equal(forecastRefreshProbeRejected(error('23503'), 'activeKey', 1), false);
  assert.equal(forecastRefreshProbeRejected(error('23514'), 'lifecycle', 0), true);
  assert.equal(forecastRefreshProbeRejected(error('23505'), 'lifecycle', 0), false);
  assert.equal(forecastRefreshProbeRejected(error('23503'), 'requester', 0), false, 'a foreign-key rejection must identify the composite requester constraint');
  assert.equal(forecastRefreshProbeRejected(error('23503', 'forecast_refresh_requester_fkey'), 'requester', 0), true);
});
