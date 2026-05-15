import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getLatestManualOhlqReportDate,
  isFutureOhlqReportDate,
  normalizeManualOhlqReportDate,
} from '../lib/ohlqManualImport';

describe('manual OHLQ import date helpers', () => {
  it('accepts real ISO report dates only', () => {
    assert.equal(normalizeManualOhlqReportDate('2026-05-14'), '2026-05-14');
    assert.equal(normalizeManualOhlqReportDate('05/14/2026'), null);
    assert.equal(normalizeManualOhlqReportDate('2026-02-31'), null);
    assert.equal(normalizeManualOhlqReportDate(''), null);
  });

  it('blocks today or future dates from the manual report import form', () => {
    assert.equal(isFutureOhlqReportDate('2026-05-14', '2026-05-14'), false);
    assert.equal(isFutureOhlqReportDate('2026-05-15', '2026-05-14'), true);
  });

  it('defaults the manual import picker to yesterday in Eastern time', () => {
    assert.equal(getLatestManualOhlqReportDate(new Date('2026-05-15T12:00:00.000Z')), '2026-05-14');
  });
});
