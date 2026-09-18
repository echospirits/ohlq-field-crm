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
  retail?: { sellingAgencies: number; previousCoveredDays: number; comparable: boolean; highlights: RetailAgencySales[] };
};

type RetailAgencySales = { agencyNumber: string; name: string; href: string | null; bottles: number; previousBottles: number | null; change: number | null };

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
  const previousStart = addDaysToDateInputValue(startDate, -dates.length);
  const previousImports = await prisma.ohlqReportImportStatus.findMany({
    where: { dataSource: 'ANNUAL_SALES_SUMMARY', status: 'COMPLETED', reportDate: { gte: new Date(`${previousStart}T00:00:00Z`), lt: new Date(`${startDate}T00:00:00Z`) } },
    select: { reportDate: true },
  });
  const previousDates = [...new Set(previousImports.map((row) => row.reportDate.toISOString().slice(0, 10)))].filter((day) => day >= previousStart && day < startDate);
  const comparable = coveredDates.length === dates.length && previousDates.length === dates.length;
  const byAgency = (days: string[]) => prisma.ohlqAnnualSalesRow.groupBy({ by: ['agencyId'],
    where: { brand: { in: itemCodes }, reportDate: { in: days.map((day) => new Date(`${day}T00:00:00Z`)) } }, _sum: { retailBottlesSold: true } });
  const [currentRows, previousRows] = await Promise.all([byAgency(coveredDates), comparable ? byAgency(previousDates) : Promise.resolve([])]);
  const current = new Map(currentRows.map((row) => [row.agencyId, row._sum.retailBottlesSold ?? 0]));
  const previous = new Map(previousRows.map((row) => [row.agencyId, row._sum.retailBottlesSold ?? 0]));
  const rows = [...new Set([...current.keys(), ...previous.keys()])].map((agencyNumber) => {
    const bottles = current.get(agencyNumber) ?? 0;
    const previousBottles = comparable ? previous.get(agencyNumber) ?? 0 : null;
    // Negative net values can be corrections, not a demand signal.
    return { agencyNumber, bottles, previousBottles, change: previousBottles !== null && bottles >= 0 && previousBottles >= 0 ? bottles - previousBottles : null };
  });
  const leaders = rows.filter((row) => row.bottles > 0).sort((a, b) => b.bottles - a.bottles || a.agencyNumber.localeCompare(b.agencyNumber)).slice(0, 3);
  const gains = rows.filter((row) => row.change !== null && row.change > 0).sort((a, b) => b.change! - a.change! || a.agencyNumber.localeCompare(b.agencyNumber)).slice(0, 3);
  const declines = rows.filter((row) => row.change !== null && row.change < 0).sort((a, b) => a.change! - b.change! || a.agencyNumber.localeCompare(b.agencyNumber)).slice(0, 3);
  const selected = [...new Map([...leaders, ...gains, ...declines].map((row) => [row.agencyNumber, row])).values()];
  const agencies = selected.length ? await prisma.agency.findMany({ where: { agencyId: { in: selected.map((row) => row.agencyNumber) } }, select: { id: true, agencyId: true, name: true, city: true } }) : [];
  const agencyMap = new Map(agencies.map((agency) => [agency.agencyId, agency]));
  const retail = { sellingAgencies: rows.filter((row) => row.bottles > 0).length, previousCoveredDays: previousDates.length, comparable,
    highlights: selected.map((row) => {
      const agency = agencyMap.get(row.agencyNumber);
      return { ...row, name: agency ? `${agency.name}${agency.city ? `, ${agency.city}` : ''} (Agency ${row.agencyNumber})` : `Agency ${row.agencyNumber}`, href: agency ? `/agencies/${agency.id}` : null };
    }) };
  return { ...base, retailBottles: totals._sum.retailBottlesSold ?? 0, wholesaleBottles: totals._sum.wholesaleBottlesSold ?? 0,
    coveredDays: coveredDates.length, throughDate: coveredDates.at(-1)!, status: coveredDates.length === dates.length ? 'complete' : 'partial', retail };
}
