import { normalizeOpportunityCategory } from './opportunityConfig';

export const ASSESSMENT_VERSION = 'WHOLESALE_COMMERCIAL_V1';
export const EVIDENCE_VERSION = 'WHOLESALE_COMMERCIAL_EVIDENCE_V1';
export const CALIBRATION_VERSION = 'COMMERCIAL_2026_11_V2';
export const assessmentPolicy = {
  horizonDays: 90, researchFreshDays: 180, evidenceFreshDays: 180,
  tenantToObservedPriceMin: .6, tenantToObservedPriceMax: 1.25, meaningfulProduct750Per30: 6,
  tiers: [
    { rating: 1, leading: 6, core: 12, recurring: 0 },
    { rating: 2, leading: 12, core: 24, recurring: 0 },
    { rating: 3, leading: 24, core: 60, recurring: 0 },
    { rating: 4, leading: 48, core: 120, recurring: 60 },
    { rating: 5, leading: 96, core: 240, recurring: 120 },
  ],
} as const;
export type EvidenceMode = 'SALES_BACKED' | 'RESEARCH_ONLY' | 'PARTIAL_SALES';
export type GrowthPath = 'CAPTURE' | 'DEVELOP' | 'DEEPEN';
export type Effort = 'DEDICATED' | 'QUALIFY' | 'MENTION' | 'MAINTAIN' | 'DO_NOT_PURSUE';
export type StrategyRole = 'FOCUS' | 'OPPORTUNISTIC' | 'MAINTENANCE' | 'NEUTRAL';
export type MarketAvailability = 'AVAILABLE' | 'UNAVAILABLE' | 'UNVERIFIED';
export type PriceBasis = 'PUBLISHED_WHOLESALE' | 'CATALOG_RETAIL_PROXY' | 'MIXED' | 'UNKNOWN';
type Price = { price750: number | null; priceBasis?: PriceBasis; wholesalePrice750?: number | null; retailPrice750?: number | null };
export type AssessmentProduct = Price & {
  itemCode: string; name: string; category: string | null; subtype: string | null;
  liters: number | null; priority: number | null; role: StrategyRole; availability: MarketAvailability;
};
export type AssessmentPurchase = Price & {
  itemCode: string; name: string; category: string | null; subtype: string | null;
  liters: number | null; local: boolean; tenant: boolean;
  bottles30: number; bottles60: number; bottles90: number; orderDates: string[];
};
export type UseEvidence = {
  productCode: string | null; category: string | null; subtype: string | null;
  use: string; kind: 'MENU' | 'BUYER_PLAN' | 'DEMAND' | 'TRIAL' | 'PLACEMENT';
  claim: string; source: string; observedAt: string; exactLocation: boolean; pouredProduct: string | null; status: string | null;
};
export type ContextPeriod = { from: string; through: string; coveredDays: number; bottles: number };
export type SalesCoverage = {
  mode: EvidenceMode; through: string | null; expectedDays: number; completeDays: number;
  identity: 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED' | 'UNAVAILABLE'; missingDates: string[]; verifiedZero: boolean; limitations: string[];
  representedFrom?: string | null; representedDays?: number; transactionDatesKnown?: boolean;
  latestSourceDate?: string | null; contextPeriods?: { latest30: ContextPeriod; previous30: ContextPeriod };
};
export type ResearchFact = { field: string; claim: string; sourceUrl: string; exactLocation: boolean; observedAt?: string };
export type ResearchComparable = Price & Pick<AssessmentPurchase, 'name' | 'category' | 'subtype'> & { itemCode?: string; source: string; observedAt: string; exactLocation: boolean };
export type ResearchSignals = {
  evidence: ResearchFact[];
  publicRatings: Array<{ reviewCount: number | null; rating: number | null; sourceUrl: string; observedAt: string }>;
  comparables: ResearchComparable[];
};
export type AssessmentInput = {
  asOf: string; calculatedAt: string; accountId: string; organizationId: string; name: string;
  suppressed: boolean; closed: boolean; buyerStructure: string | null; nationalChain: boolean | null;
  researchAt: string | null; researchIdentityValid: boolean; researchConfidence: string | null;
  cocktailProgram: string | null; scaleEvidence: string | null; operatingStatus: string | null;
  coverage: SalesCoverage; products: AssessmentProduct[]; purchases: AssessmentPurchase[]; uses: UseEvidence[];
  lastVisitAt: string | null; plannedWork: boolean; researchSignals?: ResearchSignals;
};
// Historical accepted pursuits retain their user-selected product snapshot. New assessments emit no candidates.
export type Candidate = {
  key: string; product: AssessmentProduct; path: GrowthPath; use: string | null; score: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'; effort: Effort; observedCompatible750: number | null;
  estimatedAdditional750: null; contribution: null; upside: string; reasons: string[]; limitations: string[];
  assumptions: string[]; changes: string[]; evidence: UseEvidence[]; components: { potential: number; feasibility: number; strategy: number };
};
export type CommercialMeasures = {
  representedDays: number | null; compatible750: number | null; compatible750Per30: number | null;
  leadingProduct750Per30: number | null; core750Per30: number | null; recurringCore750Per30: number | null;
  compatibleProducts: number; priceBasis: PriceBasis; researchScale: number | null; researchFit: number | null;
};
export type Assessment = {
  version: typeof ASSESSMENT_VERSION; evidenceVersion: typeof EVIDENCE_VERSION; calibrationVersion: typeof CALIBRATION_VERSION;
  rating: number | null; ratingReason: string;
  /** Compatibility storage only: the integer tier. Use rating for nullable contracts. */
  priority: number; band: 'HIGH' | 'MEDIUM' | 'LOW'; state: 'READY' | 'UNRATED' | 'INELIGIBLE';
  evidenceMode: EvidenceMode; effort: Effort; title: string; action: string; coverage: SalesCoverage; commercial: CommercialMeasures;
  observed: { bottles30: number | null; bottles60: number | null; bottles90: number | null; equivalents75090: number | null; tenantShare: number | null; recentChange750: number | null };
  candidates: Candidate[]; reasons: string[]; limitations: string[]; maintenance: string[];
  calculatedAt: string; researchAt: string | null; asOf: string;
};
export const evidenceModeLabel: Record<EvidenceMode, string> = { SALES_BACKED: 'Sales-backed', RESEARCH_ONLY: 'Research-based', PARTIAL_SALES: 'Sales source unavailable' };
export const effortLabel: Record<Effort, string> = { DEDICATED: 'Review commercial opportunity', QUALIFY: 'Review evidence', MENTION: 'Review commercial opportunity', MAINTAIN: 'Support existing business', DO_NOT_PURSUE: 'No proactive selling suggested' };
export const pathLabel: Record<GrowthPath, string> = { CAPTURE: 'Historical capture hypothesis', DEVELOP: 'Historical additional use', DEEPEN: 'Historical existing placement' };
export const ratingLabel = ['Too little compatible business', 'Limited commercial opportunity', 'Modest commercial opportunity', 'Solid commercial opportunity', 'Strong commercial opportunity', 'Exceptional commercial opportunity'] as const;
const DAY = 86_400_000;
const round = (n: number) => Math.round(n * 10) / 10;
const words = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const fresh = (date: string | null | undefined, asOf: string) => Boolean(date && Number.isFinite(Date.parse(date)) && (Date.parse(asOf) - Date.parse(date)) / DAY >= -1 && (Date.parse(asOf) - Date.parse(date)) / DAY <= assessmentPolicy.evidenceFreshDays);
export function positiveResearchClauses(claim: string) {
  return claim.split(/[;,.]|\bbut\b|\b(?:and|with)\s+(?=no|not|without|doesn't|does not|never)/i)
    .map(clause => clause.trim()).filter(clause => clause && !/\b(?:no|not|without|doesn't|does not|never)\b/i.test(clause));
}
const category = (s: { category: string | null; name?: string }) => normalizeOpportunityCategory(s.category, s.name);
const subtype = (s: { subtype: string | null; name?: string; category: string | null }) => {
  if (s.subtype) return words(s.subtype);
  const name = words(s.name);
  if (category(s) === 'RUM') return /\b(?:pineapple|coconut|banana|mango|flavou?red)\b/.test(name) ? name.match(/\b(?:pineapple|coconut|banana|mango|flavou?red)\b/)![0] : /\bspiced\b/.test(name) ? 'spiced' : /\b(?:white|silver|light|blanco|cristal)\b/.test(name) ? 'light' : /\b(?:aged|dark|gold|anejo|añejo)\b/.test(name) ? 'aged' : null;
  if (category(s) === 'VODKA') return /\b(?:vanilla|orange|lemon|berry|flavou?red)\b/.test(name) ? 'flavored' : 'plain';
  if (category(s) === 'TEQUILA') return /\b(?:reposado|anejo|añejo|blanco|silver|gold)\b/.exec(name)?.[0]?.replace('silver', 'blanco') ?? null;
  if (category(s) === 'SCOTCH') return /single malt/.test(name) ? 'single malt' : /blend/.test(name) ? 'blended' : null;
  if (category(s) === 'WHISKEY') return /\b(?:corn|wheat|malt)\b/.exec(name)?.[0] ?? null;
  return null;
};
export function compatibleStyle(product: AssessmentProduct, purchase: Pick<AssessmentPurchase, 'category' | 'name' | 'subtype'> & { itemCode?: string }) {
  const lane = category(product);
  if (!lane || lane !== category(purchase)) return false;
  // Exact catalog identity establishes style even when a separate style attribute
  // is absent; this is the same rule for current tenant and other purchases.
  if (purchase.itemCode && product.itemCode === purchase.itemCode) return true;
  if (/\brtd\b|ready.to.drink|cocktail/i.test(product.name + ' ' + purchase.name) && (!product.subtype || product.subtype !== purchase.subtype)) return false;
  const flavor = (name: string) => /\b(?:honey|cinnamon|apple|peach|maple|peanut butter|cherry|vanilla|coffee|flavou?red)\b/i.exec(name)?.[0]?.toLowerCase() ?? null;
  if (['BOURBON','RYE','WHISKEY','SCOTCH','IRISH','CANADIAN'].includes(lane) && flavor(product.name) !== flavor(purchase.name)) return false;
  const a = subtype(product), b = subtype(purchase);
  if (['CORDIAL', 'RUM', 'WHISKEY', 'SCOTCH'].includes(lane)) return Boolean(a && b && a === b);
  return !a || !b || a === b;
}
function comparablePrices(a: Price, b: Price): { tenant: number; observed: number; basis: PriceBasis } | null {
  if ((a.wholesalePrice750 ?? 0) > 0 && (b.wholesalePrice750 ?? 0) > 0) return { tenant: a.wholesalePrice750!, observed: b.wholesalePrice750!, basis: 'PUBLISHED_WHOLESALE' };
  if ((a.retailPrice750 ?? 0) > 0 && (b.retailPrice750 ?? 0) > 0) return { tenant: a.retailPrice750!, observed: b.retailPrice750!, basis: 'CATALOG_RETAIL_PROXY' };
  if ((a.price750 ?? 0) > 0 && (b.price750 ?? 0) > 0 && (a.priceBasis ?? 'CATALOG_RETAIL_PROXY') === (b.priceBasis ?? 'CATALOG_RETAIL_PROXY')) return { tenant: a.price750!, observed: b.price750!, basis: a.priceBasis ?? 'CATALOG_RETAIL_PROXY' };
  return null;
}
export function priceCompatible(a: Price, b: Price) {
  const prices = comparablePrices(a, b);
  if (!prices) return null;
  const ratio = prices.tenant / prices.observed;
  return { compatible: ratio >= assessmentPolicy.tenantToObservedPriceMin && ratio <= assessmentPolicy.tenantToObservedPriceMax, basis: prices.basis, ratio };
}
const equivalents = (p: AssessmentPurchase, field: 'bottles30' | 'bottles60' | 'bottles90') => p.liters === null || p.liters <= 0 ? 0 : Math.max(0, p[field]) * p.liters / .75;
const combinedBasis = (bases: PriceBasis[]): PriceBasis => !bases.length ? 'UNKNOWN' : new Set(bases).size === 1 ? bases[0] : 'MIXED';
function complete(result: Assessment, rating: number, reason: string): Assessment {
  result.rating = rating; result.priority = rating; result.ratingReason = reason; result.state = 'READY';
  result.band = rating >= 4 ? 'HIGH' : rating >= 2 ? 'MEDIUM' : 'LOW'; result.title = ratingLabel[rating];
  result.effort = rating >= 3 ? 'DEDICATED' : 'DO_NOT_PURSUE';
  result.action = rating >= 3 ? 'Review this account’s commercial evidence.' : 'No automatic prospecting work suggested.';
  return result;
}
export function assessWholesaleAccount(input: AssessmentInput): Assessment {
  const sales = input.coverage.mode !== 'RESEARCH_ONLY', days = input.coverage.representedDays ?? input.coverage.expectedDays;
  const sum = (field: 'bottles30' | 'bottles60' | 'bottles90') => input.purchases.reduce((n, p) => n + p[field], 0);
  const total750 = input.purchases.reduce((n, p) => n + equivalents(p, 'bottles90'), 0);
  const tenant750 = input.purchases.filter(p => p.tenant).reduce((n, p) => n + equivalents(p, 'bottles90'), 0);
  const missingSizes = input.purchases.some(p => p.liters === null || p.liters <= 0);
  const result: Assessment = {
    version: ASSESSMENT_VERSION, evidenceVersion: EVIDENCE_VERSION, calibrationVersion: CALIBRATION_VERSION,
    rating: null, ratingReason: 'Insufficient commercial evidence.', priority: 0, band: 'LOW', state: 'UNRATED', evidenceMode: input.coverage.mode,
    effort: 'QUALIFY', title: 'Commercial opportunity unrated', action: 'Review missing commercial evidence.', coverage: input.coverage,
    commercial: { representedDays: sales ? days : null, compatible750: null, compatible750Per30: null, leadingProduct750Per30: null, core750Per30: null, recurringCore750Per30: null, compatibleProducts: 0, priceBasis: 'UNKNOWN', researchScale: null, researchFit: null },
    observed: { bottles30: sales ? sum('bottles30') : null, bottles60: sales ? sum('bottles60') : null, bottles90: sales ? sum('bottles90') : null,
      equivalents75090: sales && !missingSizes ? round(total750) : null, tenantShare: sales && total750 && !missingSizes ? round(100 * tenant750 / total750) : null,
      recentChange750: sales && days >= 60 && !missingSizes ? round(input.purchases.reduce((n,p) => n + 2 * equivalents(p, 'bottles30') - equivalents(p, 'bottles60'), 0)) : null },
    candidates: [], reasons: [], limitations: [...input.coverage.limitations],
    maintenance: tenant750 > 0 ? ['Existing tenant purchasing counts fully; normal customer service remains available.'] : [],
    calculatedAt: input.calculatedAt, researchAt: input.researchAt, asOf: input.asOf,
  };
  if (input.closed) return { ...result, state: 'INELIGIBLE', ratingReason: 'Account is closed or ineligible.', title: 'Account ineligible', effort: 'DO_NOT_PURSUE', action: 'Review account eligibility.' };
  if (!input.products.length) return { ...result, ratingReason: 'No included portfolio for this market.' };
  if (!sales) return assessResearch(input, result);
  if (input.coverage.mode === 'PARTIAL_SALES' || days <= 0 || days > 90 || input.coverage.completeDays < days) return { ...result, ratingReason: 'The represented sales period is unavailable or failed; preserve the last valid assessment.' };
  if (missingSizes) result.limitations.push('Some purchases lack bottle sizes; their quantities are preserved but cannot be normalized.');
  const streams: Array<{ monthly: number; recurring: boolean; basis: PriceBasis }> = [];
  let missingAttributes = 0;
  for (const purchase of input.purchases.filter(p => p.bottles90 > 0)) {
    const relevant = input.products.filter(p => compatibleStyle(p, purchase));
    const comparisons = relevant.map(p => priceCompatible(p, purchase)), match = comparisons.find(p => p?.compatible);
    if (match && purchase.liters !== null && purchase.liters > 0) {
      const dates = [...new Set(purchase.orderDates.filter(d => d <= (input.coverage.through ?? input.asOf) && (!input.coverage.representedFrom || d >= input.coverage.representedFrom)))].sort();
      streams.push({ monthly: equivalents(purchase, 'bottles90') * 30 / days, recurring: dates.length >= 2 && Date.parse(dates.at(-1)!) - Date.parse(dates[0]) >= 7 * DAY, basis: match.basis });
    } else if ((!category(purchase) || relevant.length && (comparisons.every(p => p === null) || purchase.liters === null)) || input.products.some(p => category(p) === category(purchase) && (!subtype(purchase) || !subtype(p)) && ['RUM','CORDIAL','SCOTCH','WHISKEY'].includes(category(p)!))) missingAttributes++;
  }
  const compatible = streams.reduce((n,p) => n + p.monthly, 0), core = streams.filter(p => p.monthly >= assessmentPolicy.meaningfulProduct750Per30);
  const coreVolume = core.reduce((n,p) => n + p.monthly, 0), recurring = core.filter(p => p.recurring).reduce((n,p) => n + p.monthly, 0), leading = Math.max(0, ...streams.map(p => p.monthly));
  result.commercial = { ...result.commercial, compatible750: round(compatible * days / 30), compatible750Per30: round(compatible), leadingProduct750Per30: round(leading), core750Per30: round(coreVolume), recurringCore750Per30: round(recurring), compatibleProducts: streams.length, priceBasis: combinedBasis(streams.map(p => p.basis)) };
  if (missingAttributes) result.limitations.push(missingAttributes + ' purchased product(s) lack essential style, price or size attributes; recorded quantities remain authoritative but are excluded from comparable depth.');
  if (!streams.length && missingAttributes) return { ...result, ratingReason: 'Essential product or price attributes are missing; zero commercial opportunity is not established.' };
  let rating = 0;
  for (const tier of assessmentPolicy.tiers) {
    // Very deep single orders retain their commercial significance without pretending they establish reorders.
    const persistence = !tier.recurring || recurring >= tier.recurring || leading >= tier.core * 2;
    if (leading >= tier.leading && coreVolume >= tier.core && persistence) rating = tier.rating;
  }
  if (rating === 0 && missingAttributes) return { ...result, ratingReason: 'Missing product or price attributes could change the minimum commercial tier; zero is not established.' };
  result.reasons = [rating === 0 ? 'Too little meaningful purchasing at price levels compatible with your portfolio.'
    : rating <= 2 ? (rating === 1 ? 'Limited' : 'Modest') + ' purchasing depth at price levels compatible with your portfolio.'
      : recurring > 0 ? 'Substantial recurring purchasing at price levels compatible with your portfolio.'
        : 'Substantial compatible purchasing depth; repeat purchasing is not established.'];
  result.limitations.push('Purchases describe this represented period, not measured consumption, annual demand or attainable tenant revenue.');
  if (days < 30) result.limitations.push('The ' + days + '-day represented window is normalized to 30 days; short-window rates are more sensitive to individual orders.');
  return complete(result, rating, rating === 0 ? 'Compatible purchasing does not meet the minimum absolute product-depth and core-volume floor.' : 'Price-compatible product depth and absolute core volume support this commercial tier.');
}
function assessResearch(input: AssessmentInput, result: Assessment): Assessment {
  if (!input.researchIdentityValid || !fresh(input.researchAt, input.calculatedAt)) return { ...result, ratingReason: 'Current exact-location research is missing, stale or mismatched.' };
  const signals = input.researchSignals;
  const currentClaim = (claim: string) => !/\b(?:formerly|previously|historical|used to)\b/i.test(claim) && ![...claim.matchAll(/\bin (20\d\d)\b/gi)].some(m => Number(m[1]) < new Date(input.calculatedAt).getUTCFullYear());
  const facts = (signals?.evidence ?? []).filter(e => e.exactLocation && e.sourceUrl && fresh(e.observedAt ?? input.researchAt, input.calculatedAt) && currentClaim(e.claim));
  const text = facts.map(e => e.field + ': ' + e.claim).join('\n').toLowerCase();
  if (/\b(?:does not serve|no|without) (?:alcohol|spirits|liquor)\b|\b(?:dry venue|beer.and.wine.only)\b/.test(text)) return complete(result, 0, 'Current sourced research confirms no applicable spirits program.');
  const beverage = /\b(?:cocktail|spirits|liquor|full bar|backbar|whisk(?:e)?y|rum|vodka|gin|tequila)\b/.test(text);
  const comparables = (signals?.comparables ?? []).filter(e => e.exactLocation && e.source && fresh(e.observedAt, input.calculatedAt));
  const matches = comparables.flatMap(c => input.products.filter(p => compatibleStyle(p,c)).map(p => ({ c, fit: priceCompatible(p,c) }))).filter(x => x.fit !== null);
  if (!matches.length) return { ...result, ratingReason: 'Essential category/style and price-fit evidence is missing.', limitations: [...result.limitations, 'Drink prices, local ownership and generic craft mentions do not establish comparable bottle positioning.'] };
  const compatible = matches.filter(x => x.fit!.compatible);
  const positiveFacts = facts.flatMap(e => positiveResearchClauses(e.claim).map(claim => ({ ...e, claim, originalClaim: e.claim })));
  const relevantProgram = positiveFacts.some(e => /\b(?:dedicated|extensive|signature|specializ\w*|central|core|featured|focused)\b/i.test(e.claim)
    && compatible.some(x => { const lane = category(x.c); return Boolean(lane && new RegExp('\\b' + lane + '\\b', 'i').test(e.claim)); }));
  const distinctCompatible = new Set(compatible.map(x => x.c.name.toLowerCase())).size;
  const fit = !compatible.length ? 0 : relevantProgram ? 5 : distinctCompatible >= 2 ? 4 : 2;
  result.commercial.researchFit = fit; result.commercial.priceBasis = combinedBasis(matches.map(x => x.fit!.basis));
  if (!fit) return complete(result, 0, 'Documented relevant menu products are materially incompatible with this portfolio’s price positioning.');
  if (!beverage) return { ...result, ratingReason: 'The evidence does not establish an active spirits/beverage business.' };
  const publicRatings = (signals?.publicRatings ?? []).filter(r => r.sourceUrl && fresh(r.observedAt, input.calculatedAt));
  const reviews = Math.max(0, ...publicRatings.map(r => r.reviewCount ?? 0));
  const positive = positiveFacts.map(e => e.claim.toLowerCase()).join('\n');
  const locationSeats = positiveFacts.flatMap(e => {
    // An exact-location page can still describe a group's total capacity. In a
    // group/chain sentence count only a directly scoped individual-location figure.
    const expression = /\b(?:group|chain|across|combined|locations|venues)\b/i.test(e.originalClaim)
      ? /\b(?:this|individual|single) (?:location|venue|bar|restaurant|site)\s+(?:has|offers|provides|accommodates|seats|holds|supports)\s+(?:up to\s+)?([\d,]+)\s*(?:seats?|people|guests)\b/gi
      : /\b([\d,]+)\s*(?:seats?|seat dining|person capacity)\b/gi;
    return [...e.claim.matchAll(expression)].map(m => Number(m[1].replaceAll(',','')));
  });
  const seats = Math.max(0, ...locationSeats);
  const recentActivity = /\b(?:recent reviews?|reviews? (?:this|last) (?:month|week)|active (?:weekly|daily)|weekly (?:events|live)|daily (?:service|happy hour))\b/.test(positive);
  const occasions = /\b(?:private dining|private events|banquet|reservations?|dinner service|lunch and dinner|brunch|patio|outdoor dining)\b/.test(positive);
  const spiritsLed = /\b(?:cocktail bar|spirits.focused|extensive (?:cocktail|spirits)|dedicated cocktail|cocktails? (?:are|is) (?:central|a core)|full cocktail menu)\b/.test(positive);
  const groupSupport = /\b(?:successful|established) (?:restaurant )?(?:group|chain)\b/.test(positive);
  if (!(reviews > 0 || seats > 0 || recentActivity)) return { ...result, ratingReason: 'Research establishes fit but lacks location-specific business-scale evidence.' };
  let scale = reviews >= 1000 || seats >= 200 ? 4 : reviews >= 300 || seats >= 100 ? 3 : reviews >= 75 || seats >= 40 ? 2 : 1;
  if (scale === 4 && spiritsLed && recentActivity && (occasions || groupSupport) && (reviews >= 1500 || seats >= 300)) scale = 5;
  if (scale >= 4 && !spiritsLed) scale = 3;
  const mostReviewed = [...publicRatings].sort((a,b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0))[0];
  if (scale === 5 && mostReviewed?.rating !== null && mostReviewed?.rating !== undefined && mostReviewed.rating < 3) scale = 4;
  result.commercial.researchScale = scale;
  result.reasons = ['Saved exact-location research supports a ' + ['','limited','modest','solid','strong','exceptional'][scale] + ' spirits-business scale tier.', 'Documented menu products establish relevant style and price positioning for this portfolio.'];
  result.limitations.push('Research establishes a qualitative tier: reviews are not customers, drink prices are not bottle costs, and precise purchase volume is not inferred.');
  return complete(result, Math.min(scale, fit), 'Sourced location-scale evidence and relevant bottle-price positioning support this research-based tier.');
}
export function readAssessment(value: unknown): Assessment | null {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== ASSESSMENT_VERSION) return null;
  const candidate = value as Assessment;
  if (candidate.rating !== null && (!Number.isInteger(candidate.rating) || candidate.rating < 0 || candidate.rating > 5)) return null;
  return candidate;
}
