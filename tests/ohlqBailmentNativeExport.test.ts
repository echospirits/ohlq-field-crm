import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  getOhlqAgencyInventoryReportConfig,
  getOhlqAnnualSalesReportDate,
  OHLQ_ANNUAL_SALES_SUMMARY_REPORT,
  OHLQ_ANNUAL_SALES_BY_WHOLESALE_REPORT,
  OHLQ_BAILMENT_INVOICE_REPORT,
  OHLQ_DC_INVENTORY_REPORT,
  saveOhlqPowerBiReportDownload,
} from '../lib/ohlqAnnualSalesReport';

function downloadRuntime(context: TestContext, returnBuffer = true) {
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ohlq-native-export-'));
  context.after(() => fs.rmSync(downloadDir, { recursive: true, force: true }));
  return {
    downloadDir,
    logger: { log() {}, error() {} },
    fromDate: getOhlqAnnualSalesReportDate('2024-01-01'),
    reportDate: getOhlqAnnualSalesReportDate('2026-11-18'),
    runDateIso: '2026-11-19',
    returnBuffer,
  };
}

const source = Buffer.from('native,csv\r\n"example, value",00123\r\n');
const sourceBytes = Uint8Array.from(source);
const savedDownload = { saveAs: async (outputPath: string) => { fs.writeFileSync(outputPath, sourceBytes); } };

test('Bailment provenance is produced only after the native download saves and records the selected range', async context => {
  const runtime = downloadRuntime(context);
  const startedAt = Date.parse('2026-11-19T12:00:00.000Z');
  const completedAt = Date.parse('2026-11-19T12:01:00.000Z');
  context.mock.timers.enable({ apis: ['Date'], now: startedAt });
  let finishSave!: () => void;
  const saving = saveOhlqPowerBiReportDownload({
    saveAs: outputPath => new Promise<void>(resolve => {
      finishSave = () => {
        fs.writeFileSync(outputPath, sourceBytes);
        context.mock.timers.setTime(completedAt);
        resolve();
      };
    }),
  }, OHLQ_BAILMENT_INVOICE_REPORT, runtime, { name: 'Vendor', values: 'all' });
  let finished = false;
  void saving.then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false, 'a started download is not a completed native export');
  finishSave();
  const result = await saving;

  assert.deepEqual(result.nativeExport, {
    reportIdentity: OHLQ_BAILMENT_INVOICE_REPORT.reportId,
    parameterScope: { parameter: 'Vendor', values: 'all' },
    requestedFrom: '2024-01-01',
    requestedTo: '2026-11-18',
    acquiredAt: '2026-11-19T12:01:00.000Z',
    exportCompleted: true,
  });
  assert.deepEqual(result.csvBuffer, source);
  assert.deepEqual(fs.readFileSync(result.outputPath), source);
  assert.equal(result.sizeBytes, source.length);
  assert.equal(result.reportDate, '2026-11-18');
  assert.equal(result.runDate, '2026-11-19');
});

test('Bailment provenance records the resolved Brand fallback and verifies the file without returning bytes', async context => {
  const result = await saveOhlqPowerBiReportDownload(
    savedDownload,
    OHLQ_BAILMENT_INVOICE_REPORT,
    downloadRuntime(context, false),
    { name: 'Brand', values: 'all' },
  );
  assert.deepEqual(result.nativeExport?.parameterScope, { parameter: 'Brand', values: 'all' });
  assert.equal(result.csvBuffer, undefined);
  assert.equal(result.sizeBytes, source.length);
  assert.equal(result.nativeExport?.exportCompleted, true);
});

test('failed, missing, empty, or unreadable Bailment downloads do not return a completion receipt', async context => {
  const runtime = downloadRuntime(context, false);
  for (const saveAs of [
    async (outputPath: string) => { fs.writeFileSync(outputPath, sourceBytes); throw new Error('save failed'); },
    async () => {},
    async (outputPath: string) => { fs.writeFileSync(outputPath, ''); },
    async (outputPath: string) => { fs.mkdirSync(outputPath); },
  ]) {
    for (const filename of fs.readdirSync(runtime.downloadDir)) {
      fs.rmSync(path.join(runtime.downloadDir, filename), { recursive: true, force: true });
    }
    await assert.rejects(saveOhlqPowerBiReportDownload(
      { saveAs }, OHLQ_BAILMENT_INVOICE_REPORT, runtime, { name: 'Vendor', values: 'all' },
    ));
  }
});

test('Bailment completion cannot claim an all-values date range for a partial parameter selection', async context => {
  const runtime = downloadRuntime(context);
  await assert.rejects(saveOhlqPowerBiReportDownload(
    savedDownload, OHLQ_BAILMENT_INVOICE_REPORT, runtime, { name: 'Vendor', values: ['one-vendor'] },
  ), /requires a date range and all parameter values/);
  await assert.rejects(saveOhlqPowerBiReportDownload(
    savedDownload, { ...OHLQ_BAILMENT_INVOICE_REPORT, dateRange: false }, runtime, { name: 'Vendor', values: 'all' },
  ), /requires a date range and all parameter values/);
});

test('other native reports retain their existing result shape and date behavior without Bailment provenance', async context => {
  const runtime = downloadRuntime(context);
  for (const report of [
    OHLQ_ANNUAL_SALES_SUMMARY_REPORT,
    OHLQ_ANNUAL_SALES_BY_WHOLESALE_REPORT,
    OHLQ_DC_INVENTORY_REPORT,
    getOhlqAgencyInventoryReportConfig(),
  ]) {
    const result = await saveOhlqPowerBiReportDownload(savedDownload, report, runtime, report.parameter);
    const filename = `ohlq-${report.fileSlug}-2026-11-19.csv`;
    assert.deepEqual(result, {
      csvBuffer: source,
      filename,
      outputPath: path.join(runtime.downloadDir, filename),
      reportDate: report.dateRange ? '2026-11-18' : '2026-11-19',
      runDate: '2026-11-19',
      sizeBytes: source.length,
    });
    assert.equal(Object.hasOwn(result, 'nativeExport'), false);
  }
  const empty = await saveOhlqPowerBiReportDownload(
    { saveAs: async outputPath => { fs.writeFileSync(outputPath, ''); } },
    OHLQ_ANNUAL_SALES_SUMMARY_REPORT,
    { ...runtime, returnBuffer: false },
    { name: 'Vendor', values: 'all' },
  );
  assert.equal(empty.sizeBytes, 0, 'the new Bailment validation does not change other report downloads');
  assert.equal(empty.csvBuffer, undefined);
  assert.equal(Object.hasOwn(empty, 'nativeExport'), false);
});
