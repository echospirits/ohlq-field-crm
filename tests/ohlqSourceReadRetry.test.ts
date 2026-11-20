import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { isTransientOhlqSourceReadError, retryOhlqSourceRead } from '../lib/ohlqSourceReadRetry';

const transient = () => Object.assign(new Error('HTTP 503 PRIVATE_PROVIDER_DETAIL'), { status: 503 });
const immediateRetry = <T>(read: () => Promise<T>) => retryOhlqSourceRead(read, { sleep: async () => {}, warn: () => {} });
const logger = { log() {}, error() {} };

test('source read retries are bounded, preserve the original error and emit no private provider details', async () => {
  const error = transient(), sleeps: number[] = [], warnings: string[] = [];
  let attempts = 0;
  await assert.rejects(retryOhlqSourceRead(async () => { attempts++; throw error; }, {
    sleep: async (ms) => { sleeps.push(ms); }, warn: (message) => { warnings.push(message); },
  }), (caught) => caught === error);
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [15000, 30000]);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((message) => !message.includes('PRIVATE_PROVIDER_DETAIL')));
  attempts = 0;
  assert.equal(await immediateRetry(async () => { if (++attempts === 1) throw error; return 'download'; }), 'download');
  assert.equal(attempts, 2);
});

test('only recognized HTTP and browser/network read failures qualify for recovery', () => {
  for (const error of [
    { status: 429 }, { statusCode: 502 }, { response: { status: 503 } }, { status: 504 },
    { code: 'ECONNRESET' }, { cause: { code: 'EAI_AGAIN' } },
    new Error('page.goto: net::ERR_CONNECTION_RESET at https://private.example'),
    Object.assign(new Error('page.goto: Timeout 30000ms exceeded'), { name: 'TimeoutError' }),
    new Error('Download did not finish saving within 2 minutes.'),
  ]) assert.equal(isTransientOhlqSourceReadError(error), true, JSON.stringify(error));
  for (const error of [new Error('503 source rows'), new Error('page.locator: Timeout 30000ms exceeded'), new Error('Unknown parse failure'), { status: 500 }, 'HTTP 503', null]) {
    assert.equal(isTransientOhlqSourceReadError(error), false);
  }
});

test('authentication, permission, schema, stale-source and cancellation failures never retry even with transient wording', async () => {
  for (const error of [
    { status: 401, message: 'earlier HTTP 503' }, { status: 403, cause: { code: 'ECONNRESET' } },
    { code: 'P1001', message: 'HTTP 503' }, { name: 'PrismaClientKnownRequestError', message: 'HTTP 503' },
    { name: 'AbortError', message: 'HTTP 503' }, { code: 'ERR_CANCELED', cause: { code: 'ECONNRESET' } },
    { name: 'OhlqSourceNotUpdatedError', message: 'HTTP 503' },
    new Error('incorrect username or password; HTTP 503'), new Error('Access denied; HTTP 503'),
    new Error('Sign-in timed out; HTTP 503'), new Error('column secret does not exist; HTTP 503'),
    { status: 503, cause: { message: 'authentication failed' } },
  ]) {
    let calls = 0;
    await assert.rejects(immediateRetry(async () => { calls++; throw error; }), (caught) => caught === error);
    assert.equal(calls, 1);
  }
});

const nativeRequire = createRequire(import.meta.url);
function moduleFixture<T>(file: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}): T {
  const exports = {};
  const source = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  runInNewContext(source, {
    exports, process: { env: {} }, Buffer, console: logger, ...globals,
    require: (name: string) => {
      if (['os', 'path', 'node:os', 'node:path', 'node:crypto'].includes(name)) return nativeRequire(name);
      assert(name in dependencies, `Unexpected dependency ${name}`);
      return dependencies[name];
    },
  });
  return exports as T;
}

