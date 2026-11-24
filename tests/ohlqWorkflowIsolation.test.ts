import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ohlq-annual-sales.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const step = (name: string) => {
  const body = workflow.split(`      - name: ${name}\n`)[1];
  assert.ok(body, `Missing workflow step: ${name}`);
  return body.split(/\n(?:      - name: |  [A-Za-z0-9_-]+:\n)/)[0];
};

test('main schedules one timezone-aware fallback', () => {
  assert.equal(workflow.match(/^    - cron:/gm)?.length, 1);
  assert.match(workflow, /cron: "47 9 \* \* \*"\n      timezone: "America\/New_York"/);
  assert.match(step('Check trigger eligibility'), /REPOSITORY.*echospirits\/ohlq-field-crm/);
});

test('automatic triggers share the load lock and check completeness before any provider work', () => {
  assert.match(workflow, /^concurrency:\n {2}group: ohlq-annual-sales-sync-/m);
  const preflight = step('Check for an already complete daily load');
  assert.match(preflight, /github.event_name == 'schedule' \|\| inputs.dailyLoadDate != ''/);
  assert.match(preflight, /--preflight/);
  assert.match(preflight, /OHLQ_IMPORT_ENABLED: "false"/);
  assert.ok(workflow.indexOf('- name: Check for an already complete daily load') < workflow.indexOf('- name: Install Playwright Chromium'));
  for (const name of ['Install Playwright Chromium', 'Validate required secrets']) {
    assert.match(step(name), /steps.preflight.outputs.already_current != 'true'/);
  }
  assert.match(step('Download and import current OHLQ Account Master'), /steps.required_secrets.outcome == 'success'/);
  assert.match(workflow, /needs.sync.outputs.already_current != 'true'/);
});

test('product discovery cannot block sales or inventory and remains a visible failure', () => {
  assert.match(step('Download and import current OHLQ Brand Master'), /--defer-product-discovery/);
  const discovery = step('Discover organization products after core imports');
  assert.match(discovery, /!cancelled\(\).*steps.brand_master.outcome == 'success'/);
  assert.match(discovery, /steps.brand_master.outputs.imported != 'false'/);
  assert.doesNotMatch(discovery, /continue-on-error/);
  assert.ok(workflow.indexOf('- name: Download and import tenant OHLQ inventory') < workflow.indexOf('- name: Discover organization products after core imports'));
  assert.ok(workflow.indexOf('- name: Discover organization products after core imports') < workflow.indexOf('- name: Refresh post-import intelligence and retention'));
});

test('all frozen sales dates defer statewide intelligence until after inventory', () => {
  const sales = step('Run OHLQ annual sales import');
  assert.match(sales, /--date "\$report_date" --import-only/);
  assert.match(sales, /for report_date in "\$\{dates\[@\]\}"/);
  assert.doesNotMatch(sales, /retry-ohlq-command/);
  assert.match(sales, /npm run backfill:ohlq-annual-sales/);
  assert.doesNotMatch(sales, /--days "\$days" --import-only/);
  assert.ok(workflow.indexOf('- name: Download and import tenant OHLQ inventory') < workflow.indexOf('- name: Refresh post-import intelligence and retention'));
});

test('normal loads finish at an independent mandatory persisted-data verifier', () => {
  const syncJob = workflow.split('\n  sync:\n')[1].split('\n  verify:\n')[0];
  const verifyJob = workflow.split('\n  verify:\n')[1];
  assert.ok(verifyJob);
  assert.match(syncJob, /continue-on-error:/);
  assert.match(syncJob, /inputs.purchaseStateOnly != true.*inputs.productionSourcesOnly != true.*inputs.repairTenantCredentials != true/);
  assert.match(verifyJob, /needs: sync/);
  assert.match(verifyJob, /!cancelled\(\).*needs.sync.outputs.should_run != 'false'/);
  assert.match(verifyJob, /OHLQ_REPORT_DATES: \$\{\{ needs.sync.outputs.report_dates \}\}/);
  assert.match(verifyJob, /OHLQ_OBSERVATION_DATE: \$\{\{ needs.sync.outputs.observation_date \}\}/);
  assert.match(verifyJob, /OHLQ_INPUTS_VALID: \$\{\{ needs.sync.outputs.inputs_valid \}\}/);
  assert.match(verifyJob, /OHLQ_ATTEMPT_STATUS: \$\{\{ needs.sync.outputs.attempt_status \}\}/);
  assert.match(verifyJob, /OHLQ_IMPORT_ENABLED: "false"/);
  assert.match(verifyJob, /EMAIL_SEND_ENABLED: "false"/);
  assert.match(verifyJob, /runs-on: ubuntu-24\.04/);
  assert.match(verifyJob, /timeout-minutes: 15/);
  assert.match(verifyJob, /npx tsx scripts\/verify-ohlq-load\.ts/);
  assert.doesNotMatch(verifyJob, /continue-on-error/);
  assert.doesNotMatch(verifyJob, /secrets\.OHLQ_/);
});

test('a failed sales import permits inventory recovery but cannot refresh intelligence from incomplete sales', () => {
  assert.match(step('Download and import tenant OHLQ inventory'), /!cancelled\(\).*sales_import.outcome != 'skipped'/);
  assert.match(step('Refresh post-import intelligence and retention'), /!cancelled\(\).*sales_import.outcome == 'success'/);
  assert.match(step('Refresh post-import intelligence and retention'), /inputs.purchaseStateOnly != true/);
});

test('backfills refresh intelligence only once at the latest imported date', () => {
  const refresh = step('Refresh post-import intelligence and retention');
  assert.match(refresh, /--date "\$REPORT_DATE" --intelligence-only/);
  assert.match(refresh, /steps.sales_import.outputs.report_date/);
  assert.doesNotMatch(refresh, /--days/);
  assert.doesNotMatch(refresh, /continue-on-error/);
});
test('independent imports survive master failure without bypassing setup, repair, schedule, or cancellation guards', () => {
  const brand = step('Download and import current OHLQ Brand Master');
  const sales = step('Run OHLQ annual sales import');
  assert.match(step('Validate required secrets'), /id: required_secrets/);
  assert.match(step('Repair selected tenant OHLQ credentials'), /id: credential_repair/);
  for (const body of [brand, sales]) {
    assert.match(body, /!cancelled\(\)/);
    assert.match(body, /steps.required_secrets.outcome == 'success'/);
    assert.match(body, /steps.credential_repair.outcome != 'failure'/);
    assert.match(body, /steps.schedule_window.outputs.should_run == 'true'/);
    assert.doesNotMatch(body, /steps.(account_master|brand_master).outcome/);
    assert.doesNotMatch(body, /continue-on-error/);
  }
  assert.match(brand, /inputs.purchaseStateOnly != true/);
  assert.doesNotMatch(step('Download and import current OHLQ Account Master'), /continue-on-error/);
});
