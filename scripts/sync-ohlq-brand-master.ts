import fs from 'node:fs';
import path from 'node:path';
import { OhlqReportDataSource } from '@prisma/client';
import { assertSideEffectEnabled, validateRuntimeEnvironment } from '../lib/appEnvironment';
import { loadLocalEnvironmentFile } from '../lib/environmentFile';
import { importOhlqBrandMasterCsv, parseOhlqBrandMasterCsv } from '../lib/ohlqBrandMasterImport';
import { downloadOhlqBrandMaster, getOhlqBrandMasterDate } from '../lib/ohlqAnnualSalesReport';
import {
  recordOhlqReportRunCompleted,
  recordOhlqReportRunErrored,
  recordOhlqReportRunStarted,
} from '../lib/ohlqDataStatus';
import { prisma } from '../lib/prisma';

const getArgValue = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? '' : '';
};

async function main() {
  loadLocalEnvironmentFile('.env.local');
  loadLocalEnvironmentFile('.env');
  const environment = getArgValue('--environment');
  if (!['test', 'production'].includes(environment)) {
    throw new Error('Pass --environment test or --environment production.');
  }

  const apply = process.argv.includes('--apply');
  const runtime = validateRuntimeEnvironment();
  if (runtime.appEnvironment !== environment) {
    throw new Error(`Requested ${environment}, but APP_ENV=${runtime.appEnvironment}.`);
  }
  if (apply) assertSideEffectEnabled('ohlqImport');

  const reportDate = getOhlqBrandMasterDate();
  if (apply) await recordOhlqReportRunStarted({ reportDate, source: OhlqReportDataSource.BRAND_MASTER });
  try {
    const download = await downloadOhlqBrandMaster({
      debugDir: path.join(process.cwd(), 'output', 'playwright'),
      downloadDir: path.join(process.cwd(), 'output', 'ohlq-downloads'),
      headless: true,
      returnBuffer: false,
      useServerlessChromium: false,
    });
    const csv = fs.readFileSync(download.outputPath);

    if (!apply) {
      const parsed = parseOhlqBrandMasterCsv(csv);
      console.log(JSON.stringify({ brandMasterDownload: download, parsedRows: parsed.rows.length, skippedRows: parsed.skippedRows }, null, 2));
      return;
    }

    const result = await importOhlqBrandMasterCsv({ csv });
    const diagnostics = {
      createdItems: result.createdItems,
      organizationsScanned: result.organizationsScanned,
      productsDiscovered: result.productsDiscovered,
      removedItems: result.removedItems,
      unchangedItems: result.unchangedItems,
      updatedItems: result.updatedItems,
    };
    await recordOhlqReportRunCompleted({
      downloadResult: download,
      importResult: { ...result, diagnostics, reportDate: download.reportDate },
      source: OhlqReportDataSource.BRAND_MASTER,
    });
    console.log(JSON.stringify({ brandMasterDownload: download, brandMasterImport: result }, null, 2));
  } catch (error) {
    await recordOhlqReportRunErrored({
      error,
      reportDate,
      source: OhlqReportDataSource.BRAND_MASTER,
    }).catch((statusError) => console.error('Unable to record Brand Master import error status:', statusError));
    throw error;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