test('shared sales retry the download before imports and never replay an import/reconciliation error', async () => {
  for (const failImport of [false, true]) {
    let downloads = 0, imports = 0, reconciliations = 0;
    const dependencies = {
      '@prisma/client': { OhlqReportDataSource: { ANNUAL_SALES_SUMMARY: 'RETAIL', ANNUAL_SALES_SUMMARY_BY_WHOLESALE: 'WHOLESALE' } },
      './ohlqAnnualSalesImport': {
        importOhlqAnnualSalesCsv: async () => { imports++; if (failImport) throw transient(); return {}; },
        importOhlqAnnualSalesByWholesaleCsv: async () => { imports++; return { wholesaleOrderReconciliation: { ambiguousOrderIds: [] }, echoPurchaseState: { unmatchedPermitNumbers: [] } }; },
      },
      './ohlqAnnualSalesRetention': {}, './agencyMarketIntelligenceService': {}, './opportunityEngine': {}, './ohlqTenantInventoryWorkflow': {},
      './ohlqDataStatus': { OHLQ_DATA_SOURCE_CONFIGS: [{ source: 'RETAIL' }, { source: 'WHOLESALE' }], recordOhlqReportRunStarted: async () => {}, recordOhlqReportRunCompleted: async () => {}, recordOhlqReportRunErrored: async () => {}, toOhlqDateOnlyUtc: (value: string) => new Date(value) },
      './ohlqAnnualSalesReport': {
        getOhlqAnnualSalesReportDate: (iso: string) => ({ iso }),
        downloadOhlqSharedSalesReports: async () => {
          if (++downloads === 1) throw transient();
          const download = { csvBuffer: Buffer.from('csv'), reportDate: '2026-11-18' };
          return { annualSalesSummary: download, annualSalesSummaryByWholesale: download };
        },
      },
      './tenantConfig': { getTenantConfig: () => ({ productLabel: 'test' }) },
      './accountSalesStatus': { reconcileAccountSalesStatusAfterImport: async () => { reconciliations++; return { transitioned: 0 }; } },
      './wholesaleAssessmentService': { markWholesaleAssessmentSourceFailure: async () => {} },
      './ohlqSourceReadRetry': { retryOhlqSourceRead: immediateRetry },
    };
    const loaded = moduleFixture<{ runOhlqAnnualSalesWorkflow: (input: unknown) => Promise<unknown> }>('lib/ohlqAnnualSalesWorkflow.ts', dependencies);
    const run = loaded.runOhlqAnnualSalesWorkflow({ reportDate: '2026-11-18', deferIntelligence: true, logger });
    if (failImport) await assert.rejects(run); else await run;
    assert.equal(downloads, 2);
    assert.equal(imports, failImport ? 1 : 2);
    assert.equal(reconciliations, failImport ? 0 : 1);
  }
});

test('tenant inventory retries source reads without replaying imports or failed retail intelligence', async () => {
  for (const failedStage of ['none', 'import', 'intelligence']) {
    let downloads = 0, imports = 0, refreshes = 0;
    const loaded = moduleFixture<{ runOhlqTenantInventoryWorkflow: (input: unknown) => Promise<unknown> }>('lib/ohlqTenantInventoryWorkflow.ts', {
      './databaseReadRetry': { retryDatabaseRead: (read: () => unknown) => read() },
      '@prisma/client': { OhlqReportDataSource: { ANNUAL_SALES_SUMMARY: 'RETAIL' }, OhlqReportRunStatus: { COMPLETED: 'COMPLETED' } },
      './agencyIntelligenceService': {}, './ohlqAgencyInventoryImport': {}, './ohlqTenantCredentials': {}, './prisma': {},
      './ohlqAnnualSalesReport': { getOhlqAgencyInventoryObservationDate: () => '2026-11-19' },
      './ohlqTenantInventoryStatus': { startTenantInventoryRun: async () => {}, completeTenantInventoryRun: async () => {}, errorTenantInventoryRun: async () => {} },
      './echoAccess': { ECHO_ORGANIZATION_ID: 'org_echo_spirits' },
      './ohlqSourceReadRetry': { retryOhlqSourceRead: immediateRetry },
    }, { process: { env: { OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY: 'fixture-only' } } });
    const run = loaded.runOhlqTenantInventoryWorkflow({
      logger,
      db: { organization: { findMany: async () => [{ id: 'org_echo_spirits', features: [{}], accountOverlays: [] }] }, ohlqReportImportStatus: { findFirst: async () => ({ reportDate: new Date('2026-11-18') }) } },
      services: {
        credentials: async () => ({ username: 'fixture', password: 'fixture' }),
        download: async () => { if (++downloads === 1) throw transient(); return { csvBuffer: Buffer.from('csv'), reportDate: '2026-11-19' }; },
        importCsv: async () => { imports++; if (failedStage === 'import') throw transient(); return { importedRows: 1 }; },
        refresh: async () => { refreshes++; if (failedStage === 'intelligence') throw transient(); },
      },
    });
    if (failedStage === 'none') await run; else await assert.rejects(run);
    assert.equal(downloads, 2);
    assert.equal(imports, 1);
    assert.equal(refreshes, failedStage === 'import' ? 0 : 1);
  }
});

