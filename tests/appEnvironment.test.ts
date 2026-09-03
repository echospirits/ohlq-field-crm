import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertDestructiveDatabaseOperationAllowed,
  getAppEnvironment,
  getSideEffectPolicy,
  validateRuntimeEnvironment,
} from '../lib/appEnvironment';
import { getEmailDeliveryPolicy } from '../lib/email/sendEmail';

const production = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  APP_ENV: 'production',
  APP_BASE_URL: 'https://crm.example.com',
  DATABASE_URL: 'postgresql://user:password@prod-db.example.com:5432/neat',
  DATABASE_ENVIRONMENT: 'production',
  DATABASE_TARGET_ID: 'production-db',
  EXPECTED_DATABASE_HOST: 'prod-db.example.com',
  VERCEL: '1',
  VERCEL_ENV: 'production',
  VERCEL_GIT_COMMIT_REF: 'main',
});

const staging = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  APP_ENV: 'test',
  APP_BASE_URL: 'https://tst.example.com',
  DATABASE_URL: 'postgresql://user:password@test-db.example.com:5432/neat',
  DATABASE_ENVIRONMENT: 'test',
  DATABASE_TARGET_ID: 'test-db',
  EXPECTED_DATABASE_HOST: 'test-db.example.com',
  PRODUCTION_BASE_URL: 'https://crm.example.com',
  VERCEL: '1',
  VERCEL_ENV: 'production',
  VERCEL_GIT_COMMIT_REF: 'tst',
});

test('Vercel requires an explicit APP_ENV', () => {
  assert.throws(() => getAppEnvironment({ NODE_ENV: 'test', VERCEL: '1' }), /APP_ENV is required/);
});

test('production and test are restricted to their expected Git branches', () => {
  assert.equal(validateRuntimeEnvironment(production()).appEnvironment, 'production');
  assert.equal(validateRuntimeEnvironment(staging()).appEnvironment, 'test');
  assert.throws(() => validateRuntimeEnvironment({ ...production(), VERCEL_GIT_COMMIT_REF: 'tst' }), /cannot run from branch tst/);
  assert.throws(() => validateRuntimeEnvironment({ ...staging(), VERCEL_GIT_COMMIT_REF: 'main' }), /cannot run from branch main/);
});

test('test base URL cannot resolve to production', () => {
  assert.throws(() => validateRuntimeEnvironment({ ...staging(), APP_BASE_URL: 'https://crm.example.com' }), /must not equal/);
});

test('resource labels must match APP_ENV before runtime access', () => {
  assert.throws(() => validateRuntimeEnvironment({ ...staging(), DATABASE_ENVIRONMENT: 'production' }), /does not match/);
  assert.throws(() => validateRuntimeEnvironment({ ...staging(), BLOB_READ_WRITE_TOKEN: 'configured', BLOB_ENVIRONMENT: 'production' }), /BLOB_ENVIRONMENT/);
  assert.throws(() => validateRuntimeEnvironment({ ...staging(), GOOGLE_CLIENT_ID: 'configured' }), /OAUTH_ENVIRONMENT is required/);
  assert.throws(() => validateRuntimeEnvironment({ ...staging(), DATABASE_URL: production().DATABASE_URL }), /does not match EXPECTED_DATABASE_HOST/);
});

test('non-production side effects default disabled and production defaults enabled', () => {
  assert.deepEqual(getSideEffectPolicy(staging()), {
    calendar: false,
    cron: false,
    email: false,
    fileUploads: false,
    ohlqImport: false,
    webhookRegistration: false,
  });
  assert.deepEqual(getSideEffectPolicy(production()), {
    calendar: true,
    cron: true,
    email: true,
    fileUploads: true,
    ohlqImport: true,
    webhookRegistration: false,
  });
});

test('non-production email cannot send without an override and production cannot override', () => {
  assert.equal(getEmailDeliveryPolicy(staging()).enabled, false);
  assert.throws(() => getEmailDeliveryPolicy({ ...staging(), EMAIL_SEND_ENABLED: 'true' }), /requires EMAIL_OVERRIDE_RECIPIENT/);
  assert.equal(getEmailDeliveryPolicy({ ...staging(), EMAIL_SEND_ENABLED: 'true', EMAIL_OVERRIDE_RECIPIENT: 'safe@example.test' }).overrideRecipient, 'safe@example.test');
  assert.throws(() => getEmailDeliveryPolicy({ ...production(), EMAIL_OVERRIDE_RECIPIENT: 'unsafe@example.test' }), /must not be set in production/);
});

test('database reset is test-only and requires a one-time confirmation', () => {
  assert.throws(() => assertDestructiveDatabaseOperationAllowed(production()), /never allowed in production/);
  assert.throws(() => assertDestructiveDatabaseOperationAllowed(staging()), /ALLOW_DATABASE_RESET=true/);
  assert.doesNotThrow(() => assertDestructiveDatabaseOperationAllowed({ ...staging(), ALLOW_DATABASE_RESET: 'true' }));
});

test('environment banner and protected diagnostics are wired into the app', () => {
  const layout = readFileSync('app/layout.tsx', 'utf8');
  const styles = readFileSync('app/styles.css', 'utf8');
  const diagnostics = readFileSync('app/admin/environment/page.tsx', 'utf8');
  assert.match(layout, /appEnvironment !== 'production'/);
  assert.match(layout, /has-environment-banner/);
  assert.match(layout, /ENVIRONMENT/);
  assert.match(styles, /\.has-environment-banner\s*\{[^}]*padding-top:/s);
  assert.match(styles, /\.environment-banner\s*\{[^}]*position:fixed;/s);
  assert.match(styles, /\.environment-banner\s*\{[^}]*left:0;[^}]*right:0;/s);
  assert.match(diagnostics, /requireAdmin\(\)/);
  assert.doesNotMatch(diagnostics, /DATABASE_URL|CLIENT_SECRET|CRON_SECRET/);
});

test('GitHub OHLQ workflow isolates production and test secrets with GitHub Environments', () => {
  const workflow = readFileSync('.github/workflows/ohlq-annual-sales.yml', 'utf8');
  assert.match(workflow, /deploymentEnvironment:/);
  assert.match(workflow, /environment: \$\{\{/);
  assert.match(workflow, /DATABASE_ENVIRONMENT:/);
  assert.match(workflow, /PRODUCTION_BASE_URL: \$\{\{ vars\.PRODUCTION_BASE_URL \}\}/);
  assert.match(workflow, /github\.repository == 'echospirits\/neat-tst' && 'test' \|\| 'production'/);
});
