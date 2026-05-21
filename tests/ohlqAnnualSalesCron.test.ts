import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OhlqReportDataSource, OhlqReportRunStatus } from '@prisma/client';
import {
  DEFAULT_OHLQ_CRON_CATCHUP_DAYS,
  DEFAULT_OHLQ_CRON_MAX_REPORT_DATES,
  DEFAULT_OHLQ_CRON_REFRESH_DAYS,
  getOhlqCronCandidateReportDates,
  getOhlqCronCatchupDays,
  getOhlqCronMaxReportDates,
  getOhlqCronRefreshDays,
  getOhlqCronReportDatesToRefresh,
  selectOhlqCronReportDatesNeedingImport,
} from '../lib/ohlqAnnualSalesCron';

describe('OHLQ annual sales cron date selection', () => {
  it('targets yesterday in Eastern time plus recent catch-up dates', () => {
    assert.deepEqual(
      getOhlqCronCandidateReportDates(new Date('2026-05-15T12:00:00.000Z'), 3),
      ['2026-05-14', '2026-05-13', '2026-05-12'],
    );
  });

  it('only skips dates when both OHLQ data sources completed successfully', () => {
    const selected = selectOhlqCronReportDatesNeedingImport({
      candidateReportDates: ['2026-05-14', '2026-05-13', '2026-05-12'],
      maxReportDates: 2,
      statuses: [
        {
          dataSource: OhlqReportDataSource.ANNUAL_SALES_SUMMARY,
          reportDate: new Date('2026-05-14T00:00:00.000Z'),
          status: OhlqReportRunStatus.COMPLETED,
        },
        {
          dataSource: OhlqReportDataSource.ANNUAL_SALES_SUMMARY_BY_WHOLESALE,
          reportDate: new Date('2026-05-14T00:00:00.000Z'),
          status: OhlqReportRunStatus.COMPLETED,
        },
        {
          dataSource: OhlqReportDataSource.ANNUAL_SALES_SUMMARY,
          reportDate: new Date('2026-05-13T00:00:00.000Z'),
          status: OhlqReportRunStatus.COMPLETED,
        },
        {
          dataSource: OhlqReportDataSource.ANNUAL_SALES_SUMMARY_BY_WHOLESALE,
          reportDate: new Date('2026-05-13T00:00:00.000Z'),
          status: OhlqReportRunStatus.ERRORED,
        },
      ],
    });

    assert.deepEqual(selected, ['2026-05-13', '2026-05-12']);
  });

  it('bounds catch-up configuration to conservative limits', () => {
    assert.equal(getOhlqCronCatchupDays(''), DEFAULT_OHLQ_CRON_CATCHUP_DAYS);
    assert.equal(getOhlqCronCatchupDays('99'), 14);
    assert.equal(getOhlqCronMaxReportDates(''), DEFAULT_OHLQ_CRON_MAX_REPORT_DATES);
    assert.equal(getOhlqCronMaxReportDates('99'), 5);
  });

  it('refreshes yesterday and two days ago by default for early scheduled dispatches', () => {
    assert.equal(getOhlqCronRefreshDays(''), DEFAULT_OHLQ_CRON_REFRESH_DAYS);
    assert.equal(getOhlqCronRefreshDays('99'), 5);
    assert.deepEqual(getOhlqCronReportDatesToRefresh(new Date('2026-05-21T11:00:00.000Z')), [
      '2026-05-20',
      '2026-05-19',
    ]);
  });
});
