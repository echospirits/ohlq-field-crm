import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { dispatchProductionForecastRefresh, getProductionForecastRefreshDispatchConfig, ProductionForecastDispatchError, PRODUCTION_FORECAST_REFRESH_WORKFLOW } from '../lib/productionForecasting/refreshDispatch';
import { forecastRefreshRunnerContext, forecastRefreshRunnerReceipt } from '../scripts/run-production-forecast-refresh';

const keys = ['APP_ENV', 'GITHUB_ACTIONS_DISPATCH_TOKEN', 'GITHUB_ACTIONS_REF', 'GITHUB_ACTIONS_REPOSITORY', 'GITHUB_ACTIONS_OHLQ_WORKFLOW_ID', 'GITHUB_REPOSITORY', 'VERCEL_GIT_REPO_OWNER', 'VERCEL_GIT_REPO_SLUG', 'VERCEL_GIT_COMMIT_REF'] as const;
const saved = new Map(keys.map(key => [key, process.env[key]])), originalFetch = globalThis.fetch;
const organizationId = 'org_echo_spirits', requestId = 'cmrefresh_request_123';
afterEach(() => {
  for (const key of keys) { const value = saved.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  globalThis.fetch = originalFetch;
});

function configure(environment: 'test' | 'production' = 'test') {
  for (const key of keys) delete process.env[key];
  process.env.APP_ENV = environment;
  process.env.GITHUB_ACTIONS_DISPATCH_TOKEN = 'PRIVATE_DISPATCH_TOKEN';
  process.env.GITHUB_ACTIONS_REPOSITORY = environment === 'test' ? 'echospirits/neat-tst' : 'echospirits/ohlq-field-crm';
  process.env.GITHUB_ACTIONS_REF = environment === 'test' ? 'tst' : 'main';
}

test('forecast refresh dispatch requires the existing token and ignores the broad import workflow override', () => {
  configure(); delete process.env.GITHUB_ACTIONS_DISPATCH_TOKEN;
  assert.equal(getProductionForecastRefreshDispatchConfig(), null);
  process.env.GITHUB_ACTIONS_DISPATCH_TOKEN = 'PRIVATE_DISPATCH_TOKEN';
  process.env.GITHUB_ACTIONS_OHLQ_WORKFLOW_ID = 'unrelated-workflow.yml';
  assert.equal(getProductionForecastRefreshDispatchConfig()?.workflowId, PRODUCTION_FORECAST_REFRESH_WORKFLOW);
});

test('dispatch sends only a validated persisted-request identity to each exact environment repository/ref', async () => {
  for (const environment of ['test', 'production'] as const) {
    configure(environment);
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      const repository = environment === 'test' ? 'echospirits/neat-tst' : 'echospirits/ohlq-field-crm';
      assert.equal(String(url), `https://api.github.com/repos/${repository}/actions/workflows/production-forecast-refresh.yml/dispatches`);
      assert.equal(options?.method, 'POST');
      assert.deepEqual(JSON.parse(String(options?.body)), { ref: environment === 'test' ? 'tst' : 'main', inputs: { organizationId, requestId } });
      assert.ok(options?.signal);
      return new Response(null, { status: 204 });
    };
    const result = await dispatchProductionForecastRefresh({ organizationId, requestId });
    assert.equal(calls, 1); assert.equal(result.ref, environment === 'test' ? 'tst' : 'main');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_DISPATCH_TOKEN|days|reportDate|productionSourcesOnly/);
  }
});

test('cross-environment repository/ref and preview-branch mismatches stop before dispatch', async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('must not fetch'); };
  for (const unsafe of [{ GITHUB_ACTIONS_REPOSITORY: 'echospirits/ohlq-field-crm' }, { GITHUB_ACTIONS_REF: 'main' }, { VERCEL_GIT_COMMIT_REF: 'codex/preview' }, { GITHUB_ACTIONS_REPOSITORY: 'foreign/repository' }]) {
    configure(); Object.assign(process.env, unsafe);
    await assert.rejects(dispatchProductionForecastRefresh({ organizationId, requestId }), error => error instanceof ProductionForecastDispatchError && error.code === 'DISPATCH_TARGET_UNSAFE');
  }
  assert.equal(calls, 0);
});

test('foreign organizations and malformed request IDs never reach the workflow API', async () => {
  configure(); let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('must not fetch'); };
  for (const input of [{ organizationId: 'foreign', requestId }, ...['', 'short', 'request;curl-secret', 'request-123\n', '../request-123', 'a'.repeat(101)].map(value => ({ organizationId, requestId: value }))]) {
    await assert.rejects(dispatchProductionForecastRefresh(input), error => error instanceof ProductionForecastDispatchError && error.code === 'INVALID_REFRESH_REQUEST');
  }
  assert.equal(calls, 0);
});

