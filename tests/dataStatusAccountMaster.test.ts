import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Data Status includes Account Master freshness and change metrics', () => {
  const page = readFileSync('app/admin/data-status/page.tsx', 'utf8');
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  const importer = readFileSync('scripts/import-ohlq-account-master.ts', 'utf8');

  assert.match(schema, /ACCOUNT_MASTER/);
  assert.match(schema, /BRAND_MASTER/);
  assert.match(page, /<h2>Account Master<\/h2>/);
  assert.match(page, /Most recent successful load/);
  assert.match(page, /Created/);
  assert.match(page, /Deleted \/ deactivated/);
  assert.match(page, /Updated/);
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
