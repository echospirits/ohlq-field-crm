import { normalizeOpportunityCategory, type PortfolioCategory } from './opportunityConfig';

export type AffinityProduct = { itemCode: string; name: string; category: PortfolioCategory | null; price750: number | null; isLocal: boolean; priority: number };
export type AffinityPurchase = { itemCode: string; category: PortfolioCategory | null; price750?: number | null; liters?: number; bottles90: number; isEcho: boolean; isLocal?: boolean };
export type PriceEvidence = { coverage: number; comparableShare: number; comparableBottles: number; cheapShare: number; localScore: number; priceScore: number; mismatch: boolean; targetPrice750: number | null };

// OHLQ productvolume is US fluid ounces, not liters. Snap the rounded catalog
// values to standard sizes before comparing 750ml-equivalent bottle prices.
export function catalogLiters(ounces: unknown): number | null {
  const oz = Number(ounces);
  if (!Number.isFinite(oz) || oz <= 0) return null;
  const standards: [number, number][] = [[1.7, .05], [6.8, .2], [12.7, .375], [16.9, .5], [23.7, .7], [25.4, .75], [33.8, 1], [59.2, 1.75]];
  return standards.find(([value]) => Math.abs(value - oz) < .12)?.[1] ?? oz * .0295735295625;
}
export function pricePer750(retail: unknown, ounces: unknown): number | null {
  const price = Number(retail); const liters = catalogLiters(ounces);
  return Number.isFinite(price) && price > 0 && liters ? price * .75 / liters : null;
}

// Brand-specific evidence; a distributor's entire catalog is not Ohio-owned.
// This intentionally small registry can be extended with verified brand identities.
export function isKnownOhioBrand(name: string) {
  return /\b(ECHO SPIRITS|NOBLE CUT|BUCKEYE VODKA|CAPITAL CITY (VODKA|RUM|SPICED RUM))\b/i.test(name);
}
export function toAffinityProduct(item: { itemCode: string; name: string; category: string | null; retailPrice: unknown; productVolume: unknown }, priority = 1): AffinityProduct {
  return { itemCode: item.itemCode, name: item.name, category: normalizeOpportunityCategory(item.category, item.name), price750: pricePer750(item.retailPrice, item.productVolume), isLocal: isKnownOhioBrand(item.name), priority };
}

export function getPriceEvidence(purchases: AffinityPurchase[], target: AffinityProduct): PriceEvidence {
  const relevant = purchases.filter(p => p.category === target.category && !p.isEcho && p.bottles90 > 0);
  const volume = (p: AffinityPurchase) => p.bottles90 * (p.liters ?? .75);
  const total = relevant.reduce((n,p) => n + volume(p), 0);
  const known = relevant.filter(p => typeof p.price750 === 'number' && p.price750 > 0);
  const knownVolume = known.reduce((n,p) => n + volume(p), 0);
  const comparable = known.filter(p => target.price750 && p.price750! >= target.price750 * .75 && p.price750! <= target.price750 * 1.75);
  const comparableVolume = comparable.reduce((n,p) => n + volume(p), 0);
  const comparableBottles = comparableVolume / .75;
  const comparableShare = knownVolume ? comparableVolume / knownVolume : 0;
  const cheapVolume = known.filter(p => target.price750 && p.price750! < target.price750 * .6).reduce((n,p) => n + volume(p), 0);
  const cheapShare = knownVolume ? cheapVolume / knownVolume : 0;
  const coverage = total ? knownVolume / total : 0;
  const localComparable = comparable.filter(p => p.isLocal).reduce((n,p) => n + volume(p) / .75, 0);
  const anyLocal = purchases.some(p => p.isLocal && !p.isEcho && p.bottles90 > 0);
  return {
    coverage, comparableShare, comparableBottles, cheapShare,
    // A small local preference bonus; the meaningful bonus requires category AND price alignment.
    localScore: (anyLocal ? 2 : 0) + Math.min(8, localComparable / 3),
    priceScore: target.price750 ? (20 * comparableShare + 15 * Math.min(1, comparableBottles / 24)) * coverage : 0,
    mismatch: Boolean(target.price750 && coverage >= .7 && knownVolume / .75 >= 12 && cheapShare >= .8 && comparableBottles < 6),
    targetPrice750: target.price750,
  };
}

export type BuyerBasket = { accountId: string; purchases: AffinityPurchase[] };
export type PeerEvidence = { buyers: number; comparableShare: number | null; score: number };
export function compareWithBuyers(accountId: string, purchases: AffinityPurchase[], target: AffinityProduct, baskets: BuyerBasket[]): PeerEvidence {
  // Per-product cohorts prevent purchasers of a tenant's well vodka from becoming
  // evidence of affinity for that tenant's premium whiskey. Each account gets one vote.
  const peers = baskets.filter(b => b.accountId !== accountId && b.purchases.some(p => p.itemCode === target.itemCode && p.isEcho && p.bottles90 >= 2))
    .map(b => getPriceEvidence(b.purchases, target)).filter(p => p.coverage >= .7 && p.comparableBottles > 0);
  const own = getPriceEvidence(purchases, target);
  const average = peers.length ? peers.reduce((sum,p) => sum + p.comparableShare, 0) / peers.length : null;
  return { buyers: peers.length, comparableShare: average,
    score: peers.length >= 10 && average && own.coverage >= .7 ? Math.min(5, 5 * own.comparableShare / average) * Math.min(1, own.comparableBottles / 12) : 0 };
}
