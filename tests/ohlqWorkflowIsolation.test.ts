import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ohlq-annual-sales.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const step = (name: string) => {
  const body = workflow.split(`      - name: ${name}\n`)[1];
  assert.ok(body, `Missing workflow step: ${name}`);
  return body.split('\n      - name: ')[0];
};

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
