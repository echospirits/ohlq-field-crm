import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { OhlqReportDataSource, type PrismaClient, type Prisma } from '@prisma/client';
import { assertOhlqSourceFreshness, OhlqSourceNotUpdatedError, ohlqStatusLabel } from '../lib/ohlqSourceFreshness';
import { recordOhlqReportRunWarning } from '../lib/ohlqDataStatus';
import { reportOhlqSourceWarning } from '../lib/ohlqWorkflowWarning';

test('only valid older master dates are warnings; current passes and malformed/future dates fail', () => {
  assert.doesNotThrow(() => assertOhlqSourceFreshness('Account Master', '2026-11-02', '2026-11-02'));
  assert.throws(() => assertOhlqSourceFreshness('Account Master', '2026-10-26', '2026-11-02'), OhlqSourceNotUpdatedError);
  for (const date of ['', 'unknown', '2026-02-30', '2026-11-03', '2026-1-01']) {
    assert.throws(() => assertOhlqSourceFreshness('Brand Master', date, '2026-11-02'), error => error instanceof Error && !(error instanceof OhlqSourceNotUpdatedError));
  }
});

test('historical stale master failures display as warnings without hiding unrelated failures or faking success', () => {
  const oldMessage = "The newest Account Master is dated 2026-10-26; expected today's Eastern date 2026-11-02.";
  assert.equal(ohlqStatusLabel('ERRORED', 100, 'ACCOUNT_MASTER', oldMessage), 'Warning');
  assert.equal(ohlqStatusLabel('WARNING', 100), 'Warning');
  for (const [source, message] of [['ANNUAL_SALES_SUMMARY', oldMessage], ['BRAND_MASTER', oldMessage], ['ACCOUNT_MASTER', 'Login failed'], ['ACCOUNT_MASTER', oldMessage.replace('2026-10-26', '2026-11-03')]]) {
    assert.equal(ohlqStatusLabel('ERRORED', 100, source, message), 'Errored');
  }
  assert.equal(ohlqStatusLabel('RUNNING', 100), 'Running');
  assert.equal(ohlqStatusLabel('COMPLETED', 100), 'Completed');
  assert.equal(ohlqStatusLabel(undefined, 0), 'Not Yet Run');
});

test('warning persistence retains last successful import evidence and propagates database failures', async () => {
  const error = new OhlqSourceNotUpdatedError('Brand Master', '2026-10-26', '2026-11-02');
  const calls: Prisma.OhlqReportImportStatusUpsertArgs[] = [];
  const db = { ohlqReportImportStatus: { upsert: async (value: Prisma.OhlqReportImportStatusUpsertArgs) => { calls.push(value); } } } as unknown as PrismaClient;
  await recordOhlqReportRunWarning({ db, error, source: OhlqReportDataSource.BRAND_MASTER, reportDate: '2026-11-02' });
  const input = calls[0];
  assert.equal(input.update.status, 'WARNING');
  assert.equal(input.create.status, 'WARNING');
  assert.equal((input.update.diagnostics as Prisma.JsonObject).availableDate, '2026-10-26');
  for (const field of ['lastSuccessfulAt', 'rowCount', 'filename']) assert.equal(field in input.update, false);
  db.ohlqReportImportStatus.upsert = (async () => { throw new Error('database unavailable'); }) as typeof db.ohlqReportImportStatus.upsert;
  await assert.rejects(recordOhlqReportRunWarning({ db, error, source: OhlqReportDataSource.BRAND_MASTER, reportDate: '2026-11-02' }), /database unavailable/);
});

test('GitHub warning annotation and summary explicitly skip imports without an error annotation', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ohlq-warning-'));
  try {
    const output = path.join(dir, 'output');
    const summary = path.join(dir, 'summary');
    const messages: string[] = [];
    reportOhlqSourceWarning(new OhlqSourceNotUpdatedError('Brand Master', '2026-10-26', '2026-11-02'), { GITHUB_ACTIONS: 'true', GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary }, message => messages.push(message));
    assert.match(messages[0], /^::warning::/);
    assert.doesNotMatch(messages[0], /::error::/);
    assert.equal(readFileSync(output, 'utf8'), 'imported=false\n');
    assert.match(readFileSync(summary, 'utf8'), /Import skipped; previously imported data retained/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('both master callers handle only typed stale sources and do not suppress warning persistence errors', () => {
  for (const source of ['account', 'brand']) {
    const script = readFileSync(new URL(`../scripts/sync-ohlq-${source}-master.ts`, import.meta.url), 'utf8');
    assert.match(script, /error instanceof OhlqSourceNotUpdatedError/);
    assert.match(script, /if \(apply\) await recordOhlqReportRunWarning/);
    assert.match(script, /reportOhlqSourceWarning\(error\);\s+return;/);
    assert.match(script, /throw error/);
    assert.doesNotMatch(script, /recordOhlqReportRunWarning\([^;]+\.catch/);
  }
});
