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
  salesDataAvailable?: boolean;
  researchCurrent?: boolean;
  researchConfidence?: string | null;
  openStatus?: string | null;
  researchEvidence?: Array<{ field: string; claim: string; exactLocation: boolean }>;
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
  privateDining?: string | null;
  venueType?: string | null;
  footTrafficSignal?: string | null;
  footTrafficEvidence?: string | null;
  meetingSpaceSquareFeet?: number | null;
  cocktailProgram?: string | null;
  popularitySignal?: string | null;
  googleRating?: number | null;
  googleReviewCount?: number | null;
  yelpRating?: number | null;
  yelpReviewCount?: number | null;
  publicRatings?: Array<{ sourceName: string; rating: number; reviewCount: number | null }>;
  localBrandsOnMenu?: string[];
  publicResearchSourceUrls?: string[];
  visits30: number;
  visits60: number;
  visits90: number;
};

export type OpportunityHypothesis = {
  targetProduct?: AffinityProduct;
  pitchMode?: 'ACCOUNT_FIT' | 'SPECIFIC_PRODUCT' | 'RESEARCH_ONLY';
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
const nonTenantPurchases = (signals: AccountOpportunitySignals) => signals.purchases.filter((item) => !item.isEcho && item.bottles90 > 0);
const accountVolume90 = (signals: AccountOpportunitySignals) => sum90(nonTenantPurchases(signals));
const localAccountVolume90 = (signals: AccountOpportunitySignals) => sum90(nonTenantPurchases(signals).filter((item) => item.isLocal));

function productPitchQualified(signals: AccountOpportunitySignals, product: AffinityProduct) {
  const evidence = getPriceEvidence(signals.purchases, product);
  return {
    evidence,
    qualified: evidence.nonLocalComparableBottles >= opportunityRules.specificPitchNonLocalBottles90Days
      && evidence.localComparableBottles < opportunityRules.localIncumbentBottles90Days,
  };
}

function accountFitCopy(signals: AccountOpportunitySignals, type: OpportunityType, retainedProduct?: AffinityProduct) {
  const totalVolume = accountVolume90(signals);
  const localVolume = localAccountVolume90(signals);
  const evidence = retainedProduct ? productPitchQualified(signals, retainedProduct).evidence : null;
  const localConflict = evidence && evidence.localComparableBottles >= opportunityRules.localIncumbentBottles90Days;
  return {
    pitchMode: 'ACCOUNT_FIT' as const,
    title: type === OpportunityType.CROSS_SELL ? 'Portfolio expansion opportunity' : 'High-fit account',
    recommendedAction: type === OpportunityType.CROSS_SELL ? 'Explore additional portfolio fit' : 'Explore portfolio fit',
    explanation: [
      `${totalVolume.toFixed(1)} non-tenant bottles purchased in 90 days across ${new Set(nonTenantPurchases(signals).map((item) => item.category).filter(Boolean)).size} categories`,
      localVolume > 0 ? `${localVolume.toFixed(1)} bottles from verified Ohio-owned brands indicate craft affinity` : 'No verified Ohio-owned purchase volume is currently available',
      localConflict
        ? `${retainedProduct!.name} is not a recommended displacement pitch: ${evidence!.localComparableBottles.toFixed(1)} comparable bottles are from Ohio-owned incumbents`
        : 'No specific product pitch currently meets the non-Ohio incumbent volume threshold',
    ],
  };
}

export function presentOpportunityHypothesis(hypothesis: OpportunityHypothesis, signals: AccountOpportunitySignals): OpportunityHypothesis {
  if (signals.salesDataAvailable === false) return researchOnlyHypothesis(signals);
  if (!hypothesis.targetProduct || (hypothesis.type !== OpportunityType.CATEGORY_CONQUEST && hypothesis.type !== OpportunityType.CROSS_SELL)) return hypothesis;
  const { qualified } = productPitchQualified(signals, hypothesis.targetProduct);
  if (qualified) return { ...hypothesis, pitchMode: 'SPECIFIC_PRODUCT' };
  return { ...hypothesis, ...accountFitCopy(signals, hypothesis.type, hypothesis.targetProduct) };
}

export function isNationalChainSignal(signals: AccountOpportunitySignals) {
  if (signals.isNationalChain !== null && signals.isNationalChain !== undefined) return signals.isNationalChain;
  const explicitResearch = `${signals.ownershipVerification ?? ''} ${signals.buyerStructure ?? ''}`;
  if (/\bnational\b|\bcorporate chain\b|\bcentralized purchasing\b/i.test(explicitResearch)) return true;
  const identity = normalized(`${signals.accountName ?? ''} ${signals.ownershipGroupName ?? ''}`);
  return nationalChainNamePatterns.some((pattern) => identity.includes(normalized(pattern)));
}

const hasExactResearchEvidence = (signals: AccountOpportunitySignals, pattern: RegExp) =>
  (signals.researchEvidence ?? []).some((item) => item.exactLocation && pattern.test(normalized(item.field)));

const publicResearchScoreComponents = (signals: AccountOpportunitySignals) => {
  const ratingSignals = signals.publicRatings?.length ? signals.publicRatings.map((item) => ({
    rating: item.rating, reviews: item.reviewCount,
  })) : [
    { rating: signals.googleRating, reviews: signals.googleReviewCount },
    { rating: signals.yelpRating, reviews: signals.yelpReviewCount },
  ].filter((item) => item.rating !== null && item.rating !== undefined);
  const highestReviewCount = Math.max(0, ...ratingSignals.map((item) => Math.max(0, item.reviews ?? 0)));
  const reviewVolume = highestReviewCount >= 5_000 ? 25
    : highestReviewCount >= 2_500 ? 22
    : highestReviewCount >= 1_000 ? 18
    : highestReviewCount >= 500 ? 13
    : highestReviewCount >= 250 ? 9
    : highestReviewCount >= 100 ? 5
    : 0;
  const averageRating = ratingSignals.length
    ? ratingSignals.reduce((sum, item) => sum + Number(item.rating), 0) / ratingSignals.length
    : 0;
  const subjectiveRating = averageRating >= 4.5 ? 2 : averageRating >= 4 ? 1 : 0;
  const footTrafficSupported = Boolean(signals.footTrafficEvidence)
    && hasExactResearchEvidence(signals, /\bfoot traffic\b|\bfoottraffic\b|\btraffic\b|\bcapacity\b|\battendance\b/);
  const footTraffic = !footTrafficSupported ? 0
    : hasText(signals.footTrafficSignal, /\bvery high\b/) ? 40
    : hasText(signals.footTrafficSignal, /\bhigh\b/) ? 30
    : hasText(signals.footTrafficSignal, /\bmedium\b|\bmoderate\b/) ? 15
    : 0;
  const patio = hasText(signals.patioOutdoor, /\bstrong\b|\blarge\b|\brooftop\b/) ? 8
    : hasText(signals.patioOutdoor, /\byes\b/) ? 5 : 0;
  const privateDining = hasText(signals.privateDining, /\bstrong\b|\bmultiple\b|\blarge\b/) ? 8
    : hasText(signals.privateDining, /\byes\b/) ? 5 : 0;
  const hotelMeetingSupported = hasText(signals.venueType, /\bhotel bar restaurant\b/)
    && hasExactResearchEvidence(signals, /\bhotel meeting space\b|\bhotelmeetingspace\b|\bmeeting space\b|\bmeetingspace\b/);
  const meetingSpace = !hotelMeetingSupported ? 0
    : (signals.meetingSpaceSquareFeet ?? 0) >= 100_000 ? 25
    : (signals.meetingSpaceSquareFeet ?? 0) >= 50_000 ? 10
    : (signals.meetingSpaceSquareFeet ?? 0) > 0 ? 4
    : 0;
  const cocktailProgram = hasText(signals.cocktailProgram, /\bstrong\b|\bextensive\b/) ? 8
    : hasText(signals.cocktailProgram, /\bmoderate\b|\byes\b/) ? 4 : 0;
  return { footTraffic, reviewVolume, subjectiveRating, patio, privateDining, meetingSpace, cocktailProgram, highestReviewCount };
};

const qualitativePublicScore = (signals: AccountOpportunitySignals) => {
  const components = publicResearchScoreComponents(signals);
  return Math.min(20, (components.footTraffic + components.reviewVolume + components.subjectiveRating
    + components.patio + components.privateDining + components.meetingSpace + components.cocktailProgram) * 0.4);
};

function researchOnlyHypothesis(signals: AccountOpportunitySignals): OpportunityHypothesis {
    return {
      type: OpportunityType.CATEGORY_CONQUEST, pitchMode: 'RESEARCH_ONLY', targetCategory: null,
      cycleKey: 'research-fit', title: 'Research-based account fit',
      recommendedAction: signals.openStatus === 'Closed' ? 'Verify closure before prioritizing' : 'Qualify buyer, price fit and local distribution',
      explanation: ['Provisional research-only assessment; purchase volume, bottle-price affinity and buying outcomes are unavailable.'],
    };
}

export function detectOpportunityHypotheses(signals: AccountOpportunitySignals): OpportunityHypothesis[] {
  if (signals.accountStatus === 'DO_NOT_PURSUE') return [];
  if (signals.salesDataAvailable === false) {
    if (!signals.researchCurrent || !signals.portfolio?.length) return [];
    return [researchOnlyHypothesis(signals)];
  }
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
  const existingEcho = signals.purchases.some((item) => item.isEcho && item.currentAnnualBottles > 0);
  if (signals.portfolio !== undefined && accountVolume90(signals) >= opportunityRules.minimumCategoryBottles90Days) {
    const type = existingEcho ? OpportunityType.CROSS_SELL : OpportunityType.CATEGORY_CONQUEST;
    result.push({
      type,
      targetCategory: null,
      cycleKey: 'account-fit',
      ...accountFitCopy(signals, type),
    });
  }
  targets.forEach(({ category, product }) => {
    const categoryItems = allForCategory(signals, category);
    const categoryVolume = sum90(categoryItems);
    const echoItems = echoForCategory(signals, category);
    if (categoryVolume < opportunityRules.minimumCategoryBottles90Days || echoItems.some((item) => item.currentAnnualBottles > 0 && (!product || item.itemCode === product.itemCode))) return;
    const type = existingEcho ? OpportunityType.CROSS_SELL : OpportunityType.CATEGORY_CONQUEST;
    if (product && !productPitchQualified(signals, product).qualified) return;
    result.push({
      type,
      targetProduct: product,
      pitchMode: product ? 'SPECIFIC_PRODUCT' : undefined,
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

export const noCurrentOpportunityRank = (): RankResult => ({
  score: 0,
  priorityBand: 'LOW',
  factors: ['No current qualifying opportunity signals', 'Score components: no baseline points'],
  version: OPPORTUNITY_RANKING_VERSION,
});

export class RuleBasedOpportunityRanker implements OpportunityRanker {
  rank(opportunity: OpportunityHypothesis, signals: AccountOpportunitySignals): RankResult {
    if (signals.salesDataAvailable === false || opportunity.pitchMode === 'RESEARCH_ONLY') return rankResearchOnly(signals);
    const factors = [...opportunity.explanation];
    const accountFit = opportunity.pitchMode === 'ACCOUNT_FIT';
    const categoryBottles = opportunity.targetCategory ? sum90(allForCategory(signals, opportunity.targetCategory)) : 0;
    const categoryDemandScore = accountFit ? Math.min(30, accountVolume90(signals) * 0.25) : Math.min(15, categoryBottles * 0.25);
    const hasTargetComponents = [signals.targetPriceFitPercent, signals.targetTotalVolumePercentile, signals.targetConsistencyScore, signals.targetMomentumScore]
      .some((value) => value !== null && value !== undefined);
    const targetMarketScore = hasTargetComponents
      ? percent(signals.targetPriceFitPercent) * 0.08 + percent(signals.targetTotalVolumePercentile) * 0.07 + percent(signals.targetConsistencyScore) * 0.03 + percent(signals.targetMomentumScore) * 0.02
      : percent(signals.targetDataScore) * 0.2;
    const price = opportunity.targetProduct ? getPriceEvidence(signals.purchases, opportunity.targetProduct) : null;
    const portfolioMarketPriceScore = signals.portfolio?.length
      ? Math.max(0, ...signals.portfolio.map((product) => getPriceEvidence(signals.purchases, product).marketPriceScore))
      : 0;
    const localVolume = localAccountVolume90(signals);
    const localCraftScore = accountFit
      ? (localVolume > 0 ? 2 + 8 * Math.min(1, localVolume / 24) : 0)
      : price?.localScore ?? (((signals.ohioCraft9L ?? 0) > 0 || (signals.ohioCraftAffinity ?? 0) > 0) ? 1 : 0);
    const publicFitScore = Math.max(percent(signals.targetPublicFitScore) * 0.15, qualitativePublicScore(signals));
    const relationshipScore = Math.min(10, signals.echoBottles90 * 0.5);
    const relationshipOpportunity = new Set<OpportunityType>([OpportunityType.LAPSED_BUYER, OpportunityType.FIRST_ORDER_FOLLOW_UP, OpportunityType.NO_RECENT_TOUCH]).has(opportunity.type);
    const urgencyScore = relationshipOpportunity ? Math.min(5, (signals.daysSinceLastVisit ?? 90) / 18) : 0;
    const peer = !accountFit && opportunity.targetProduct ? signals.peerEvidence?.[opportunity.targetProduct.itemCode] : null;
    const learned = !accountFit && opportunity.targetProduct ? signals.learningAdjustment?.[opportunity.targetProduct.itemCode] ?? 0 : 0;
    const priceScore = accountFit
      ? Math.min(25, portfolioMarketPriceScore * 25 / 35)
      : price ? price.priceScore : Math.min(8, targetMarketScore);
    const peerScore = peer?.score ?? 0;
    const learningScore = Math.max(-10, Math.min(10, learned));
    const worklistPenalty = Math.min(5, signals.openWorklistCount * 1.5);
    let score = categoryDemandScore + priceScore + localCraftScore + publicFitScore + relationshipScore + urgencyScore + peerScore + learningScore - worklistPenalty;
    factors.push(`Score components: ${accountFit ? 'account volume' : 'category demand'} ${categoryDemandScore.toFixed(1)}, price readiness ${priceScore.toFixed(1)}, Ohio craft affinity ${localCraftScore.toFixed(1)}, public fit ${publicFitScore.toFixed(1)}, relationship ${relationshipScore.toFixed(1)}, urgency ${urgencyScore.toFixed(1)}, peers ${peerScore.toFixed(1)}, learning ${learningScore.toFixed(1)}, worklist -${worklistPenalty.toFixed(1)}; no baseline points`);

    if (accountFit) {
      factors.push(`Account-wide volume: ${accountVolume90(signals).toFixed(1)} non-tenant bottles in 90 days; verified Ohio-owned volume ${localVolume.toFixed(1)} bottles`);
      factors.push(`Best portfolio price readiness contribution ${priceScore.toFixed(1)}/25; this supports account priority without prescribing a product`);
    } else if (price) {
      factors.push(`Target ${opportunity.targetProduct!.name} (${opportunity.targetProduct!.itemCode}): ${price.targetPrice750 ? `$${price.targetPrice750.toFixed(2)} retail per 750ml equivalent` : 'catalog price unavailable'}`);
      factors.push(`Same-category market fit: ${price.nonLocalComparableBottles.toFixed(1)} comparable non-Ohio bottles and ${price.localComparableBottles.toFixed(1)} comparable Ohio-owned bottles`);
      factors.push(`Price coverage ${(price.coverage * 100).toFixed(0)}%; ${(price.cheapShare * 100).toFixed(1)}% of priced category volume is below 60% of target price`);
      factors.push(`General Ohio-brand contribution ${price.localScore.toFixed(1)}/2; Ohio-owned same-lane volume does not support a displacement pitch`);
      if (!price.targetPrice750 || price.coverage < .7) factors.push('Insufficient catalog price coverage; price suitability is unconfirmed');
      if (peer) factors.push(`Existing buyers of this product: ${peer.buyers} comparable accounts; peer contribution ${peer.score.toFixed(1)}/5`);
      if (learned) factors.push(`Validated tenant outcome adjustment ${learned.toFixed(1)} points`);
      if (price.mismatch) { score = Math.min(30, score - 20); factors.push('Purchasing is concentrated well below this product’s price; 20-point penalty and acquisition priority capped at 30'); }
      if (price.localComparableBottles >= opportunityRules.localIncumbentBottles90Days) {
        score = Math.min(20, score - 25);
        factors.push(`Ohio-owned incumbent protection: ${price.localComparableBottles.toFixed(1)} comparable bottles; 25-point penalty and this product pitch is capped at 20`);
      }
    } else if ((signals.ohioCraft9L ?? 0) > 0) factors.push('Legacy Ohio-brand volume is unverified for category and price; contributes at most 1 point');
    if (signals.observedSince) factors.push(`Available purchase observations begin ${signals.observedSince}; windows may be incomplete`);
    if (signals.targetTotalVolumePercentile !== null && signals.targetTotalVolumePercentile !== undefined) factors.push(`Sales volume percentile ${Math.round(Number(signals.targetTotalVolumePercentile))}`);
    if (signals.patioOutdoor) factors.push(`Public research — patio: ${signals.patioOutdoor}`);
    if (signals.privateDining) factors.push(`Public research — private dining: ${signals.privateDining}`);
    if (signals.footTrafficSignal) factors.push(`Public research — foot traffic: ${signals.footTrafficSignal}${signals.footTrafficEvidence ? ` (${signals.footTrafficEvidence})` : ' (unverified; no score contribution)'}`);
    if (hasText(signals.venueType, /\bhotel bar restaurant\b/) && signals.meetingSpaceSquareFeet !== null && signals.meetingSpaceSquareFeet !== undefined) factors.push(`Hotel venue — ${signals.meetingSpaceSquareFeet.toLocaleString()} square feet of meeting space`);
    if (signals.cocktailProgram) factors.push(`Public research — cocktail program: ${signals.cocktailProgram}`);
    if (signals.popularitySignal) factors.push(`Public research — popularity: ${signals.popularitySignal}`);
    if (signals.publicRatings?.length) {
      for (const rating of signals.publicRatings) factors.push(`${rating.sourceName} public rating ${rating.rating.toFixed(1)} from ${rating.reviewCount ?? 'unknown'} reviews`);
    } else {
      if (signals.googleRating) factors.push(`Public rating ${Number(signals.googleRating).toFixed(1)} from ${signals.googleReviewCount ?? 'unknown'} reviews; legacy source not recorded`);
      if (signals.yelpRating) factors.push(`Yelp public rating ${Number(signals.yelpRating).toFixed(1)} from ${signals.yelpReviewCount ?? 'unknown'} reviews`);
    }
    if (signals.localBrandsOnMenu?.length) factors.push(`Local brands found on menu: ${signals.localBrandsOnMenu.slice(0, 4).join(', ')}`);
    if (!signals.targetPublicFitScore && !signals.patioOutdoor && !signals.cocktailProgram && !signals.popularitySignal) factors.push('Public-fit research has not been completed; score currently relies on sales evidence');
    if (isNationalChainSignal(signals)) {
      score = Math.min(score - 20, opportunityRules.nationalChainScoreCap);
      factors.push(`National chain with likely centralized brand contracts; 20-point penalty and priority capped at ${opportunityRules.nationalChainScoreCap}`);
    }
    score = Math.round(Math.max(0, Math.min(100, score)) * 10) / 10;
    return { score, priorityBand: score >= 75 ? 'HIGH' : score >= 45 ? 'MEDIUM' : 'LOW', factors, version: OPPORTUNITY_RANKING_VERSION };
  }
}

export const RESEARCH_FIT_VERSION = 'RESEARCH_FIT_V2';

function rankResearchOnly(signals: AccountOpportunitySignals): RankResult {
  // This is a separate discovery score, not a sales prediction or a rescaled account-fit score.
  const publicSignals = publicResearchScoreComponents(signals);
  const craft = signals.localBrandsOnMenu?.length ? 5 : 0;
  const menu = (signals.researchEvidence ?? []).filter(item => item.exactLocation && /menu|cocktail/i.test(item.field)).map(item => item.claim).join(' ');
  const categories = [...new Set((signals.portfolio ?? []).filter(item => item.priority > 0).map(item => item.category).filter(Boolean))];
  const matched = categories.filter(category => new RegExp(`\\b${category!.toLowerCase()}\\b`, 'i').test(menu));
  const portfolioFit = matched.length ? 8 : 0;
  const independent = signals.isNationalChain === false && hasText(signals.buyerStructure, /\blocal\b|\bindependent\b|\bowner\b/) ? 4 : 0;
  const objectiveTraffic = publicSignals.footTraffic + publicSignals.reviewVolume;
  const venueAttributes = publicSignals.patio + publicSignals.privateDining + publicSignals.meetingSpace;
  const factors = [
    'Provisional research-only score. Compare with other research-only accounts; it is not equivalent to a sales-backed account-fit score.',
    'Sales volume, bottle-price affinity, purchase history, peer sales and conversion learning are unavailable; no purchase or product-displacement claims are inferred.',
    `Score components: objective traffic ${objectiveTraffic.toFixed(1)}, venue attributes ${venueAttributes.toFixed(1)}, cocktail program ${publicSignals.cocktailProgram.toFixed(1)}, subjective rating ${publicSignals.subjectiveRating.toFixed(1)}, local menu evidence ${craft.toFixed(1)}, portfolio category fit ${portfolioFit.toFixed(1)}, independent buying ${independent.toFixed(1)}; no baseline points`,
    `Objective traffic: direct evidence ${publicSignals.footTraffic.toFixed(1)}, highest verified review count ${publicSignals.highestReviewCount.toLocaleString()} (${publicSignals.reviewVolume.toFixed(1)} points). Star rating contributes at most 2 points.`,
    `Venue attributes: patio ${signals.patioOutdoor ?? 'unknown'}, private dining ${signals.privateDining ?? 'unknown'}, venue type ${signals.venueType ?? 'unknown'}`,
    matched.length ? `Verified menu categories overlap this tenant's portfolio: ${matched.join(', ')}` : 'Menu overlap with this tenant’s portfolio is unconfirmed.',
    'Confirm state distribution and buyer price expectations before proposing a specific product.',
  ];
  if (signals.localBrandsOnMenu?.length) factors.push(`Local brands on menu: ${signals.localBrandsOnMenu.join(', ')}. Existing local placements are not displacement targets.`);
  for (const rating of signals.publicRatings ?? []) factors.push(`${rating.sourceName}: ${rating.rating.toFixed(1)} from ${rating.reviewCount ?? 'unknown'} reviews`);
  if (publicSignals.footTraffic > 0 && signals.footTrafficEvidence) factors.push(`Direct foot-traffic evidence: ${signals.footTrafficEvidence}`);
  if (publicSignals.meetingSpace > 0) factors.push(`Hotel meeting demand: ${(signals.meetingSpaceSquareFeet ?? 0).toLocaleString()} square feet; hotel-only contribution ${publicSignals.meetingSpace.toFixed(1)} points.`);
  let score = objectiveTraffic + venueAttributes + publicSignals.cocktailProgram + publicSignals.subjectiveRating + craft + portfolioFit + independent;
  if (isNationalChainSignal(signals)) {
    score = Math.min(20, score - 25);
    factors.push('National chain: 25-point penalty; research-only score capped at 20.');
  }
  if (signals.researchConfidence !== 'HIGH' || signals.openStatus !== 'Open') {
    score = Math.min(score, signals.researchConfidence === 'MEDIUM' ? 60 : 40);
    factors.push('Incomplete research confidence or operating status limits provisional priority.');
  }
  if (!signals.researchCurrent || signals.openStatus === 'Closed') {
    score = 0;
    factors.push(signals.openStatus === 'Closed' ? 'Account reported closed: score is zero.' : 'Current-location research is unavailable: score is zero.');
  }
  if (signals.accountStatus === 'DO_NOT_PURSUE' || !signals.portfolio?.some(product => product.priority > 0)) {
    score = 0;
    factors.push('No current qualifying fit: this tenant has suppressed pursuit or has no eligible priority products.');
  }
  score = Math.round(Math.max(0, Math.min(100, score)) * 10) / 10;
  return { score, priorityBand: score >= 75 ? 'HIGH' : score >= 45 ? 'MEDIUM' : 'LOW', factors, version: RESEARCH_FIT_VERSION };
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
