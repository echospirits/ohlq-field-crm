import { prisma } from './prisma';
import { addDaysToDateInputValue, formatDateInputValue } from './dateTime';
import type { WeeklyDigestWindow } from './weeklyDigest';

export type WeeklyDigestSales = {
  retailBottles: number | null;
  wholesaleBottles: number | null;
  startDate: string;
  endDate: string;
  throughDate: string | null;
  coveredDays: number;
  expectedDays: number;
  configuredItems: number;
  status: 'complete' | 'partial' | 'unavailable' | 'no-products';
};

export async function getWeeklyDigestSales(organizationId: string, window: WeeklyDigestWindow): Promise<WeeklyDigestSales> {
  const startDate = formatDateInputValue(window.pastStart, window.timeZone);
  const endExclusive = formatDateInputValue(window.pastEnd, window.timeZone);
  const endDate = addDaysToDateInputValue(endExclusive, -1);
  const dates: string[] = [];
  for (let day = startDate; day < endExclusive; day = addDaysToDateInputValue(day, 1)) dates.push(day);

  // Sales attribution is deliberately independent of recommendation eligibility.
  // Every configured OH item participates, even inactive, excluded or discontinued
  // configuration rows. Never fall back to another tenant or a vendor-wide portfolio.
  const products = await prisma.organizationProduct.findMany({
    where: { organizationId, market: 'OH' }, select: { externalItemCode: true },
  });
  const itemCodes = [...new Set(products.map((product) => product.externalItemCode.trim().toUpperCase()).filter(Boolean))];
  const base: WeeklyDigestSales = { retailBottles: null, wholesaleBottles: null, startDate, endDate,
    throughDate: null, coveredDays: 0, expectedDays: dates.length, configuredItems: itemCodes.length,
    status: itemCodes.length ? 'unavailable' : 'no-products' };
  if (!itemCodes.length) return base;

  const imports = await prisma.ohlqReportImportStatus.findMany({
    where: { dataSource: 'ANNUAL_SALES_SUMMARY', status: 'COMPLETED',
      reportDate: { gte: new Date(`${startDate}T00:00:00Z`), lt: new Date(`${endExclusive}T00:00:00Z`) } },
    select: { reportDate: true }, orderBy: { reportDate: 'asc' },
  });
  const coveredDates = [...new Set(imports.map((row) => row.reportDate.toISOString().slice(0, 10)))].filter((day) => dates.includes(day)).sort();
  if (!coveredDates.length) return base;

  // The downloader sets From date == To date. These are daily sales, not YTD
  // snapshots; use the summary's separate channels, never add wholesale twice.
  const totals = await prisma.ohlqAnnualSalesRow.aggregate({
    where: { brand: { in: itemCodes }, reportDate: { in: coveredDates.map((day) => new Date(`${day}T00:00:00Z`)) } },
    _sum: { retailBottlesSold: true, wholesaleBottlesSold: true },
  });
  return { ...base, retailBottles: totals._sum.retailBottlesSold ?? 0, wholesaleBottles: totals._sum.wholesaleBottlesSold ?? 0,
    coveredDays: coveredDates.length, throughDate: coveredDates.at(-1)!, status: coveredDates.length === dates.length ? 'complete' : 'partial' };
}
