import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { getGithubActionsDispatchConfig } from '../lib/githubActionsDispatch';

const envKeys = [
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

afterEach(() => {
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

test('GitHub Actions dispatch config resolves repo and ref from environment', () => {
  for (const key of envKeys) delete process.env[key];

  process.env.GITHUB_ACTIONS_DISPATCH_TOKEN = 'token';
  process.env.VERCEL_GIT_COMMIT_REF = 'main';
  process.env.VERCEL_GIT_REPO_OWNER = 'echospirits';
  process.env.VERCEL_GIT_REPO_SLUG = 'ohlq-field-crm';

  assert.deepEqual(getGithubActionsDispatchConfig(), {
    ref: 'main',
    repository: 'echospirits/ohlq-field-crm',
    token: 'token',
    workflowId: 'ohlq-annual-sales.yml',
  });
});
