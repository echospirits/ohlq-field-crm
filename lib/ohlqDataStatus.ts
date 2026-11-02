import { retryDatabaseStatusWrite } from './databaseStatusRetry';
import type { OhlqSourceNotUpdatedError } from './ohlqSourceFreshness';
import {
  OhlqReportDataSource,
  OhlqReportRunStatus,
  Prisma,
  type PrismaClient,
} from '@prisma/client';
import { prisma } from './prisma';
import type { OhlqAnnualSalesImportResult } from './ohlqAnnualSalesImport';
import type { OhlqAnnualSalesDownloadResult } from './ohlqAnnualSalesReport';

type OhlqReportImportResult = OhlqAnnualSalesImportResult & {
  diagnostics?: unknown;
};

type OhlqReportDownloadStatus = Pick<OhlqAnnualSalesDownloadResult, 'filename' | 'sizeBytes'>;

export const OHLQ_DATA_SOURCE_CONFIGS = [
  {
    source: OhlqReportDataSource.ANNUAL_SALES_SUMMARY,
    label: 'Annual Sales Summary',
    tableName: 'OhlqAnnualSalesRow',
  },
  {
    source: OhlqReportDataSource.ANNUAL_SALES_SUMMARY_BY_WHOLESALE,
    label: 'Annual Sales Summary by Wholesale',
    tableName: 'OhlqAnnualSalesByWholesaleRow',
  },
  {
    source: OhlqReportDataSource.AGENCY_INVENTORY_REPORT,
    label: 'Agency Inventory Report',
    tableName: 'OhlqAgencyInventorySnapshot',
  },
] as const;

export type OhlqDataSourceConfig = (typeof OHLQ_DATA_SOURCE_CONFIGS)[number];

export const toOhlqDateOnlyUtc = (isoDate: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error(`Invalid OHLQ report date: ${isoDate}`);
  }

  return new Date(`${isoDate}T00:00:00.000Z`);
};

export const formatOhlqDate = (date: Date) => date.toISOString().slice(0, 10);

const trimError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 1_000 ? `${message.slice(0, 997)}...` : message;
};

export async function recordOhlqReportRunStarted({
  db = prisma,
  reportDate,
  source,
}: {
  db?: PrismaClient;
  reportDate: string;
  source: OhlqReportDataSource;
}) {
  const reportDateValue = toOhlqDateOnlyUtc(reportDate);
  const startedAt = new Date();

  return retryDatabaseStatusWrite(() => db.ohlqReportImportStatus.upsert({
    where: {
      dataSource_reportDate: {
        dataSource: source,
        reportDate: reportDateValue,
      },
    },
    create: {
      dataSource: source,
      reportDate: reportDateValue,
      status: OhlqReportRunStatus.RUNNING,
      startedAt,
    },
    update: {
      completedAt: null,
      errorMessage: null,
      diagnostics: Prisma.DbNull,
      filename: null,
      parsedRows: 0,
      replacedRows: 0,
      rowCount: 0,
      sizeBytes: 0,
      skippedRows: 0,
      startedAt,
      status: OhlqReportRunStatus.RUNNING,
    },
  }));
}

export async function recordOhlqReportRunCompleted({
  db = prisma,
  downloadResult,
  importResult,
  source,
}: {
  db?: PrismaClient;
  downloadResult: OhlqReportDownloadStatus;
  importResult: OhlqReportImportResult;
  source: OhlqReportDataSource;
}) {
  const reportDateValue = toOhlqDateOnlyUtc(importResult.reportDate);
  const completedAt = new Date();

  return retryDatabaseStatusWrite(() => db.ohlqReportImportStatus.upsert({
    where: {
      dataSource_reportDate: {
        dataSource: source,
        reportDate: reportDateValue,
      },
    },
    create: {
      completedAt,
      dataSource: source,
      errorMessage: null,
      diagnostics: importResult.diagnostics as Prisma.InputJsonValue | undefined,
      filename: downloadResult.filename,
      lastSuccessfulAt: completedAt,
      parsedRows: importResult.parsedRows,
      replacedRows: importResult.deletedRows,
      reportDate: reportDateValue,
      rowCount: importResult.importedRows,
      sizeBytes: downloadResult.sizeBytes,
      skippedRows: importResult.skippedRows,
      startedAt: completedAt,
      status: OhlqReportRunStatus.COMPLETED,
    },
    update: {
      completedAt,
      errorMessage: null,
      diagnostics: importResult.diagnostics as Prisma.InputJsonValue | undefined,
      filename: downloadResult.filename,
      lastSuccessfulAt: completedAt,
      parsedRows: importResult.parsedRows,
      replacedRows: importResult.deletedRows,
      rowCount: importResult.importedRows,
      sizeBytes: downloadResult.sizeBytes,
      skippedRows: importResult.skippedRows,
      status: OhlqReportRunStatus.COMPLETED,
    },
  }));
}

export async function recordOhlqReportRunWarning({ db = prisma, error, reportDate, source }: {
  db?: PrismaClient;
  error: OhlqSourceNotUpdatedError;
  reportDate: string;
  source: OhlqReportDataSource;
}) {
  const completedAt = new Date();
  const reportDateValue = toOhlqDateOnlyUtc(reportDate);
  const values = {
    completedAt,
    status: OhlqReportRunStatus.WARNING,
    errorMessage: trimError(error),
    diagnostics: { warningCode: 'SOURCE_NOT_UPDATED', availableDate: error.availableDate, expectedDate: error.expectedDate },
  };
  // Do not stamp lastSuccessfulAt or claim any rows were imported.
  return retryDatabaseStatusWrite(() => db.ohlqReportImportStatus.upsert({
    where: { dataSource_reportDate: { dataSource: source, reportDate: reportDateValue } },
    create: { ...values, dataSource: source, reportDate: reportDateValue, startedAt: completedAt },
    update: values,
  }));
}

export async function recordOhlqReportRunErrored({
  db = prisma,
  error,
  reportDate,
  source,
}: {
  db?: PrismaClient;
  error: unknown;
  reportDate: string;
  source: OhlqReportDataSource;
}) {
  const reportDateValue = toOhlqDateOnlyUtc(reportDate);
  const completedAt = new Date();

  return retryDatabaseStatusWrite(() => db.ohlqReportImportStatus.upsert({
    where: {
      dataSource_reportDate: {
        dataSource: source,
        reportDate: reportDateValue,
      },
    },
    create: {
      completedAt,
      dataSource: source,
      errorMessage: trimError(error),
      reportDate: reportDateValue,
      startedAt: completedAt,
      status: OhlqReportRunStatus.ERRORED,
    },
    update: {
      completedAt,
      errorMessage: trimError(error),
      status: OhlqReportRunStatus.ERRORED,
    },
  }));
}
