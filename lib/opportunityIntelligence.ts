import { OpportunityType } from '@prisma/client';
import { nationalChainNamePatterns, opportunityCategoryMap, opportunityRules, OPPORTUNITY_RANKING_VERSION, type PortfolioCategory } from './opportunityConfig';
import { getPriceEvidence, type AffinityProduct, type PeerEvidence } from './opportunityAffinity';

export type PurchaseSignal = {
  category: PortfolioCategory | null;
  itemCode: string;
  itemName: string;
  isEcho: boolean;
  lastPurchaseAt: string | null;
  bottles30: number;
  bottles60: number;
  bottles90: number;
  currentAnnualBottles: number;
  price750?: number | null;
  liters?: number;
  isLocal?: boolean;
};

export type AccountOpportunitySignals = {
  accountName?: string;
  organizationId?: string;
  productLabel?: string;
  portfolio?: AffinityProduct[];
  peerEvidence?: Record<string, PeerEvidence>;
  learningAdjustment?: Record<string, number>;
  observedSince?: string | null;
  asOfDate: string;
  accountStatus: string;
  assignedUserId: string | null;
  daysSinceLastEchoPurchase: number | null;
  daysSinceLastVisit: number | null;
  echoBottles30: number;
  echoBottles60: number;
  echoBottles90: number;
  echoPurchaseEvents90: number;
  firstEchoPurchaseAt: string | null;
  historyComplete: boolean;
  lastEchoPurchaseAt: string | null;
  lastVisitAt: string | null;
  openWorklistCount: number;
  purchases: PurchaseSignal[];
  targetStatus: string | null;
  targetDataScore?: number | null;
  targetPublicFitScore?: number | null;
  targetPriceFitPercent?: number | null;
  targetTotalVolumePercentile?: number | null;
  targetConsistencyScore?: number | null;
  targetMomentumScore?: number | null;
  ohioCraft9L?: number | null;
  ohioCraftAffinity?: number | null;
  ownershipGroupName?: string | null;
  isNationalChain?: boolean | null;
  ownershipVerification?: string | null;
  buyerStructure?: string | null;
  patioOutdoor?: string | null;
  cocktailProgram?: string | null;
  popularitySignal?: string | null;
  googleRating?: number | null;
  googleReviewCount?: number | null;
  yelpRating?: number | null;
  yelpReviewCount?: number | null;
  localBrandsOnMenu?: string[];
  publicResearchSourceUrls?: string[];
  visits30: number;
  visits60: number;
  visits90: number;
};

export type OpportunityHypothesis = {
  targetProduct?: AffinityProduct;
  cycleKey: string;
  explanation: string[];
  recommendedAction: string;
  targetCategory: PortfolioCategory | null;
  title: string;
  type: OpportunityType;
};

const echoForCategory = (s: AccountOpportunitySignals, category: PortfolioCategory) =>
  s.purchases.filter((item) => item.isEcho && item.category === category);
const allForCategory = (s: AccountOpportunitySignals, category: PortfolioCategory) =>
  s.purchases.filter((item) => item.category === category);
