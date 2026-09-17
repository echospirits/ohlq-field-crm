import type {
  AgencyIntelligenceBand,
  AgencyMarketConfidence,
  AgencyMarketRecommendationType,
} from '@prisma/client';
import {
  catalogLiters,
  compareWithBuyers,
  getPriceEvidence,
  isKnownOhioBrand,
  pricePer750,
  type AffinityProduct,
  type AffinityPurchase,
  type BuyerBasket,
} from './opportunityAffinity';
import { normalizeOpportunityCategory } from './opportunityConfig';
import { normalizeOhlqId } from './ohlqSalesData';

export const AGENCY_MARKET_SCORING_VERSION = 'AGENCY_MARKET_FIT_V1_SHADOW';
export const AGENCY_MARKET_WINDOW_DAYS = 30;

type CatalogItem = {
  itemCode: string;
  name: string;
  category: string | null;
  productVolume: unknown;
  retailPrice: unknown;
};

type AgencyRetailRow = {
  agencyId: string;
  brand: string;
  retailBottlesSold: number;
};

export type AgencyMarketProfileAnalysis = {
  categoryMix: Record<string, number>;
  confidence: AgencyMarketConfidence;
  localRetailEqBottles: number;
  localShare: number;
  medianPrice750: number | null;
  nonTenantRetailEqBottles: number;
  priceCoverage: number;
  tenantRetailEqBottles: number;
  totalRetailEqBottles: number;
};

export type AgencyProductMarketFitAnalysis = {
  categoryEqBottles: number;
  comparableEqBottles: number;
  comparableShare: number;
  confidence: AgencyMarketConfidence;
  fitBand: AgencyIntelligenceBand;
  fitScore: number;
  localComparableEqBottles: number;
  peerBuyerCount: number;
  peerComparableShare: number | null;
  reasons: string[];
};

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const equivalentBottles = (purchase: AffinityPurchase) =>
  purchase.bottles90 * ((purchase.liters ?? 0.75) / 0.75);

export function aggregateAgencyMarketPurchases({
  catalog,
  rows,
  tenantItemCodes,
}: {
  catalog: CatalogItem[];
  rows: AgencyRetailRow[];
  tenantItemCodes: Set<string>;
}) {
  const catalogByCode = new Map(catalog.map((item) => [item.itemCode, item]));
  const purchases = new Map<string, Map<string, AffinityPurchase>>();

  rows.forEach((row) => {
    if (row.retailBottlesSold <= 0) return;
    const agencyNumber = normalizeOhlqId(row.agencyId);
    if (!agencyNumber) return;
    const item = catalogByCode.get(row.brand);
    const byItem = purchases.get(agencyNumber) ?? new Map<string, AffinityPurchase>();
    const existing = byItem.get(row.brand);
    byItem.set(row.brand, {
      itemCode: row.brand,
      category: item ? normalizeOpportunityCategory(item.category, item.name) : null,
      price750: item ? pricePer750(item.retailPrice, item.productVolume) : null,
      liters: item ? catalogLiters(item.productVolume) ?? 0.75 : 0.75,
      bottles90: (existing?.bottles90 ?? 0) + row.retailBottlesSold,
      isEcho: tenantItemCodes.has(row.brand),
      isLocal: item ? isKnownOhioBrand(item.name) : false,
    });
    purchases.set(agencyNumber, byItem);
  });

  return new Map([...purchases].map(([agencyNumber, byItem]) => [agencyNumber, [...byItem.values()]]));
}

const weightedMedianPrice = (purchases: AffinityPurchase[]) => {
  const priced = purchases
    .filter((purchase) => !purchase.isEcho && purchase.price750 && purchase.price750 > 0)
    .map((purchase) => ({ price: purchase.price750!, weight: equivalentBottles(purchase) }))
    .sort((left, right) => left.price - right.price);
  const totalWeight = priced.reduce((total, value) => total + value.weight, 0);
  if (!totalWeight) return null;
  let seen = 0;
  for (const value of priced) {
    seen += value.weight;
    if (seen >= totalWeight / 2) return round(value.price);
  }
  return round(priced.at(-1)!.price);
};

export function analyzeAgencyMarketProfile(
  purchases: AffinityPurchase[],
  observedDayCount: number,
): AgencyMarketProfileAnalysis {
  const tenantPurchases = purchases.filter((purchase) => purchase.isEcho);
  const marketPurchases = purchases.filter((purchase) => !purchase.isEcho);
  const tenantRetailEqBottles = tenantPurchases.reduce((total, purchase) => total + equivalentBottles(purchase), 0);
  const nonTenantRetailEqBottles = marketPurchases.reduce((total, purchase) => total + equivalentBottles(purchase), 0);
  const pricedBottles = marketPurchases
    .filter((purchase) => purchase.price750 && purchase.price750 > 0)
    .reduce((total, purchase) => total + equivalentBottles(purchase), 0);
  const localRetailEqBottles = marketPurchases
    .filter((purchase) => purchase.isLocal)
    .reduce((total, purchase) => total + equivalentBottles(purchase), 0);
  const categoryMix: Record<string, number> = {};
  marketPurchases.forEach((purchase) => {
    const category = purchase.category ?? 'UNKNOWN';
    categoryMix[category] = round((categoryMix[category] ?? 0) + equivalentBottles(purchase));
  });
  const priceCoverage = nonTenantRetailEqBottles ? pricedBottles / nonTenantRetailEqBottles : 0;
  const localShare = nonTenantRetailEqBottles ? localRetailEqBottles / nonTenantRetailEqBottles : 0;
  const confidence: AgencyMarketConfidence =
    observedDayCount >= 28 && nonTenantRetailEqBottles >= 50 && priceCoverage >= 0.75
      ? 'HIGH'
      : observedDayCount >= 21 && nonTenantRetailEqBottles >= 20 && priceCoverage >= 0.5
        ? 'MEDIUM'
        : observedDayCount >= 14 && nonTenantRetailEqBottles >= 6
          ? 'LOW'
          : 'INSUFFICIENT_DATA';

  return {
    categoryMix,
    confidence,
    localRetailEqBottles: round(localRetailEqBottles),
    localShare: round(localShare, 4),
    medianPrice750: weightedMedianPrice(marketPurchases),
    nonTenantRetailEqBottles: round(nonTenantRetailEqBottles),
    priceCoverage: round(priceCoverage, 4),
    tenantRetailEqBottles: round(tenantRetailEqBottles),
    totalRetailEqBottles: round(tenantRetailEqBottles + nonTenantRetailEqBottles),
  };
}

