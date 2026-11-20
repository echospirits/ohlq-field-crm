import type { PrismaClient } from '@prisma/client';
import { formatOhlqDate, toOhlqDateOnlyUtc } from './ohlqDataStatus';
import { prisma } from './prisma';

export const DEFAULT_OHLQ_REPORT_RETENTION_DAYS = 30;
// Retention follows the source vendor identity, not the current product portfolio.
export const OHLQ_PERMANENT_SALES_VENDOR_ID = 'Z90399001';

type PruneOhlqAnnualSalesRowsOptions = {
  db?: PrismaClient;
  reportDate: string;
  retentionDays?: number;
};

function validateRetentionDays(days: number) {
  if (!Number.isSafeInteger(days) || days < 1) {
    throw new Error('OHLQ_REPORT_RETENTION_DAYS must be a positive safe whole number.');
  }
  return days;
}

export function getOhlqReportRetentionDays(rawValue = process.env.OHLQ_REPORT_RETENTION_DAYS) {
  const value = rawValue?.trim();
  if (!value) return DEFAULT_OHLQ_REPORT_RETENTION_DAYS;

  return validateRetentionDays(Number(value));
}

export function getOhlqRetentionCutoffDate(reportDate: string, retentionDays = getOhlqReportRetentionDays()) {
  const days = validateRetentionDays(retentionDays);
  const date = toOhlqDateOnlyUtc(reportDate);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || formatOhlqDate(date) !== reportDate) {
    throw new Error('OHLQ retention requires a real YYYY-MM-DD report date on or after 0001-01-01.');
  }
  const cutoff = new Date(date.getTime() - (days - 1) * 86_400_000);
  if (!Number.isFinite(cutoff.getTime()) || cutoff.getUTCFullYear() < 1) {
    throw new Error('OHLQ retention must produce a representable cutoff date on or after 0001-01-01.');
  }
  return cutoff;
}

export async function pruneOhlqAnnualSalesRows({
  db = prisma,
  reportDate,
  retentionDays = getOhlqReportRetentionDays(),
}: PruneOhlqAnnualSalesRowsOptions) {
  const cutoffDate = getOhlqRetentionCutoffDate(reportDate, retentionDays);

  const [annualSalesSummary, annualSalesSummaryByWholesale] = await db.$transaction([
    db.ohlqAnnualSalesRow.deleteMany({
      where: { reportDate: { lt: cutoffDate }, vendor: { not: OHLQ_PERMANENT_SALES_VENDOR_ID } },
    }),
    db.ohlqAnnualSalesByWholesaleRow.deleteMany({
      where: { reportDate: { lt: cutoffDate }, vendor: { not: OHLQ_PERMANENT_SALES_VENDOR_ID } },
    }),
  ]);

  return {
    cutoffDate: formatOhlqDate(cutoffDate),
    deletedRows: {
      annualSalesSummary: annualSalesSummary.count,
      annualSalesSummaryByWholesale: annualSalesSummaryByWholesale.count,
    },
    retentionDays,
  };
}