const sum90 = (items: PurchaseSignal[]) => items.reduce((sum, item) => sum + item.bottles90, 0);
const labels = (items: PurchaseSignal[]) => items.slice(0, 3).map((item) => `${item.itemCode} - ${item.itemName}`);
const percent = (value?: number | null) => Math.max(0, Math.min(100, value ?? 0));
const normalized = (value?: string | null) => (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const hasText = (value: string | null | undefined, pattern: RegExp) => pattern.test(normalized(value));

export function isNationalChainSignal(signals: AccountOpportunitySignals) {
  if (signals.isNationalChain !== null && signals.isNationalChain !== undefined) return signals.isNationalChain;
  const explicitResearch = `${signals.ownershipVerification ?? ''} ${signals.buyerStructure ?? ''}`;
  if (/\bnational\b|\bcorporate chain\b|\bcentralized purchasing\b/i.test(explicitResearch)) return true;
  const identity = normalized(`${signals.accountName ?? ''} ${signals.ownershipGroupName ?? ''}`);
  return nationalChainNamePatterns.some((pattern) => identity.includes(normalized(pattern)));
}

const qualitativePublicScore = (signals: AccountOpportunitySignals) => {
  let score = 0;
  if (hasText(signals.patioOutdoor, /\byes\b|\bstrong\b|\blarge\b|\brooftop\b/)) score += 3;
  if (hasText(signals.cocktailProgram, /\bstrong\b|\bextensive\b/)) score += 4;
  else if (hasText(signals.cocktailProgram, /\bmoderate\b|\byes\b/)) score += 2;
  if (hasText(signals.popularitySignal, /\bhigh\b|\bvery busy\b/)) score += 4;
  else if (hasText(signals.popularitySignal, /\bmedium\b|\bmoderate\b/)) score += 2;
  const ratingSignals = [
    { rating: signals.googleRating, reviews: signals.googleReviewCount },
    { rating: signals.yelpRating, reviews: signals.yelpReviewCount },
  ].filter((item) => item.rating !== null && item.rating !== undefined);
  if (ratingSignals.length > 0) {
    const averageRating = ratingSignals.reduce((sum, item) => sum + Number(item.rating), 0) / ratingSignals.length;
    const totalReviews = ratingSignals.reduce((sum, item) => sum + Math.max(0, item.reviews ?? 0), 0);
    score += averageRating >= 4.5 ? 2 : averageRating >= 4 ? 1 : 0;
    score += totalReviews >= 1000 ? 2 : totalReviews >= 250 ? 1 : 0;
  }
  return Math.min(15, score);
};

export function detectOpportunityHypotheses(signals: AccountOpportunitySignals): OpportunityHypothesis[] {
  if (signals.accountStatus === 'DO_NOT_PURSUE') return [];
  const result: OpportunityHypothesis[] = [];
  const lastEcho = signals.purchases.filter((item) => item.isEcho).sort((a, b) =>
    (b.lastPurchaseAt ?? '').localeCompare(a.lastPurchaseAt ?? ''))[0];

  if (signals.lastEchoPurchaseAt && signals.daysSinceLastEchoPurchase !== null &&
      signals.daysSinceLastEchoPurchase >= opportunityRules.lapseRecentDays &&
      signals.daysSinceLastEchoPurchase <= opportunityRules.lapseLookbackDays) {
    result.push({
      type: OpportunityType.LAPSED_BUYER,
      cycleKey: `lapsed:${signals.lastEchoPurchaseAt}`,
      targetCategory: lastEcho?.category ?? null,
      title: 'Lapsed Echo buyer',
      recommendedAction: 'Reactivation follow-up',
      explanation: [
        signals.echoBottles90 > 0
          ? `${signals.echoBottles90} Echo bottles observed in the event ledger in 90 days; none in 30 days`
          : 'Stored purchase history shows an Echo purchase within 90 days and none within 30 days',
        `Last Echo purchase ${signals.daysSinceLastEchoPurchase ?? 'unknown'} days ago`,
        ...labels(lastEcho ? [lastEcho] : []),
      ],
    });
  }

  if (signals.historyComplete && signals.firstEchoPurchaseAt && signals.echoBottles30 > 0) {
    const echoItems = signals.purchases.filter((item) => item.isEcho && item.currentAnnualBottles > 0);
    const firstAt = new Date(signals.firstEchoPurchaseAt);
    const asOf = new Date(signals.asOfDate);
    const days = Math.floor((asOf.getTime() - firstAt.getTime()) / 86400000);
    if (days <= opportunityRules.firstOrderWindowDays && signals.echoPurchaseEvents90 === 1) {
      result.push({
        type: OpportunityType.FIRST_ORDER_FOLLOW_UP,
        cycleKey: `first:${signals.firstEchoPurchaseAt}`,
        targetCategory: echoItems[0]?.category ?? null,
        title: 'First-order follow-up',
        recommendedAction: 'Follow up for feedback and a reorder',
        explanation: [`First observed Echo purchase ${days} days ago`, ...labels(echoItems)],
      });
    }
  }

  const targets = signals.portfolio === undefined
    ? (['BOURBON', 'RYE', 'RUM'] as PortfolioCategory[]).map(category => ({ category, product: undefined as AffinityProduct | undefined }))
    : signals.portfolio.filter(p => p.category && p.priority > 0).map(product => ({ category: product.category!, product }));
  targets.forEach(({ category, product }) => {
    const categoryItems = allForCategory(signals, category);
    const categoryVolume = sum90(categoryItems);
    const echoItems = echoForCategory(signals, category);
    if (categoryVolume < opportunityRules.minimumCategoryBottles90Days || echoItems.some((item) => item.currentAnnualBottles > 0 && (!product || item.itemCode === product.itemCode))) return;
    const existingEcho = signals.purchases.some((item) => item.isEcho && item.currentAnnualBottles > 0);
    const type = existingEcho ? OpportunityType.CROSS_SELL : OpportunityType.CATEGORY_CONQUEST;
    result.push({
      type,
      targetProduct: product,
      targetCategory: category,
      cycleKey: `${type.toLowerCase()}:${product?.itemCode ?? category}:${categoryItems.map((item) => item.lastPurchaseAt ?? '').sort().at(-1) ?? 'observed'}`,
      title: product ? `${existingEcho ? 'Cross-sell' : 'Introduce'} ${product.name}` : existingEcho ? `Cross-sell ${opportunityCategoryMap[category].label}` : `${opportunityCategoryMap[category].label} buyer / Echo nonbuyer`,
      recommendedAction: `Discuss ${product?.name ?? `Echo ${opportunityCategoryMap[category].label}`}`,
      explanation: [
        `${categoryVolume} ${opportunityCategoryMap[category].label.toLowerCase()} bottles purchased in 90 days`,
        `No ${product?.name ?? `Echo ${opportunityCategoryMap[category].label}`} purchase observed in the available purchase history`,
        ...labels(categoryItems.filter((item) => !item.isEcho)),
      ],
    });
  });

  if (signals.echoBottles90 >= opportunityRules.activePurchaseBottles90Days &&
      (signals.daysSinceLastVisit === null || signals.daysSinceLastVisit >= opportunityRules.noTouchDays)) {
    result.push({
      type: OpportunityType.NO_RECENT_TOUCH,
      cycleKey: `touch:${signals.lastVisitAt ?? 'never'}`,
      targetCategory: null,
      title: 'Active customer needing attention',
      recommendedAction: 'Visit or contact account',
      explanation: [
        `${signals.echoBottles90} Echo bottles purchased in 90 days`,
        signals.daysSinceLastVisit === null ? 'No CRM visit recorded' : `Last CRM visit ${signals.daysSinceLastVisit} days ago`,
      ],
    });
  }
  return result.map(h => ({ ...h, title: h.title.replace(/\bEcho\b/g, signals.productLabel ?? 'Echo'), recommendedAction: h.recommendedAction.replace(/\bEcho\b/g, signals.productLabel ?? 'Echo'), explanation: h.explanation.map(text => text.replace(/\bEcho\b/g, signals.productLabel ?? 'Echo')) }));
}

export type RankResult = { score: number; priorityBand: 'HIGH' | 'MEDIUM' | 'LOW'; factors: string[]; version: string };
export interface OpportunityRanker { rank(opportunity: OpportunityHypothesis, signals: AccountOpportunitySignals): RankResult }

export class RuleBasedOpportunityRanker implements OpportunityRanker {
  rank(opportunity: OpportunityHypothesis, signals: AccountOpportunitySignals): RankResult {
    const factors = [...opportunity.explanation];
    const categoryBottles = opportunity.targetCategory ? sum90(allForCategory(signals, opportunity.targetCategory)) : 0;
    const categoryDemandScore = Math.min(15, categoryBottles * 0.25);
    const hasTargetComponents = [signals.targetPriceFitPercent, signals.targetTotalVolumePercentile, signals.targetConsistencyScore, signals.targetMomentumScore]
      .some((value) => value !== null && value !== undefined);
    const targetMarketScore = hasTargetComponents
      ? percent(signals.targetPriceFitPercent) * 0.08 + percent(signals.targetTotalVolumePercentile) * 0.07 + percent(signals.targetConsistencyScore) * 0.03 + percent(signals.targetMomentumScore) * 0.02
      : percent(signals.targetDataScore) * 0.2;
    const price = opportunity.targetProduct ? getPriceEvidence(signals.purchases, opportunity.targetProduct) : null;
    const localCraftScore = price?.localScore ?? (((signals.ohioCraft9L ?? 0) > 0 || (signals.ohioCraftAffinity ?? 0) > 0) ? 1 : 0);
    const publicFitScore = Math.max(percent(signals.targetPublicFitScore) * 0.15, qualitativePublicScore(signals));
    const relationshipScore = Math.min(10, signals.echoBottles90 * 0.5);
    const urgencyScore = Math.min(5, (signals.daysSinceLastVisit ?? 90) / 18);
    const peer = opportunity.targetProduct ? signals.peerEvidence?.[opportunity.targetProduct.itemCode] : null;
    const learned = opportunity.targetProduct ? signals.learningAdjustment?.[opportunity.targetProduct.itemCode] ?? 0 : 0;
    let score = 10 + categoryDemandScore + (price ? price.priceScore : Math.min(8, targetMarketScore)) + localCraftScore + publicFitScore + relationshipScore + urgencyScore + (peer?.score ?? 0) + Math.max(-10, Math.min(10, learned));
    score -= Math.min(5, signals.openWorklistCount * 1.5);

    if (price) {
      factors.push(`Target ${opportunity.targetProduct!.name} (${opportunity.targetProduct!.itemCode}): ${price.targetPrice750 ? `$${price.targetPrice750.toFixed(2)} retail per 750ml equivalent` : 'catalog price unavailable'}`);
      factors.push(`Same-category price fit: ${(price.comparableShare * 100).toFixed(1)}% of priced volume; ${price.comparableBottles.toFixed(1)} comparable 750ml-equivalent bottles`);
      factors.push(`Price coverage ${(price.coverage * 100).toFixed(0)}%; ${(price.cheapShare * 100).toFixed(1)}% of priced category volume is below 60% of target price`);
      factors.push(`Ohio-brand contribution ${price.localScore.toFixed(1)}/10; full credit requires a comparable category and price`);
      if (!price.targetPrice750 || price.coverage < .7) factors.push('Insufficient catalog price coverage; price suitability is unconfirmed');
      if (peer) factors.push(`Existing buyers of this product: ${peer.buyers} comparable accounts; peer contribution ${peer.score.toFixed(1)}/5`);
      if (learned) factors.push(`Validated tenant outcome adjustment ${learned.toFixed(1)} points`);
      if (price.mismatch) { score = Math.min(30, score); factors.push('Purchasing is concentrated well below this product’s price; acquisition priority capped at 30'); }
    } else if ((signals.ohioCraft9L ?? 0) > 0) factors.push('Legacy Ohio-brand volume is unverified for category and price; contributes at most 1 point');
    if (signals.observedSince) factors.push(`Available purchase observations begin ${signals.observedSince}; windows may be incomplete`);
    if (signals.targetTotalVolumePercentile !== null && signals.targetTotalVolumePercentile !== undefined) factors.push(`Sales volume percentile ${Math.round(Number(signals.targetTotalVolumePercentile))}`);
    if (signals.patioOutdoor) factors.push(`Public research — patio: ${signals.patioOutdoor}`);
    if (signals.cocktailProgram) factors.push(`Public research — cocktail program: ${signals.cocktailProgram}`);
    if (signals.popularitySignal) factors.push(`Public research — popularity: ${signals.popularitySignal}`);
    if (signals.googleRating) factors.push(`Google ${Number(signals.googleRating).toFixed(1)} from ${signals.googleReviewCount ?? 'unknown'} reviews`);
    if (signals.yelpRating) factors.push(`Yelp ${Number(signals.yelpRating).toFixed(1)} from ${signals.yelpReviewCount ?? 'unknown'} reviews`);
    if (signals.localBrandsOnMenu?.length) factors.push(`Local brands found on menu: ${signals.localBrandsOnMenu.slice(0, 4).join(', ')}`);
    if (!signals.targetPublicFitScore && !signals.patioOutdoor && !signals.cocktailProgram && !signals.popularitySignal) factors.push('Public-fit research has not been completed; score currently relies on sales evidence');
    if (isNationalChainSignal(signals)) {
      score = Math.min(score, opportunityRules.nationalChainScoreCap);
      factors.push(`National chain with likely centralized brand contracts; priority capped at ${opportunityRules.nationalChainScoreCap}`);
    }
    score = Math.round(Math.max(0, Math.min(100, score)) * 10) / 10;
    return { score, priorityBand: score >= 75 ? 'HIGH' : score >= 45 ? 'MEDIUM' : 'LOW', factors, version: OPPORTUNITY_RANKING_VERSION };
  }
}

export function selectPrimaryOpportunity(hypotheses: OpportunityHypothesis[], signals: AccountOpportunitySignals, ranker: OpportunityRanker = new RuleBasedOpportunityRanker()) {
  return hypotheses
    .map((hypothesis) => ({ hypothesis, ranking: ranker.rank(hypothesis, signals) }))
    .sort((left, right) => right.ranking.score - left.ranking.score || left.hypothesis.type.localeCompare(right.hypothesis.type))[0] ?? null;
}

export function analyzeActivityToPurchases(activityAt: Date, purchases: Date[]) {
  const ordered = [...purchases].sort((a, b) => a.getTime() - b.getTime());
  const later = ordered.filter((date) => date >= activityAt);
  const next = later[0] ?? null;
  const daysToNextPurchase = next ? Math.floor((next.getTime() - activityAt.getTime()) / 86400000) : null;
  return {
    purchaseWithin7Days: daysToNextPurchase !== null && daysToNextPurchase <= 7,
    purchaseWithin14Days: daysToNextPurchase !== null && daysToNextPurchase <= 14,
    purchaseWithin30Days: daysToNextPurchase !== null && daysToNextPurchase <= 30,
    firstPurchaseAfterActivity: Boolean(next && ordered[0]?.getTime() === next.getTime()),
    reorderAfterActivity: Boolean(next && ordered[0]?.getTime() !== next.getTime()),
    daysToNextPurchase,
  };
}

export function rescoreHistoricalSnapshot(snapshot: AccountOpportunitySignals, hypothesis: OpportunityHypothesis, ranker: OpportunityRanker) {
  return ranker.rank(hypothesis, structuredClone(snapshot));
}