test('provider rejection and network errors never expose credentials or response bodies', async () => {
  configure(); let bodyRead = false;
  globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => { bodyRead = true; return 'PRIVATE_PROVIDER_PAYLOAD'; } }) as Response;
  await assert.rejects(dispatchProductionForecastRefresh({ organizationId, requestId }), error => error instanceof ProductionForecastDispatchError && error.code === 'DISPATCH_REJECTED' && !/PRIVATE/.test(error.message));
  assert.equal(bodyRead, false);
  globalThis.fetch = async () => { throw new Error('PRIVATE_NETWORK_OR_TOKEN'); };
  await assert.rejects(dispatchProductionForecastRefresh({ organizationId, requestId }), error => error instanceof ProductionForecastDispatchError && error.code === 'DISPATCH_UNAVAILABLE' && !/PRIVATE/.test(error.message));
});

function runnerEnvironment(environment: 'test' | 'production' = 'test'): NodeJS.ProcessEnv {
  return { NODE_ENV: 'test', APP_ENV: environment, DATABASE_ENVIRONMENT: environment, DATABASE_TARGET_ID: environment === 'test' ? 'neon-neat-tst' : 'neon-ohlq-field-crm-prod', EXPECTED_DATABASE_HOST: 'ep-example.neon.tech', DATABASE_URL: 'postgresql://owner:PRIVATE@ep-example.neon.tech/neondb', PRODUCTION_BASE_URL: 'https://crm.echospirits.com', GITHUB_REPOSITORY: environment === 'test' ? 'echospirits/neat-tst' : 'echospirits/ohlq-field-crm', GITHUB_REF: environment === 'test' ? 'refs/heads/tst' : 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ID: '123456789', PRODUCTION_FORECAST_REFRESH_REQUEST_ID: requestId, PRODUCTION_FORECAST_REFRESH_ORGANIZATION_ID: organizationId };
}

test('runner derives the exact environment and passes only validated request/run identity to the DB-authoritative service', () => {
  for (const environment of ['test', 'production'] as const) {
    const result = forecastRefreshRunnerContext(runnerEnvironment(environment));
    assert.deepEqual(result, { requestId, organizationId, workflowRunId: '123456789', repository: environment === 'test' ? 'echospirits/neat-tst' : 'echospirits/ohlq-field-crm', environment });
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|DATABASE_URL/);
  }
});

test('runner rejects forged context before any application database or provider can load', () => {
  for (const extra of [{ GITHUB_EVENT_NAME: 'push' }, { GITHUB_REPOSITORY: 'echospirits/ohlq-field-crm' }, { GITHUB_REF: 'refs/heads/main' }, { DATABASE_TARGET_ID: 'production' }, { EXPECTED_DATABASE_HOST: 'foreign.neon.tech' }, { PRODUCTION_FORECAST_REFRESH_ORGANIZATION_ID: 'foreign' }, { PRODUCTION_FORECAST_REFRESH_REQUEST_ID: '$(request)' }, { GITHUB_RUN_ID: '123\n' }]) assert.throws(() => forecastRefreshRunnerContext({ ...runnerEnvironment(), ...extra }));
});

test('runner receipts expose only safe terminal state, replay and numeric counts', () => {
  const context = forecastRefreshRunnerContext(runnerEnvironment());
  const receipt = forecastRefreshRunnerReceipt(context, { status: 'PARTIAL', replayed: false, importedSources: 1, failedSources: 1, reason: 'PRIVATE_PROVIDER_TEXT', token: 'PRIVATE_TOKEN', products: 'PRIVATE_RAW_ROWS' });
  assert.deepEqual(receipt, { requestId, environment: 'test', status: 'PARTIAL', replayed: false, importedSources: 1, failedSources: 1 });
  assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE/);
  assert.equal(forecastRefreshRunnerReceipt(context, { status: 'PRIVATE_FAILURE' }).status, 'FAILED');
});

test('dedicated workflow contains no broad sales task and shares the existing provider lock without input shell interpolation', () => {
  const workflow = readFileSync(new URL('../.github/workflows/production-forecast-refresh.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/); assert.doesNotMatch(workflow, /^  (push|schedule):/m);
  assert.match(workflow, /ohlq-annual-sales-sync-\$\{\{/);
  assert.match(workflow, /cancel-in-progress: false/); assert.match(workflow, /timeout-minutes: 90/);
  assert.match(workflow, /PRODUCTION_FORECAST_REFRESH_REQUEST_ID: \$\{\{ inputs\.requestId \}\}/);
  assert.match(workflow, /PRODUCTION_FORECAST_REFRESH_ORGANIZATION_ID: \$\{\{ inputs\.organizationId \}\}/);
  for (const line of workflow.split(/\r?\n/).filter(line => /^\s+run:/.test(line))) assert.doesNotMatch(line, /\$\{\{/);
  assert.match(workflow, /run: npx tsx scripts\/run-production-forecast-refresh\.ts/);
  assert.doesNotMatch(workflow, /ohlq-annual-sales\.yml|sync:ohlq|backfill|repairTenant|purchaseStateOnly|actions\/upload-artifact/);
});
