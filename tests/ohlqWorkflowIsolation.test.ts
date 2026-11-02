import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ohlq-annual-sales.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const step = (name: string) => {
  const body = workflow.split(`      - name: ${name}\n`)[1];
  assert.ok(body, `Missing workflow step: ${name}`);
  return body.split('\n      - name: ')[0];
};

test('product discovery cannot block sales or inventory and remains a visible failure', () => {
  assert.match(step('Download and import current OHLQ Brand Master'), /--defer-product-discovery/);
  const discovery = step('Discover organization products after core imports');
  assert.match(discovery, /!cancelled\(\).*steps.brand_master.outcome == 'success'/);
  assert.match(discovery, /steps.brand_master.outputs.imported != 'false'/);
  assert.doesNotMatch(discovery, /continue-on-error/);
  assert.ok(workflow.indexOf('- name: Download and import tenant OHLQ inventory') < workflow.indexOf('- name: Discover organization products after core imports'));
  assert.ok(workflow.indexOf('- name: Discover organization products after core imports') < workflow.indexOf('- name: Refresh post-import intelligence and retention'));
});

test('both sales dispatch paths defer statewide intelligence until after inventory', () => {
  const sales = step('Run OHLQ annual sales import');
  assert.match(sales, /--date "\$report_date" --import-only/);
  assert.match(sales, /--days "\$days" --import-only/);
  assert.ok(workflow.indexOf('- name: Download and import tenant OHLQ inventory') < workflow.indexOf('- name: Refresh post-import intelligence and retention'));
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
