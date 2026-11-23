import { OhlqReportDataSource, OhlqReportRunStatus, type PrismaClient } from '@prisma/client';
import { ECHO_VENDOR_ID, getOhlqWindowStartDate, normalizeOhlqId } from './ohlqSalesData';
import { prisma } from './prisma';
import { getOrganizationTenantConfig, matchesTenantProduct } from './tenantConfig';

const SALES_WINDOW_DAYS = 90;

type Recommendation = {
  id: string;
  agency: { agencyId: string };
  itemCode: string;
  asOfDate: Date;
};

export type AgencyOpportunitySales90 = { bottles: number | null; complete: boolean; through: Date };

// Display-only history through the latest complete sales input on or before the inventory snapshot.
export async function getAgencyOpportunitySales90(
  organizationId: string,
  recommendations: Recommendation[],
  db: PrismaClient = prisma,
) {
  const totals = new Map<string, AgencyOpportunitySales90>();
  const lookups = recommendations.flatMap((item) => {
    const agencyId = normalizeOhlqId(item.agency.agencyId);
    if (!agencyId) return [];
    return [{ ...item, agencyId }];
  });
  if (lookups.length === 0) return totals;

  const config = await getOrganizationTenantConfig(organizationId, db);
  const eligible = lookups.filter(({ itemCode }) => matchesTenantProduct({ config, itemCode, vendor: ECHO_VENDOR_ID }));
  if (eligible.length === 0) return totals;

  const salesDates = await db.ohlqReportImportStatus.groupBy({
    by: ['reportDate'],
    where: {
      status: OhlqReportRunStatus.COMPLETED,
      dataSource: { in: [OhlqReportDataSource.ANNUAL_SALES_SUMMARY, OhlqReportDataSource.ANNUAL_SALES_SUMMARY_BY_WHOLESALE] },
      OR: eligible.map(({ asOfDate }) => ({ reportDate: { gte: getOhlqWindowStartDate(asOfDate, SALES_WINDOW_DAYS), lte: asOfDate } })),
    },
    having: { dataSource: { _count: { equals: 2 } } },
    orderBy: { reportDate: 'desc' },
  });
  const windows = eligible.flatMap((item) => {
    const earliest = getOhlqWindowStartDate(item.asOfDate, SALES_WINDOW_DAYS);
    const through = salesDates.find(({ reportDate }) => reportDate >= earliest && reportDate <= item.asOfDate)?.reportDate;
    return through ? [{ ...item, through, reportDate: { gte: getOhlqWindowStartDate(through, SALES_WINDOW_DAYS), lte: through } }] : [];
  });
  if (windows.length === 0) return totals;

  const salesQuery = db.ohlqAnnualSalesRow.groupBy({
    by: ['agencyId', 'brand'],
    where: {
      vendor: ECHO_VENDOR_ID,
      OR: windows.map(({ agencyId, itemCode, reportDate }) => ({ agencyId, brand: itemCode, reportDate })),
    },
    _sum: { retailBottlesSold: true, wholesaleBottlesSold: true },
  });
  const [sales, coverage, echoPlacements] = await db.$transaction([
    salesQuery,
    db.echoBottleSalesDayCoverage.findMany({
      where: { vendor: ECHO_VENDOR_ID, completedAt: { lte: new Date() }, OR: windows.map(({ reportDate }) => ({ reportDate })) },
      select: { reportDate: true },
    }),
    db.ohlqAgencyInventoryCurrent.findMany({
      where: {
        organizationId,
        vendorId: ECHO_VENDOR_ID,
        OR: windows.map(({ agencyId, itemCode }) => ({ agencyNumber: agencyId, itemCode })),
      },
      select: { agencyNumber: true, itemCode: true },
    }),
  ], { isolationLevel: 'RepeatableRead' });

  const coveredDates = new Set(coverage.map(({ reportDate }) => reportDate.getTime()));
  const echoPlacementKeys = new Set(echoPlacements.map(({ agencyNumber, itemCode }) => `${agencyNumber}|${itemCode}`));
  const salesByProduct = new Map(sales.map(({ agencyId, brand, _sum }) => [
    `${agencyId}|${brand}`,
    (_sum.retailBottlesSold ?? 0) + (_sum.wholesaleBottlesSold ?? 0),
  ]));

  for (const item of windows) {
    const key = `${item.agencyId}|${item.itemCode}`;
    const observed = salesByProduct.get(key);
    // Absence only means zero for a known Echo placement with a receipt for every day.
    const complete = (echoPlacementKeys.has(key) || observed !== undefined) &&
      Array.from({ length: SALES_WINDOW_DAYS }, (_, index) => getOhlqWindowStartDate(item.through, index + 1))
        .every((date) => coveredDates.has(date.getTime()));
    totals.set(item.id, { bottles: observed ?? (complete ? 0 : null), complete, through: item.through });
  }
  return totals;
}
