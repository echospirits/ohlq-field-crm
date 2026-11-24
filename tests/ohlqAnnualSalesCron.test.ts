import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
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

function cronFixture({ enabled = true, failDispatch = false, configured = true } = {}) {
  const batches: Array<{ reportDates: string[]; dailyLoadDate?: string }> = [];
  const localImports: string[] = [];
  const exports: { GET?: (request: Request) => Promise<Response> } = {};
  const dependencies: Record<string, unknown> = {
    'next/server': { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    '../../../../lib/ohlqAnnualSalesCron': {
      OHLQ_CRON_TIME_ZONE: 'America/New_York',
      getOhlqCronCatchupDays: () => 3, getOhlqCronMaxReportDates: () => 2, getOhlqCronRefreshDays: () => 2,
      getOhlqCronReportDatesToRefresh: () => ['2026-11-18', '2026-11-17'],
      getOhlqCronReportDatesToRun: async () => ['2026-11-18', '2026-11-17'],
    },
    '../../../../lib/githubActionsDispatch': {
      getGithubActionsDispatchConfig: () => configured ? { repository: 'test-repo', ref: 'main' } : null,
      dispatchOhlqAnnualSalesWorkflow: async (input: { reportDates: string[] }) => {
        batches.push(JSON.parse(JSON.stringify(input)));
        if (failDispatch) throw new Error('Workflow unavailable');
        return { repository: 'test-repo', ref: 'main', workflowId: 'ohlq-annual-sales.yml' };
      },
    },
    '../../../../lib/ohlqAnnualSalesReport': { getOhlqAnnualSalesReportDate: (iso: string) => ({ iso }) },
    '../../../../lib/dateTime': {
      formatDateInputValue: (date: Date, timeZone: string) => {
        assert.equal(timeZone, 'America/New_York');
        assert.ok(date instanceof Date);
        return '2026-11-19';
      },
    },
    '../../../../lib/ohlqAnnualSalesWorkflow': {
      runOhlqAnnualSalesWorkflow: async ({ reportDate }: { reportDate: string }) => { localImports.push(reportDate); return { durationMs: 1 }; },
    },
    '../../../../lib/appEnvironment': { isSideEffectEnabled: () => enabled, logEnvironmentEvent: () => undefined },
  };
  const source = ts.transpileModule(readFileSync('app/api/cron/ohlq-annual-sales/route.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(source, {
    exports, URL, Date, process: { env: { CRON_SECRET: 'test-cron-secret', VERCEL: '1' } },
    console: { log: () => undefined, error: () => undefined },
    require: (name: string) => { assert(name in dependencies, name); return dependencies[name]; },
  });
  return {
    batches, localImports,
    request: (query = '', authorization = 'Bearer test-cron-secret') => exports.GET!(new Request(`https://example.test/api/cron/ohlq-annual-sales${query}`, { headers: { authorization } })),
  };
}

describe('OHLQ daily workflow batch dispatch', () => {
  it('queues the two frozen dates once and returns one logical load', async () => {
    const fixture = cronFixture();
    const response = await fixture.request();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(fixture.batches, [{ reportDates: ['2026-11-18', '2026-11-17'], dailyLoadDate: '2026-11-19' }]);
    assert.equal(body.runCount, 1);
    assert.equal(body.runs.length, 1);
    assert.deepEqual(body.runs[0].reportDates, ['2026-11-18', '2026-11-17']);
    assert.equal(fixture.localImports.length, 0);
  });

  it('keeps an explicit report date in one batch', async () => {
    const fixture = cronFixture();
    assert.equal((await fixture.request('?date=2026-11-15')).status, 200);
    assert.deepEqual(fixture.batches, [{ reportDates: ['2026-11-15'] }]);
  });

  it('preserves authentication and side-effect gates before dispatch', async () => {
    const unauthorized = cronFixture();
    assert.equal((await unauthorized.request('', 'Bearer wrong')).status, 401);
    assert.equal(unauthorized.batches.length, 0);
    const disabled = cronFixture({ enabled: false });
    assert.equal((await (await disabled.request()).json()).environmentDisabled, true);
    assert.equal(disabled.batches.length, 0);
  });

  it('reports rejected or missing hosted dispatch without falling back to a local import', async () => {
    for (const options of [{ failDispatch: true }, { configured: false }]) {
      const fixture = cronFixture(options);
      const response = await fixture.request();
      assert.equal(response.status, 500);
      assert.equal((await response.json()).ok, false);
      assert.equal(fixture.localImports.length, 0);
    }
  });
});
