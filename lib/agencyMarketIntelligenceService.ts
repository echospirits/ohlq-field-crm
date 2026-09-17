import { OhlqReportDataSource, OhlqReportRunStatus, Prisma, type PrismaClient } from '@prisma/client';
import {
  AGENCY_MARKET_SCORING_VERSION,
  AGENCY_MARKET_WINDOW_DAYS,
  aggregateAgencyMarketPurchases,
  analyzeAgencyMarketProfile,
  analyzeAgencyProductMarketFit,
  getAgencyMarketRecommendationType,
} from './agencyMarketIntelligence';
import { toAffinityProduct, type BuyerBasket } from './opportunityAffinity';
import { getDistilleryOnlyItemCodes, isOpportunityEligibleOhlqProduct } from './ohlqProductEligibility';
import { normalizeOhlqId } from './ohlqSalesData';
import { prisma } from './prisma';

const DAY = 86_400_000;
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY);
const placementKey = (agencyNumber: string, itemCode: string) => `${agencyNumber}|${itemCode}`;
const asJson = (value: unknown) => value as Prisma.InputJsonValue;

export async function refreshAgencyMarketIntelligence({
  asOfDate,
  db = prisma,
  organizationId,
}: {
  asOfDate: Date;
  db?: PrismaClient;
  organizationId: string;
}) {
  const windowStart = addDays(asOfDate, -(AGENCY_MARKET_WINDOW_DAYS - 1));
  const [
    agencies,
    catalog,
    completedReports,
    currentInventory,
    latestInventoryImport,
    productDecisions,
    salesRows,
  ] = await Promise.all([
    db.agency.findMany({ select: { id: true, agencyId: true } }),
    db.ohlqBrandMasterItem.findMany(),
    db.ohlqReportImportStatus.findMany({
      where: {
        dataSource: OhlqReportDataSource.ANNUAL_SALES_SUMMARY,
        reportDate: { gte: windowStart, lte: asOfDate },
        status: OhlqReportRunStatus.COMPLETED,
      },
      orderBy: { reportDate: 'asc' },
      select: { reportDate: true },
    }),
    db.ohlqAgencyInventoryCurrent.findMany({
      where: { organizationId },
      select: { agencyNumber: true, itemCode: true },
    }),
    db.ohlqTenantInventoryImportStatus.findFirst({
      where: { organizationId, status: OhlqReportRunStatus.COMPLETED },
      orderBy: { reportDate: 'desc' },
      select: { diagnostics: true },
    }),
    db.organizationProduct.findMany({
      where: {
        organizationId,
        active: true,
        discontinued: false,
        market: 'OH',
        status: { in: ['OWNED', 'REPRESENTED'] },
      },
      select: { displayName: true, externalItemCode: true, strategicPriority: true },
    }),
    db.ohlqAnnualSalesRow.findMany({
      where: {
        reportDate: { gte: windowStart, lte: asOfDate },
        retailBottlesSold: { gt: 0 },
      },
      select: { agencyId: true, brand: true, retailBottlesSold: true },
    }),
  ]);

  const catalogByCode = new Map(catalog.map((item) => [item.itemCode, item]));
  const distilleryOnlyItemCodes = getDistilleryOnlyItemCodes(latestInventoryImport?.diagnostics);
  const portfolio = productDecisions.flatMap((decision) => {
    const master = catalogByCode.get(decision.externalItemCode);
    if (!master || !isOpportunityEligibleOhlqProduct(master, distilleryOnlyItemCodes)) return [];
    const product = toAffinityProduct(master, decision.strategicPriority ?? 1);
    return [{ ...product, name: decision.displayName?.trim() || product.name }];
  });
  const tenantItemCodes = new Set(portfolio.map((product) => product.itemCode));
  const purchasesByAgency = aggregateAgencyMarketPurchases({ catalog, rows: salesRows, tenantItemCodes });
  const normalizedAgencies = agencies.flatMap((agency) => {
    const agencyNumber = normalizeOhlqId(agency.agencyId);
    return agencyNumber ? [{ ...agency, agencyNumber }] : [];
  });
  const agencyIdByNumber = new Map(normalizedAgencies.map((agency) => [agency.agencyNumber, agency.id]));
  const baskets: BuyerBasket[] = [...purchasesByAgency].flatMap(([agencyNumber, purchases]) => {
    const agencyId = agencyIdByNumber.get(agencyNumber);
    return agencyId ? [{ accountId: agencyId, purchases }] : [];
  });
  const placements = new Set(currentInventory.flatMap((row) => {
    const agencyNumber = normalizeOhlqId(row.agencyNumber);
    return agencyNumber ? [placementKey(agencyNumber, row.itemCode)] : [];
  }));
  const observedDayCount = completedReports.length;
  const observedSince = completedReports[0]?.reportDate ?? null;
  const now = new Date();
  let profilesProcessed = 0;
  let productFitsProcessed = 0;

  if (portfolio.length === 0) {
    await db.agencyProductMarketFit.deleteMany({ where: { organizationId } });
  } else {
    await db.agencyProductMarketFit.deleteMany({
      where: { organizationId, itemCode: { notIn: portfolio.map((product) => product.itemCode) } },
    });
  }

  const concurrency = 8;
  for (let offset = 0; offset < normalizedAgencies.length; offset += concurrency) {
    await Promise.all(normalizedAgencies.slice(offset, offset + concurrency).map(async (agency) => {
      const purchases = purchasesByAgency.get(agency.agencyNumber) ?? [];
      const profile = analyzeAgencyMarketProfile(purchases, observedDayCount);
      const profileSnapshot = {
        basis: 'NON_TENANT_RETAIL_MARKET_BASKET',
        observedDayCount,
        observedSince: observedSince?.toISOString().slice(0, 10) ?? null,
        windowEnd: asOfDate.toISOString().slice(0, 10),
        windowStart: windowStart.toISOString().slice(0, 10),
        profile,
      };
      await db.agencyMarketProfile.upsert({
        where: { organizationId_agencyId: { organizationId, agencyId: agency.id } },
        create: {
          organizationId,
          agencyId: agency.id,
          asOfDate,
          observedSince,
          observedDayCount,
          totalRetailEqBottles: profile.totalRetailEqBottles,
          tenantRetailEqBottles: profile.tenantRetailEqBottles,
          nonTenantRetailEqBottles: profile.nonTenantRetailEqBottles,
          categoryMix: asJson(profile.categoryMix),
          priceCoverage: profile.priceCoverage,
          medianPrice750: profile.medianPrice750,
          localRetailEqBottles: profile.localRetailEqBottles,
          localShare: profile.localShare,
          confidence: profile.confidence,
          signalSnapshot: asJson(profileSnapshot),
          scoringVersion: AGENCY_MARKET_SCORING_VERSION,
        },
        update: {
          asOfDate,
          observedSince,
          observedDayCount,
          totalRetailEqBottles: profile.totalRetailEqBottles,
          tenantRetailEqBottles: profile.tenantRetailEqBottles,
          nonTenantRetailEqBottles: profile.nonTenantRetailEqBottles,
          categoryMix: asJson(profile.categoryMix),
          priceCoverage: profile.priceCoverage,
          medianPrice750: profile.medianPrice750,
          localRetailEqBottles: profile.localRetailEqBottles,
          localShare: profile.localShare,
          confidence: profile.confidence,
          signalSnapshot: asJson(profileSnapshot),
          scoringVersion: AGENCY_MARKET_SCORING_VERSION,
        },
      });
      profilesProcessed += 1;

      const hasAnyPortfolioPlacement = portfolio.some((product) =>
        placements.has(placementKey(agency.agencyNumber, product.itemCode)),
      );
      for (const target of portfolio) {
        const currentPlacement = placements.has(placementKey(agency.agencyNumber, target.itemCode));
        const recommendationType = getAgencyMarketRecommendationType({
          currentPlacement,
          hasAnyPortfolioPlacement,
        });
        const fit = analyzeAgencyProductMarketFit({
          agencyId: agency.id,
          baskets,
          observedDayCount,
          profile,
          purchases,
          target,
        });
        const snapshot = {
          basis: 'NON_TENANT_RETAIL_MARKET_BASKET',
          profile,
          recommendationType,
          target,
          fit,
          windowEnd: asOfDate.toISOString().slice(0, 10),
          windowStart: windowStart.toISOString().slice(0, 10),
        };
        await db.agencyProductMarketFit.upsert({
          where: {
            organizationId_agencyId_itemCode: {
              organizationId,
              agencyId: agency.id,
              itemCode: target.itemCode,
            },
          },
          create: {
            organizationId,
            agencyId: agency.id,
            itemCode: target.itemCode,
            itemName: target.name,
            asOfDate,
            recommendationType,
            currentPlacement,
            category: target.category,
            targetPrice750: target.price750,
            categoryEqBottles: fit.categoryEqBottles,
            comparableEqBottles: fit.comparableEqBottles,
            comparableShare: fit.comparableShare,
            localComparableEqBottles: fit.localComparableEqBottles,
            peerBuyerCount: fit.peerBuyerCount,
            peerComparableShare: fit.peerComparableShare,
            fitScore: fit.fitScore,
            fitBand: fit.fitBand,
            confidence: fit.confidence,
            reasons: asJson(fit.reasons),
            initialSignalSnapshot: asJson(snapshot),
            signalSnapshot: asJson(snapshot),
            scoringVersion: AGENCY_MARKET_SCORING_VERSION,
            shadow: true,
            firstScoredAt: now,
            lastScoredAt: now,
          },
          update: {
            itemName: target.name,
            asOfDate,
            recommendationType,
            currentPlacement,
            category: target.category,
            targetPrice750: target.price750,
            categoryEqBottles: fit.categoryEqBottles,
            comparableEqBottles: fit.comparableEqBottles,
            comparableShare: fit.comparableShare,
            localComparableEqBottles: fit.localComparableEqBottles,
            peerBuyerCount: fit.peerBuyerCount,
            peerComparableShare: fit.peerComparableShare,
            fitScore: fit.fitScore,
            fitBand: fit.fitBand,
            confidence: fit.confidence,
            reasons: asJson(fit.reasons),
            signalSnapshot: asJson(snapshot),
            scoringVersion: AGENCY_MARKET_SCORING_VERSION,
            shadow: true,
            lastScoredAt: now,
          },
        });
        productFitsProcessed += 1;
      }
    }));
  }

  return {
    asOfDate: asOfDate.toISOString().slice(0, 10),
    observedDayCount,
    productFitsProcessed,
    profilesProcessed,
    scoringVersion: AGENCY_MARKET_SCORING_VERSION,
    shadow: true,
  };
}

export async function runAgencyMarketIntelligenceAfterImport({
  asOfDate,
  db = prisma,
}: {
  asOfDate: Date;
  db?: PrismaClient;
}) {
  const organizations = await db.organization.findMany({
    where: { active: true, features: { some: { enabled: true, featureKey: 'AGENCY_INTELLIGENCE' } } },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  const results = [];
  for (const organization of organizations) {
    results.push({
      organizationId: organization.id,
      ...(await refreshAgencyMarketIntelligence({ asOfDate, db, organizationId: organization.id })),
    });
  }
  return {
    organizations: results,
    productFitsProcessed: results.reduce((total, result) => total + result.productFitsProcessed, 0),
    profilesProcessed: results.reduce((total, result) => total + result.profilesProcessed, 0),
    scoringVersion: AGENCY_MARKET_SCORING_VERSION,
    shadow: true,
  };
}
