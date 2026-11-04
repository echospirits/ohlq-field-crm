import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Data Status includes Account Master freshness and change metrics', () => {
  const page = readFileSync('app/admin/data-status/page.tsx', 'utf8');
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  const importer = readFileSync('scripts/import-ohlq-account-master.ts', 'utf8');

  assert.match(schema, /ACCOUNT_MASTER/);
  assert.match(schema, /BRAND_MASTER/);
  assert.match(page, /<th scope="row">Account Master<\/th>/);
  assert.match(page, /formatRunTime\(latestAccountMasterSuccess\?\.lastSuccessfulAt\)/);
  assert.match(page, /accountMasterMetrics\.created/);
  assert.match(page, /accountMasterMetrics\.deactivated/);
  assert.match(page, /accountMasterMetrics\.updated/);
  assert.match(page, /statusClassName\(latestAccountMasterStatus\)/);
  assert.match(page, /DAILY_DATA_SOURCE_CONFIGS/);
  assert.match(page, /OhlqReportDataSource\.ACCOUNT_MASTER/);
  assert.match(page, /OhlqReportDataSource\.BRAND_MASTER/);
  assert.match(page, /data-status-table-compact/);
  assert.match(page, /recordOhlqReportRunCompleted/);
  assert.match(importer, /createdWholesaleAccounts/);
  assert.match(importer, /deactivatedWholesaleAccounts/);
  assert.match(importer, /updatedWholesaleAccounts/);
  assert.match(importer, /recordOhlqReportRunCompleted/);
});

test('Data Status includes Brand Master freshness and item change metrics', () => {
  const page = readFileSync('app/admin/data-status/page.tsx', 'utf8');
  const importer = readFileSync('lib/ohlqBrandMasterImport.ts', 'utf8');
  const sync = readFileSync('scripts/sync-ohlq-brand-master.ts', 'utf8');

  assert.match(page, /<th scope="row">Brand Master Lookup<\/th>/);
  assert.match(page, /latestBrandMasterSuccess\?\.lastSuccessfulAt/);
  assert.match(page, /brandMasterMetrics\.created/);
  assert.match(page, /brandMasterMetrics\.removed/);
  assert.match(page, /brandMasterMetrics\.updated/);
  assert.match(page, /statusClassName\(latestBrandMasterStatus\)/);
  assert.match(page, /getBrandMasterMetrics/);
  assert.match(importer, /createdItems/);
  assert.match(importer, /removedItems/);
  assert.match(importer, /updatedItems/);
  assert.match(importer, /expected at least/);
  assert.match(sync, /recordOhlqReportRunCompleted/);
});