export function getAgencyMarketRecommendationType({
  currentPlacement,
  hasAnyPortfolioPlacement,
}: {
  currentPlacement: boolean;
  hasAnyPortfolioPlacement: boolean;
}): AgencyMarketRecommendationType {
  if (currentPlacement) return 'CURRENT_PLACEMENT';
  return hasAnyPortfolioPlacement ? 'EXPANSION' : 'ENTRY';
}

export function analyzeAgencyProductMarketFit({
  baskets,
  profile,
  purchases,
  target,
  agencyId,
  observedDayCount,
}: {
  agencyId: string;
  baskets: BuyerBasket[];
  observedDayCount: number;
  profile: AgencyMarketProfileAnalysis;
  purchases: AffinityPurchase[];
  target: AffinityProduct;
}): AgencyProductMarketFitAnalysis {
  const priceEvidence = getPriceEvidence(purchases, target);
  const peerEvidence = compareWithBuyers(agencyId, purchases, target, baskets);
  const categoryPurchases = purchases.filter(
    (purchase) => !purchase.isEcho && purchase.category === target.category,
  );
  const categoryEqBottles = categoryPurchases.reduce(
    (total, purchase) => total + equivalentBottles(purchase),
    0,
  );
  const categoryScore = target.category ? Math.min(35, (categoryEqBottles / 24) * 35) : 0;
  const priceScore = Math.min(30, priceEvidence.marketPriceScore * (30 / 35));
  const localScore = Math.min(10, (profile.localRetailEqBottles / 12) * 5 + profile.localShare * 5);
  const peerScore = Math.min(15, peerEvidence.score * 3);
  const marketDepthScore = Math.min(10, (profile.nonTenantRetailEqBottles / 60) * 10);
  const fitScore = Math.round(Math.max(0, Math.min(100,
    categoryScore + priceScore + localScore + peerScore + marketDepthScore,
  )));
  const confidence: AgencyMarketConfidence =
    profile.confidence === 'HIGH' &&
    observedDayCount >= 28 &&
    Boolean(target.category) &&
    Boolean(target.price750) &&
    categoryEqBottles >= 12 &&
    priceEvidence.coverage >= 0.7 &&
    peerEvidence.buyers >= 10
      ? 'HIGH'
      : profile.confidence !== 'INSUFFICIENT_DATA' &&
          Boolean(target.category) &&
          categoryEqBottles >= 6 &&
          (!target.price750 || priceEvidence.coverage >= 0.5)
        ? 'MEDIUM'
        : profile.confidence !== 'INSUFFICIENT_DATA' && Boolean(target.category) && categoryEqBottles > 0
          ? 'LOW'
          : 'INSUFFICIENT_DATA';
  const fitBand: AgencyIntelligenceBand = confidence === 'INSUFFICIENT_DATA'
    ? 'INSUFFICIENT_DATA'
    : fitScore >= 65
      ? 'HIGH'
      : fitScore >= 40
        ? 'MEDIUM'
        : 'LOW';
  const reasons: string[] = [];
  if (target.category && categoryEqBottles > 0) {
    reasons.push(`${round(categoryEqBottles, 1)} non-tenant ${target.category.toLowerCase()} 750ml-equivalent bottles in the observed window`);
  }
  if (target.price750 && priceEvidence.comparableBottles > 0) {
    reasons.push(`${round(priceEvidence.comparableBottles, 1)} 750ml-equivalent bottles in this product's price lane`);
  }
  if (profile.localRetailEqBottles > 0) {
    reasons.push(`${round(profile.localRetailEqBottles, 1)} non-tenant Ohio-local 750ml-equivalent bottles in the observed window`);
  }
  if (peerEvidence.buyers >= 10 && peerEvidence.comparableShare !== null) {
    reasons.push(`Basket compared with ${peerEvidence.buyers} Agencies selling this product`);
  }
  if (reasons.length === 0) reasons.push('Not enough non-tenant market evidence is available yet');

  return {
    categoryEqBottles: round(categoryEqBottles),
    comparableEqBottles: round(priceEvidence.comparableBottles),
    comparableShare: round(priceEvidence.comparableShare, 4),
    confidence,
    fitBand,
    fitScore,
    localComparableEqBottles: round(priceEvidence.localComparableBottles),
    peerBuyerCount: peerEvidence.buyers,
    peerComparableShare: peerEvidence.comparableShare === null ? null : round(peerEvidence.comparableShare, 4),
    reasons: reasons.slice(0, 4),
  };
}
