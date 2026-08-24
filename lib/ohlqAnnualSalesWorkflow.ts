import os from 'os';
import path from 'path';
import { OhlqReportDataSource } from '@prisma/client';
import {
  importOhlqAnnualSalesByWholesaleCsv,
  importOhlqAnnualSalesCsv,
} from './ohlqAnnualSalesImport';
import { importOhlqAgencyInventoryCsv } from './ohlqAgencyInventoryImport';
import { pruneOhlqAnnualSalesRows } from './ohlqAnnualSalesRetention';
import { runOpportunityIntelligenceAfterImport } from './opportunityEngine';
import { refreshAgencyIntelligence } from './agencyIntelligenceService';
import { ECHO_ORGANIZATION_ID, hasFeature } from './organizations';
import { toOhlqDateOnlyUtc } from './ohlqDataStatus';
import {
  downloadOhlqAnnualSalesReports,
  getOhlqAgencyInventoryObservationDate,
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

const sourceOrder = OHLQ_DATA_SOURCE_CONFIGS.map((config) => config.source);

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
  const inventoryObservationDate = getOhlqAgencyInventoryObservationDate();
  const reportDates = new Map<OhlqReportDataSource, string>([
    [OhlqReportDataSource.ANNUAL_SALES_SUMMARY, reportDate],
    [OhlqReportDataSource.ANNUAL_SALES_SUMMARY_BY_WHOLESALE, reportDate],
    [OhlqReportDataSource.AGENCY_INVENTORY_REPORT, inventoryObservationDate],
  ]);
  const startedAt = Date.now();
  const completedSources = new Set<OhlqReportDataSource>();

  await Promise.all(
    sourceOrder.map((source) => recordOhlqReportRunStarted({ reportDate: reportDates.get(source)!, source })),
  );

  try {
    const {
      agencyInventoryReport: inventoryDownload,
      annualSalesSummary: annualSalesDownload,
      annualSalesSummaryByWholesale: wholesaleDownload,
    } =
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

    if (!inventoryDownload.csvBuffer) {
      throw new Error('Agency Inventory Report CSV download completed, but no CSV buffer was returned for import.');
    }

    const inventoryImport = await importOhlqAgencyInventoryCsv({
      csv: inventoryDownload.csvBuffer,
      reportDate: inventoryDownload.reportDate,
    });
    logger.log(
      `OHLQ agency inventory captured ${inventoryImport.importedRows} current snapshot row(s) across ` +
        `${inventoryImport.diagnostics.uniqueAgencies} agencies and ${inventoryImport.diagnostics.uniqueItems} items; ` +
        `${inventoryImport.diagnostics.unmatchedAgencyNumbers.length} agency number(s) were not matched.`,
    );
    await recordOhlqReportRunCompleted({
      downloadResult: inventoryDownload,
      importResult: inventoryImport,
      source: OhlqReportDataSource.AGENCY_INVENTORY_REPORT,
    });
    completedSources.add(OhlqReportDataSource.AGENCY_INVENTORY_REPORT);

    const opportunityIntelligence = await runOpportunityIntelligenceAfterImport({
      reportDate: toOhlqDateOnlyUtc(reportDate),
    });
    logger.log(
      `Opportunity intelligence captured ${opportunityIntelligence.salesEvents.created} purchase event(s), ` +
        `detected ${opportunityIntelligence.intelligence.detected} opportunity instance(s), and ` +
        `converted ${opportunityIntelligence.intelligence.converted} opportunity instance(s).`,
    );

    const agencyIntelligence = await hasFeature(ECHO_ORGANIZATION_ID, 'AGENCY_INTELLIGENCE')
      ? await refreshAgencyIntelligence({ inventoryReportDate: toOhlqDateOnlyUtc(inventoryObservationDate), salesReportDate: toOhlqDateOnlyUtc(reportDate) })
      : { productsProcessed: 0, agenciesProcessed: 0, eventsCreated: 0 };
    logger.log(
      `Agency intelligence refreshed ${agencyIntelligence.productsProcessed} Agency-product signal(s) across ` +
        `${agencyIntelligence.agenciesProcessed} agencies and recorded ${agencyIntelligence.eventsCreated} meaningful change(s).`,
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
      agencyIntelligence,
      retention,
      opportunityIntelligence,
      reports: {
        agencyInventoryReport: {
          diagnostics: inventoryImport.diagnostics,
          filename: inventoryDownload.filename,
          importedRows: inventoryImport.importedRows,
          parsedRows: inventoryImport.parsedRows,
          reportDate: inventoryDownload.reportDate,
          replacedRows: inventoryImport.deletedRows,
          runDate: inventoryDownload.runDate,
          skippedRows: inventoryImport.skippedRows,
          sizeBytes: inventoryDownload.sizeBytes,
        },
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
    await safeMarkErrored({ completedSources, error, logger, reportDates });
    throw error;
  }
}
