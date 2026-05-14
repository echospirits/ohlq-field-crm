import os from 'os';
import path from 'path';
import { OhlqReportDataSource } from '@prisma/client';
import {
  importOhlqAnnualSalesByWholesaleCsv,
  importOhlqAnnualSalesCsv,
} from './ohlqAnnualSalesImport';
import { pruneOhlqAnnualSalesRows } from './ohlqAnnualSalesRetention';
import { syncOhlqWholesaleReactivationWorklist } from './ohlqWholesaleReactivation';
import {
  downloadOhlqAnnualSalesReports,
  getOhlqAnnualSalesReportDate,
  type OhlqAnnualSalesDownloadOptions,
} from './ohlqAnnualSalesReport';
import {
  OHLQ_DATA_SOURCE_CONFIGS,
  recordOhlqReportRunCompleted,
  recordOhlqReportRunErrored,
  recordOhlqReportRunStarted,
} from './ohlqDataStatus';

type Logger = Pick<Console, 'error' | 'log'>;

export type OhlqAnnualSalesWorkflowOptions = {
  downloadOptions?: OhlqAnnualSalesDownloadOptions;
  logger?: Logger;
  reportDate?: string;
};

const defaultDownloadOptions = (): OhlqAnnualSalesDownloadOptions => ({
  debugDir: path.join(os.tmpdir(), 'ohlq-playwright'),
  downloadDir: path.join(os.tmpdir(), 'ohlq-downloads'),
  headless: true,
  returnBuffer: true,
  useServerlessChromium: process.env.VERCEL === '1',
});

const sourceOrder = OHLQ_DATA_SOURCE_CONFIGS.map((config) => config.source);

const safeMarkErrored = async ({
  completedSources,
  error,
  logger,
  reportDate,
}: {
  completedSources: Set<OhlqReportDataSource>;
  error: unknown;
  logger: Logger;
  reportDate: string;
}) => {
  const pendingSources = sourceOrder.filter((source) => !completedSources.has(source));

  await Promise.all(
    pendingSources.map((source) =>
      recordOhlqReportRunErrored({ error, reportDate, source }).catch((statusError) => {
        logger.error(`Unable to record OHLQ import error status for ${source}:`, statusError);
      }),
    ),
  );
};

export async function runOhlqAnnualSalesWorkflow(options: OhlqAnnualSalesWorkflowOptions = {}) {
  const logger = options.logger ?? console;
  const reportDate = getOhlqAnnualSalesReportDate(options.reportDate).iso;
  const startedAt = Date.now();
  const completedSources = new Set<OhlqReportDataSource>();

  await Promise.all(sourceOrder.map((source) => recordOhlqReportRunStarted({ reportDate, source })));

  try {
    const { annualSalesSummary: annualSalesDownload, annualSalesSummaryByWholesale: wholesaleDownload } =
      await downloadOhlqAnnualSalesReports({
        ...defaultDownloadOptions(),
        ...options.downloadOptions,
        logger,
        reportDate,
        returnBuffer: true,
      });

    if (!annualSalesDownload.csvBuffer) {
      throw new Error('Annual Sales Summary CSV download completed, but no CSV buffer was returned for import.');
    }

    const annualSalesImport = await importOhlqAnnualSalesCsv({
      csv: annualSalesDownload.csvBuffer,
      reportDate: annualSalesDownload.reportDate,
    });

    await recordOhlqReportRunCompleted({
      downloadResult: annualSalesDownload,
      importResult: annualSalesImport,
      source: OhlqReportDataSource.ANNUAL_SALES_SUMMARY,
    });
    completedSources.add(OhlqReportDataSource.ANNUAL_SALES_SUMMARY);

    if (!wholesaleDownload.csvBuffer) {
      throw new Error(
        'Annual Sales Summary by Wholesale CSV download completed, but no CSV buffer was returned for import.',
      );
    }

    const wholesaleImport = await importOhlqAnnualSalesByWholesaleCsv({
      csv: wholesaleDownload.csvBuffer,
      reportDate: wholesaleDownload.reportDate,
    });

    await recordOhlqReportRunCompleted({
      downloadResult: wholesaleDownload,
      importResult: wholesaleImport,
      source: OhlqReportDataSource.ANNUAL_SALES_SUMMARY_BY_WHOLESALE,
    });
    completedSources.add(OhlqReportDataSource.ANNUAL_SALES_SUMMARY_BY_WHOLESALE);

    const retention = await pruneOhlqAnnualSalesRows({ reportDate });
    logger.log(
      `OHLQ annual sales retention kept ${retention.retentionDays} day(s) from ${retention.cutoffDate}; ` +
        `deleted ${retention.deletedRows.annualSalesSummary} annual row(s) and ` +
        `${retention.deletedRows.annualSalesSummaryByWholesale} wholesale row(s).`,
    );
    const wholesaleReactivation = await syncOhlqWholesaleReactivationWorklist();
    logger.log(
      `OHLQ wholesale reactivation found ${wholesaleReactivation.matchedAccountsNeedingAction} account(s); ` +
        `created ${wholesaleReactivation.createdItems}, updated ${wholesaleReactivation.updatedItems}, ` +
        `cancelled ${wholesaleReactivation.cancelledItems}.`,
    );

    return {
      ok: true,
      durationMs: Date.now() - startedAt,
      retention,
      wholesaleReactivation,
      reports: {
        annualSalesSummary: {
          filename: annualSalesDownload.filename,
          importedRows: annualSalesImport.importedRows,
          parsedRows: annualSalesImport.parsedRows,
          reportDate: annualSalesDownload.reportDate,
          replacedRows: annualSalesImport.deletedRows,
          runDate: annualSalesDownload.runDate,
          skippedRows: annualSalesImport.skippedRows,
          sizeBytes: annualSalesDownload.sizeBytes,
        },
        annualSalesSummaryByWholesale: {
          filename: wholesaleDownload.filename,
          importedRows: wholesaleImport.importedRows,
          parsedRows: wholesaleImport.parsedRows,
          reportDate: wholesaleDownload.reportDate,
          replacedRows: wholesaleImport.deletedRows,
          runDate: wholesaleDownload.runDate,
          skippedRows: wholesaleImport.skippedRows,
          sizeBytes: wholesaleDownload.sizeBytes,
        },
      },
    };
  } catch (error) {
    await safeMarkErrored({ completedSources, error, logger, reportDate });
    throw error;
  }
}
