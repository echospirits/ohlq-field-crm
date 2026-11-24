import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { dispatchOhlqAnnualSalesWorkflow, getGithubActionsDispatchConfig } from '../lib/githubActionsDispatch';

const envKeys = [
  'APP_ENV',
  'GITHUB_ACTIONS_DISPATCH_TOKEN',
  'GITHUB_ACTIONS_OHLQ_WORKFLOW_ID',
  'GITHUB_ACTIONS_REF',
  'GITHUB_ACTIONS_REPOSITORY',
  'GITHUB_REPOSITORY',
  'VERCEL_GIT_COMMIT_REF',
  'VERCEL_GIT_REPO_OWNER',
  'VERCEL_GIT_REPO_SLUG',
] as const;

const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of envKeys) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test('GitHub Actions dispatch config is disabled without a token', () => {
  for (const key of envKeys) delete process.env[key];

  assert.equal(getGithubActionsDispatchConfig(), null);
});

test('production GitHub Actions dispatch config resolves repo and defaults to main', () => {
  for (const key of envKeys) delete process.env[key];

  process.env.GITHUB_ACTIONS_DISPATCH_TOKEN = 'token';
  process.env.APP_ENV = 'production';
  process.env.VERCEL_GIT_COMMIT_REF = 'main';
  process.env.VERCEL_GIT_REPO_OWNER = 'echospirits';
  process.env.VERCEL_GIT_REPO_SLUG = 'ohlq-field-crm';

  assert.deepEqual(getGithubActionsDispatchConfig(), {
    deploymentEnvironment: 'production',
    ref: 'main',
    repository: 'echospirits/ohlq-field-crm',
    token: 'token',
    workflowId: 'ohlq-annual-sales.yml',
  });
});

test('test GitHub Actions dispatch config allows only the tst workflow ref', () => {
  for (const key of envKeys) delete process.env[key];

  process.env.GITHUB_ACTIONS_DISPATCH_TOKEN = 'token';
  process.env.APP_ENV = 'test';
  process.env.GITHUB_ACTIONS_REF = 'tst';
  process.env.GITHUB_ACTIONS_REPOSITORY = 'echospirits/ohlq-field-crm';

  assert.deepEqual(getGithubActionsDispatchConfig(), {
    deploymentEnvironment: 'test',
    ref: 'tst',
    repository: 'echospirits/ohlq-field-crm',
    token: 'token',
    workflowId: 'ohlq-annual-sales.yml',
  });
});

function configureDispatch() {
  for (const key of envKeys) delete process.env[key];
  process.env.APP_ENV = 'production';
  process.env.GITHUB_ACTIONS_DISPATCH_TOKEN = 'unit-test-token';
  process.env.GITHUB_ACTIONS_REPOSITORY = 'echospirits/ohlq-field-crm';
}

test('daily dispatch freezes both dates in one workflow request', async () => {
  configureDispatch();
  const requests: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(null, { status: 204 });
  };
  const result = await dispatchOhlqAnnualSalesWorkflow({ reportDates: ['2026-11-18', '2026-11-17'], dailyLoadDate: '2026-11-19' });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    url: 'https://api.github.com/repos/echospirits/ohlq-field-crm/actions/workflows/ohlq-annual-sales.yml/dispatches',
    body: { inputs: { days: '1', deploymentEnvironment: 'production', reportDate: '', reportDates: '2026-11-17,2026-11-18', dailyLoadDate: '2026-11-19' }, ref: 'main' },
  });
  assert.equal(result?.ref, 'main');
});

test('manual single-date dispatch keeps its existing workflow inputs', async () => {
  configureDispatch();
  let body: unknown;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(null, { status: 204 });
  };
  await dispatchOhlqAnnualSalesWorkflow({ reportDate: '2026-11-18' });
  assert.deepEqual(body, { inputs: { days: '1', deploymentEnvironment: 'production', reportDate: '2026-11-18' }, ref: 'main' });
});

test('invalid or conflicting dispatch dates fail before a network request', async () => {
  configureDispatch();
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response(null, { status: 204 }); };
  for (const reportDates of [[], ['2026-02-30'], ['2026-11-18', '2026-11-18'], ['2026-11-18\nmalicious']]) {
    await assert.rejects(dispatchOhlqAnnualSalesWorkflow({ reportDates }));
  }
  await assert.rejects(dispatchOhlqAnnualSalesWorkflow({ reportDate: '2026-11-18', reportDates: ['2026-11-17'] } as never), /one report date selector/);
  assert.equal(calls, 0);
});

test('a rejected workflow dispatch cannot be reported as a queued load', async () => {
  configureDispatch();
  globalThis.fetch = async () => new Response('Workflow rejected', { status: 422 });
  await assert.rejects(dispatchOhlqAnnualSalesWorkflow({ reportDates: ['2026-11-18'] }), /Unable to queue.*422/);
});
