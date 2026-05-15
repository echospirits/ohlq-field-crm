import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_OHLQ_REPORT_RETENTION_DAYS,
  getOhlqRetentionCutoffDate,
} from '../lib/ohlqAnnualSalesRetention';

describe('OHLQ annual sales retention', () => {
  it('keeps 30 inclusive report dates by default and purges 31-day-old raw rows', () => {
    assert.equal(DEFAULT_OHLQ_REPORT_RETENTION_DAYS, 30);
    assert.equal(
      getOhlqRetentionCutoffDate('2026-05-14', DEFAULT_OHLQ_REPORT_RETENTION_DAYS).toISOString(),
      '2026-04-15T00:00:00.000Z',
    );
  });
});
