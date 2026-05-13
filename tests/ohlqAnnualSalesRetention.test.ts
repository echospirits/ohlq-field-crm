import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_OHLQ_REPORT_RETENTION_DAYS,
  getOhlqReportRetentionDays,
  getOhlqRetentionCutoffDate,
} from '../lib/ohlqAnnualSalesRetention';

describe('getOhlqReportRetentionDays', () => {
  it('defaults to the configured raw OHLQ retention window', () => {
    assert.equal(getOhlqReportRetentionDays(''), DEFAULT_OHLQ_REPORT_RETENTION_DAYS);
    assert.equal(getOhlqReportRetentionDays(undefined), DEFAULT_OHLQ_REPORT_RETENTION_DAYS);
  });

  it('accepts positive whole day counts', () => {
    assert.equal(getOhlqReportRetentionDays('30'), 30);
  });

  it('rejects invalid retention values', () => {
    assert.throws(() => getOhlqReportRetentionDays('0'), /positive whole number/i);
    assert.throws(() => getOhlqReportRetentionDays('14.5'), /positive whole number/i);
    assert.throws(() => getOhlqReportRetentionDays('soon'), /positive whole number/i);
  });
});

describe('getOhlqRetentionCutoffDate', () => {
  it('keeps the requested number of report dates including the current report date', () => {
    assert.equal(getOhlqRetentionCutoffDate('2026-05-12', 30).toISOString(), '2026-04-13T00:00:00.000Z');
    assert.equal(getOhlqRetentionCutoffDate('2026-05-12', 1).toISOString(), '2026-05-12T00:00:00.000Z');
  });
});
