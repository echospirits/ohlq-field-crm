import os from 'os';
import path from 'path';
import { OhlqReportDataSource } from '@prisma/client';
import {
  importOhlqAnnualSalesByWholesaleCsv,
  importOhlqAnnualSalesCsv,
} from './ohlqAnnualSalesImport';
import { pruneOhlqAnnualSalesRows } from './ohlqAnnualSalesRetention';
import { runOpportunityIntelligenceAfterImport } from './opportunityEngine';
import { toOhlqDateOnlyUtc } from './ohlqDataStatus';
import {
  downloadOhlqSharedSalesReports,
  getOhlqAnnualSalesReportDate,
  type OhlqAnnualSalesDownloadOptions,
} from './ohlqAnnualSalesReport';
import {
  OHLQ_DATA_SOURCE_CONFIGS,
  recordOhlqReportRunCompleted,
  recordOhlqReportRunErrored,
  recordOhlqReportRunStarted,
} from './ohlqDataStatus';
import { getTenantConfig } from './tenantConfig';

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

const sourceOrder = OHLQ_DATA_SOURCE_CONFIGS.map((config) => config.source).filter(
  (source) => source !== OhlqReportDataSource.AGENCY_INVENTORY_REPORT,
);

const safeMarkErrored = async ({
  completedSources,
  error,
  logger,
  reportDates,
}: {
  completedSources: Set<OhlqReportDataSource>;
  error: unknown;
  logger: Logger;
  reportDates: Map<OhlqReportDataSource, string>;
}) => {
  const pendingSources = sourceOrder.filter((source) => !completedSources.has(source));

  await Promise.all(
    pendingSources.map((source) =>
      recordOhlqReportRunErrored({ error, reportDate: reportDates.get(source)!, source }).catch((statusError) => {
        logger.error(`Unable to record OHLQ import error status for ${source}:`, statusError);
      }),
    ),
  );
};

export async function runOhlqAnnualSalesWorkflow(options: OhlqAnnualSalesWorkflowOptions = {}) {
  const logger = options.logger ?? console;
  const tenantConfig = getTenantConfig();
  const reportDate = getOhlqAnnualSalesReportDate(options.reportDate).iso;
  const reportDates = new Map<OhlqReportDataSource, string>([
    [OhlqReportDataSource.ANNUAL_SALES_SUMMARY, reportDate],
    [OhlqReportDataSource.ANNUAL_SALES_SUMMARY_BY_WHOLESALE, reportDate],
  ]);
  const startedAt = Date.now();
  const completedSources = new Set<OhlqReportDataSource>();

  await Promise.all(
    sourceOrder.map((source) => recordOhlqReportRunStarted({ reportDate: reportDates.get(source)!, source })),
  );

  try {
    const {
      annualSalesSummary: annualSalesDownload,
      annualSalesSummaryByWholesale: wholesaleDownload,
    } =
      await downloadOhlqSharedSalesReports({
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
    logger.log(
      `Wholesale order reconciliation checked ${wholesaleImport.wholesaleOrderReconciliation.checkedOrders} outstanding order(s); ` +
        `auto-filed ${wholesaleImport.wholesaleOrderReconciliation.filedOrders}, ` +
        `flagged ${wholesaleImport.wholesaleOrderReconciliation.ambiguousOrderIds.length} ambiguous, and ` +
        `left ${wholesaleImport.wholesaleOrderReconciliation.stillOutstandingOrders} outstanding.`,
    );
    logger.log(
      `OHLQ ${tenantConfig.productLabel} purchase state updated ${wholesaleImport.echoPurchaseState.updatedAccounts} wholesale account(s); ` +
        `${wholesaleImport.echoPurchaseState.unmatchedPermitNumbers.length} permit number(s) were not matched.`,
    );

    await recordOhlqReportRunCompleted({
      downloadResult: wholesaleDownload,
      importResult: wholesaleImport,
      source: OhlqReportDataSource.ANNUAL_SALES_SUMMARY_BY_WHOLESALE,
    });
    completedSources.add(OhlqReportDataSource.ANNUAL_SALES_SUMMARY_BY_WHOLESALE);

    const opportunityIntelligence = await runOpportunityIntelligenceAfterImport({
      reportDate: toOhlqDateOnlyUtc(reportDate),
    });
    logger.log(
      `Opportunity intelligence captured ${opportunityIntelligence.salesEvents.created} purchase event(s), ` +
        `detected ${opportunityIntelligence.intelligence.detected} opportunity instance(s), and ` +
        `converted ${opportunityIntelligence.intelligence.converted} opportunity instance(s).`,
    );

    const retention = await pruneOhlqAnnualSalesRows({ reportDate });
    logger.log(
      `OHLQ annual sales retention kept ${retention.retentionDays} day(s) from ${retention.cutoffDate}; ` +
        `deleted ${retention.deletedRows.annualSalesSummary} annual row(s) and ` +
        `${retention.deletedRows.annualSalesSummaryByWholesale} wholesale row(s).`,
    );
    return {
      ok: true,
      durationMs: Date.now() - startedAt,
      retention,
      opportunityIntelligence,
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
          updatedEchoPurchaseAccounts: wholesaleImport.echoPurchaseState.updatedAccounts,
        },
      },
    };
  } catch (error) {
    logger.error('OHLQ annual sales workflow failed, including any wholesale order reconciliation:', error);
    await safeMarkErrored({ completedSources, error, logger, reportDates });
    throw error;
  }
}