test('production sources retry each read while reporting, import and forecast writes run at most once', async () => {
  for (const failedWrite of ['none', 'import', 'reporting']) {
    const reads = { bailment: 0, dc: 0 }; let reporting = 0, imports = 0, forecasts = 0;
    const loaded = moduleFixture<{ syncProductionSources: (input: unknown) => Promise<unknown> }>('lib/productionForecasting/sourceWorkflow.ts', {
      '../prisma': {}, '../echoAccess': { ECHO_ORGANIZATION_ID: 'org_echo_spirits' }, '../ohlqTenantCredentials': {}, '../ohlqAnnualSalesReport': {},
      '../ohlqBailmentReporting': { BailmentReportingError: class extends Error {} },
      '../dateTime': { formatDateInputValue: () => '2026-11-19' }, './import': {}, './model': { shift: () => '2026-11-18' },
      './sourceConfiguration': { ohioSourceConfiguration: () => ({ historyStart: '2019-01-01', directInvoices: 'invoice-date' }) },
      './service': {}, './operationalSignals/workflow': {}, '../ohlqSourceReadRetry': { retryOhlqSourceRead: immediateRetry },
    });
    const read = async (source: keyof typeof reads) => {
      if (++reads[source] === 1) throw transient();
      return { csvBuffer: Buffer.from('csv'), reportDate: '2026-11-19', sizeBytes: 3,
        nativeExport: { reportIdentity: 'bdf38254-b332-4d12-b689-1113a2644a40', requestedFrom: '2019-01-01', requestedTo: '2026-11-19', acquiredAt: '2026-11-19T16:01:00Z', parameterScope: { parameter: 'Vendor', values: 'all' }, exportCompleted: true } };
    };
    const run = loaded.syncProductionSources({
      logger,
      db: { organization: { findMany: async () => [{ id: 'org_echo_spirits', timezone: 'America/New_York' }] }, productionSourceImport: { upsert: async () => ({}) } },
      services: {
        credentials: async () => ({ username: 'fixture', password: 'fixture' }), bailment: () => read('bailment'), dc: () => read('dc'),
        reporting: async () => { reporting++; if (failedWrite === 'reporting') throw transient(); return { published: true, replay: false, superseded: false, rowCount: 1 }; },
        importCsv: async () => { imports++; if (failedWrite === 'import') throw transient(); return { replay: false, rowCount: 1, excludedRows: 0 }; },
        refresh: async () => { forecasts++; },
      },
    });
    if (failedWrite !== 'none') await assert.rejects(run); else await run;
    assert.deepEqual(reads, { bailment: 2, dc: 2 });
    assert.equal(reporting, 1); assert.equal(imports, 2); assert.equal(forecasts, 1);
  }
});

test('master workflows retry only downloads, never their importer after a committed or failed write', async () => {
  for (const master of ['account', 'brand']) for (const failImport of [false, true]) {
    let downloads = 0, imports = 0;
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const process = { platform: 'linux', argv: ['node', 'script', '--environment', 'test', '--apply'], env: {}, exitCode: 0 };
    const download = async () => { if (++downloads === 1) throw transient(); return { outputPath: 'fixture.csv', reportDate: '2026-11-19' }; };
    moduleFixture(`scripts/sync-ohlq-${master}-master.ts`, {
      'node:child_process': { spawn: () => { imports++; const child = new EventEmitter(); queueMicrotask(() => child.emit('exit', failImport ? 1 : 0, null)); return child; } },
      'node:fs': { readFileSync: () => Buffer.from('csv') },
      '@prisma/client': { OhlqReportDataSource: { ACCOUNT_MASTER: 'ACCOUNT_MASTER', BRAND_MASTER: 'BRAND_MASTER' } },
      '../lib/ohlqSourceFreshness': { OhlqSourceNotUpdatedError: class extends Error {} }, '../lib/ohlqWorkflowWarning': {},
      '../lib/ohlqDataStatus': { recordOhlqReportRunStarted: async () => {}, recordOhlqReportRunCompleted: async () => {}, recordOhlqReportRunErrored: async () => {} },
      '../lib/appEnvironment': { validateRuntimeEnvironment: () => ({ appEnvironment: 'test' }), assertSideEffectEnabled: () => {} },
      '../lib/environmentFile': { loadLocalEnvironmentFile: () => {} },
      '../lib/ohlqAnnualSalesReport': { downloadOhlqAccountMaster: download, getOhlqAccountMasterDate: () => '2026-11-19', downloadOhlqBrandMaster: download, getOhlqBrandMasterDate: () => '2026-11-19' },
      '../lib/ohlqBrandMasterImport': { importOhlqBrandMasterCsv: async () => { imports++; if (failImport) throw transient(); return {}; } },
      '../lib/prisma': { prisma: { $disconnect: async () => { finish(); } } },
      '../lib/ohlqSourceReadRetry': { retryOhlqSourceRead: immediateRetry },
    }, { process });
    await finished;
    assert.equal(downloads, 2, master); assert.equal(imports, 1, master);
    assert.equal(process.exitCode, failImport ? 1 : 0, master);
  }
});
