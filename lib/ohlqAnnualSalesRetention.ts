import type { PrismaClient } from '@prisma/client';
import { formatOhlqDate, toOhlqDateOnlyUtc } from './ohlqDataStatus';
import { prisma } from './prisma';

export const DEFAULT_OHLQ_REPORT_RETENTION_DAYS = 30;

type PruneOhlqAnnualSalesRowsOptions = {
  db?: PrismaClient;
  reportDate: string;
  retentionDays?: number;
};

const addUtcDays = (date: Date, days: number) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));

export function getOhlqReportRetentionDays(rawValue = process.env.OHLQ_REPORT_RETENTION_DAYS) {
  const value = rawValue?.trim();
  if (!value) return DEFAULT_OHLQ_REPORT_RETENTION_DAYS;

  const days = Number(value);
  if (!Number.isInteger(days) || days < 1) {
    throw new Error('OHLQ_REPORT_RETENTION_DAYS must be a positive whole number when provided.');
  }

  return days;
}

export function getOhlqRetentionCutoffDate(reportDate: string, retentionDays = getOhlqReportRetentionDays()) {
  return addUtcDays(toOhlqDateOnlyUtc(reportDate), -(retentionDays - 1));
}

export async function pruneOhlqAnnualSalesRows({
  db = prisma,
  reportDate,
  retentionDays = getOhlqReportRetentionDays(),
}: PruneOhlqAnnualSalesRowsOptions) {
  const cutoffDate = getOhlqRetentionCutoffDate(reportDate, retentionDays);

  const [annualSalesSummary, annualSalesSummaryByWholesale] = await db.$transaction([
    db.ohlqAnnualSalesRow.deleteMany({
      where: { reportDate: { lt: cutoffDate } },
    }),
    db.ohlqAnnualSalesByWholesaleRow.deleteMany({
      where: { reportDate: { lt: cutoffDate } },
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
