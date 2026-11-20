import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { BAILMENT_REPORTING_REPORT_ID, type BailmentReportingInput } from '../lib/ohlqBailmentReporting';
import { syncProductionSources, type ProductionSourceOutcome } from '../lib/productionForecasting/sourceWorkflow';

const now = new Date('2026-11-19T14:00:00Z');
const csvBuffer = Buffer.from('native financial report including today and excluded products');
function fixture(failure?: 'reporting' | 'forecast' | 'direct-policy' | 'provenance') {
  const calls: string[] = [], logs: string[] = [], imports: unknown[] = [];
  let reportingInput: BailmentReportingInput | undefined, outcome: ProductionSourceOutcome | undefined;
  const db = {
    organization: { findMany: async () => [{ id: 'org_echo_spirits', timezone: 'America/New_York', settings: { productionForecasting: { ohio: { historyStart: '2019-01-01', ...(failure === 'direct-policy' ? {} : { directInvoices: 'invoice-date' }) } } } }] },
    productionSourceImport: { upsert: async (data: unknown) => { imports.push(data); } },
  } as unknown as PrismaClient;
  const download = {
    csvBuffer, filename: 'private.csv', outputPath: '/private.csv', reportDate: '2026-11-19', runDate: '2026-11-19', sizeBytes: csvBuffer.length,
    ...(failure === 'provenance' ? {} : { nativeExport: { reportIdentity: BAILMENT_REPORTING_REPORT_ID, requestedFrom: '2019-01-01', requestedTo: '2026-11-19', acquiredAt: '2026-11-19T14:01:00Z', parameterScope: { parameter: 'Brand' as const, values: 'all' as const }, exportCompleted: true as const } }),
  };
  const services = {
    credentials: async () => ({ username: 'private-user', password: 'private-password' }),
    bailment: async () => { calls.push('download'); return download; },
    dc: async () => download,
    reporting: async (input: BailmentReportingInput) => {
      calls.push('reporting'); reportingInput = input;
      if (failure === 'reporting') throw new Error('private-provider-sql');
      return { snapshotId: 'snapshot', rowCount: 6202, contentHash: 'hash', published: true, replay: false, unchanged: false, superseded: false };
    },
    importCsv: async (_csv: string, options: { source: string; end: string }) => {
      calls.push(options.source);
      if (options.source === 'BAILMENT_PO_INVOICE') {
        assert.equal(options.end, '2026-11-18', 'forecast alone clips the incomplete current day');
        if (failure === 'forecast') throw new Error('private-forecast-failure');
      }
      return { id: 'batch', replay: false, rowCount: 1, excludedRows: 0 };
    },
    refresh: async () => ({ id: 'forecast', replay: false, products: 1 }),
  } as unknown as NonNullable<Parameters<typeof syncProductionSources>[0]>['services'];
  return {
    calls, logs, imports, reportingInput: () => reportingInput, outcome: () => outcome,
    run: () => syncProductionSources({ db, services, now, requestId: 'durable-refresh-request', logger: { log: value => logs.push(value), error: value => logs.push(value) }, onResult: value => { outcome = value; } }),
  };
}

test('the full native financial report publishes before forecasting from one download with actual source provenance', async () => {
  const f = fixture(); await f.run();
  assert.deepEqual(f.calls.slice(0, 3), ['download', 'reporting', 'BAILMENT_PO_INVOICE']);
  assert.equal(f.calls.filter(call => call === 'download').length, 1);
  assert.equal(f.reportingInput()?.csvBuffer, csvBuffer);
  assert.equal(f.reportingInput()?.requestedTo, '2026-11-19');
  assert.equal(f.reportingInput()?.requestId, 'durable-refresh-request');
  assert.deepEqual(f.reportingInput()?.parameterScope, { parameter: 'Brand', values: 'all' });
  assert.equal(f.outcome()?.publishedReportingSnapshots, 1);
});

test('a reporting failure preserves independent forecasting progress and surfaces a sanitized partial result', async () => {
  const f = fixture('reporting'); await assert.rejects(f.run, /BAILMENT_REPORTING/);
  assert.equal(f.outcome()?.importedSources, 2);
  assert.equal(f.outcome()?.refreshedForecasts, 1);
  assert.deepEqual(f.outcome()?.failedSources, ['BAILMENT_REPORTING']);
  assert.doesNotMatch(JSON.stringify(f.logs), /private-provider|private-password|private-user/);
});

test('forecast import failure or missing direct-invoice policy cannot discard a completed financial snapshot', async () => {
  for (const failure of ['forecast', 'direct-policy'] as const) {
    const f = fixture(failure); await assert.rejects(f.run, /BAILMENT_PO_INVOICE/);
    assert.equal(f.outcome()?.publishedReportingSnapshots, 1);
    assert.equal(f.outcome()?.importedSources, 1);
    assert.deepEqual(f.outcome()?.failedSources, ['BAILMENT_PO_INVOICE']);
    assert.match(JSON.stringify(f.imports), /dashboard reporting data is retained independently/);
  }
});

test('missing native export evidence fails reporting without fabricating provenance from forecast options', async () => {
  const f = fixture('provenance'); await assert.rejects(f.run, /BAILMENT_REPORTING/);
  assert.equal(f.reportingInput(), undefined);
  assert.equal(f.outcome()?.importedSources, 2);
  assert.match(JSON.stringify(f.logs), /invalid-provenance/);
});
