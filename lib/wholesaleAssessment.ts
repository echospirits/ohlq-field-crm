import { normalizeOpportunityCategory, nationalChainNamePatterns } from './opportunityConfig';

export const ASSESSMENT_VERSION = 'WHOLESALE_ASSESSMENT_V1';
export const EVIDENCE_VERSION = 'WHOLESALE_EVIDENCE_V1';
export const assessmentPolicy = {
  horizonDays: 90, researchFreshDays: 180, evidenceFreshDays: 180,
  highPriority: 70, mediumPriority: 40, minimumCapture750: 6,
  volumeScale750: 120, strategyMin: .8, strategyMax: 1.2,
  priceRatioMin: .75, priceRatioMax: 1.75,
} as const;
export type EvidenceMode = 'SALES_BACKED' | 'RESEARCH_ONLY' | 'PARTIAL_SALES';
export type GrowthPath = 'CAPTURE' | 'DEVELOP' | 'DEEPEN';
export type Effort = 'DEDICATED' | 'QUALIFY' | 'MENTION' | 'MAINTAIN' | 'DO_NOT_PURSUE';
export type StrategyRole = 'FOCUS' | 'OPPORTUNISTIC' | 'MAINTENANCE' | 'NEUTRAL';
export type MarketAvailability = 'AVAILABLE' | 'UNAVAILABLE' | 'UNVERIFIED';
export type AssessmentProduct = {
  itemCode: string; name: string; category: string | null; subtype: string | null;
  price750: number | null; liters: number | null; priority: number | null;
  role: StrategyRole; availability: MarketAvailability;
};
export type AssessmentPurchase = {
  itemCode: string; name: string; category: string | null; subtype: string | null;
  price750: number | null; liters: number | null; local: boolean; tenant: boolean;
  bottles30: number; bottles60: number; bottles90: number; orderDates: string[];
};
export type UseEvidence = {
  productCode: string | null; category: string | null; subtype: string | null;
  use: string; kind: 'MENU' | 'BUYER_PLAN' | 'DEMAND' | 'TRIAL' | 'PLACEMENT';
  claim: string; source: string; observedAt: string; exactLocation: boolean;
  pouredProduct: string | null; status: string | null;
};
export type SalesCoverage = {
  mode: EvidenceMode; through: string | null; expectedDays: number; completeDays: number;
  identity: 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED' | 'UNAVAILABLE';
  missingDates: string[]; verifiedZero: boolean; limitations: string[];
};
export type AssessmentInput = {
  asOf: string; calculatedAt: string; accountId: string; organizationId: string;
  name: string; suppressed: boolean; closed: boolean; buyerStructure: string | null;
  nationalChain: boolean | null; researchAt: string | null; researchIdentityValid: boolean;
  researchConfidence: string | null; cocktailProgram: string | null;
  scaleEvidence: string | null; operatingStatus: string | null;
  coverage: SalesCoverage; products: AssessmentProduct[]; purchases: AssessmentPurchase[];
  uses: UseEvidence[]; lastVisitAt: string | null; plannedWork: boolean;
};
export type Candidate = {
  key: string; product: AssessmentProduct; path: GrowthPath; use: string | null;
  score: number; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; effort: Effort;
  observedCompatible750: number | null; estimatedAdditional750: null; contribution: null;
  upside: string; reasons: string[]; limitations: string[]; assumptions: string[];
  changes: string[]; evidence: UseEvidence[]; components: { potential: number; feasibility: number; strategy: number };
};
export type Assessment = {
  version: typeof ASSESSMENT_VERSION; evidenceVersion: typeof EVIDENCE_VERSION;
  priority: number; band: 'HIGH' | 'MEDIUM' | 'LOW'; state: 'READY' | 'NEEDS_QUALIFICATION' | 'SUPPRESSED' | 'INELIGIBLE';
  evidenceMode: EvidenceMode; effort: Effort; title: string; action: string;
  coverage: SalesCoverage; observed: { bottles30: number | null; bottles60: number | null; bottles90: number | null; equivalents75090: number | null; tenantShare: number | null; recentChange750: number | null };
  candidates: Candidate[]; reasons: string[]; limitations: string[]; maintenance: string[];
  calculatedAt: string; researchAt: string | null; asOf: string;
};
export const evidenceModeLabel: Record<EvidenceMode, string> = { SALES_BACKED: 'Sales-backed', RESEARCH_ONLY: 'Research-based', PARTIAL_SALES: 'Partial sales coverage' };
export const effortLabel: Record<Effort, string> = { DEDICATED: 'Prioritize a dedicated sales action', QUALIFY: 'Qualify this opportunity', MENTION: 'Mention during a planned visit', MAINTAIN: 'Maintain/support existing business', DO_NOT_PURSUE: 'Do not pursue' };
export const pathLabel: Record<GrowthPath, string> = { CAPTURE: 'Capture existing demand', DEVELOP: 'Develop an additional use', DEEPEN: 'Deepen an existing placement' };
const DAY = 86_400_000;
const round = (n: number) => Math.round(n * 10) / 10;
const age = (date: string, asOf: string) => (Date.parse(asOf) - Date.parse(date)) / DAY;
const words = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const category = (s: { category: string | null; name?: string }) => normalizeOpportunityCategory(s.category, s.name);
const subtype = (s: { subtype: string | null; name?: string; category: string | null }) => {
  if (s.subtype) return words(s.subtype);
  const name = words(s.name);
  if (category(s) === 'RUM') return /\b(?:pineapple|coconut|banana|mango|flavou?red)\b/.test(name) ? name.match(/\b(?:pineapple|coconut|banana|mango|flavou?red)\b/)![0] : /\bspiced\b/.test(name) ? 'spiced' : /\b(?:white|silver|light)\b/.test(name) ? 'light' : /\b(?:aged|dark|gold)\b/.test(name) ? 'aged' : null;
  if (category(s) === 'VODKA') return /\b(?:vanilla|orange|lemon|berry|flavou?red)\b/.test(name) ? 'flavored' : 'plain';
  return null;
};
export function compatibleStyle(product: AssessmentProduct, purchase: Pick<AssessmentPurchase, 'category' | 'name' | 'subtype'>) {
  if (!category(product) || category(product) !== category(purchase)) return false;
  // Premixed drinks are not substitutes for base spirits, even when catalogued together.
  if (/\brtd\b|ready.to.drink|cocktail/i.test(`${product.name} ${purchase.name}`) && (!product.subtype || product.subtype !== purchase.subtype)) return false;
  const a = subtype(product), b = subtype(purchase);
  // Liqueurs and rum require actual style evidence, never broad-category substitution.
  if (['CORDIAL', 'RUM'].includes(category(product)!)) return Boolean(a && b && a === b);
  return !a || !b || a === b;
}
export function strategyMultiplier(product: Pick<AssessmentProduct, 'role' | 'priority'>) {
  const role = product.role === 'FOCUS' ? 1.12 : product.role === 'MAINTENANCE' ? .8 : 1;
  const priority = product.priority === null ? 1 : 1 + Math.max(0, Math.min(.09, (product.priority - 1) * .01));
  return Math.max(assessmentPolicy.strategyMin, Math.min(assessmentPolicy.strategyMax, role * priority));
}
export function volumePotential(equivalents750: number) {
  return 100 * Math.max(0, equivalents750) / (Math.max(0, equivalents750) + assessmentPolicy.volumeScale750);
}
const equivalents = (p: AssessmentPurchase, field: 'bottles30' | 'bottles60' | 'bottles90') => p.liters === null ? 0 : p[field] * p.liters / .75;
export function assessWholesaleAccount(input: AssessmentInput): Assessment {
  const sales = input.coverage.mode !== 'RESEARCH_ONLY';
  const sum = (field: 'bottles30' | 'bottles60' | 'bottles90') => input.purchases.reduce((n, p) => n + p[field], 0);
  const total750 = input.purchases.reduce((n, p) => n + equivalents(p, 'bottles90'), 0);
  const tenant750 = input.purchases.filter(p => p.tenant).reduce((n, p) => n + equivalents(p, 'bottles90'), 0);
  const missingSizes = input.purchases.some(p => p.liters === null);
  const researchFresh = input.researchIdentityValid && Boolean(input.researchAt && age(input.researchAt, input.calculatedAt) >= -1 && age(input.researchAt, input.calculatedAt) <= assessmentPolicy.researchFreshDays);
  const currentUses = input.uses.filter(e => e.exactLocation && e.source && age(e.observedAt, input.calculatedAt) >= -1 && age(e.observedAt, input.calculatedAt) <= assessmentPolicy.evidenceFreshDays);
  const restricted = input.nationalChain === true || (input.nationalChain !== false && nationalChainNamePatterns.some(p => words(input.name).includes(p))) || /central|contract|restricted/i.test(input.buyerStructure ?? '');
  const localBuyer = !restricted && /local|owner|independent|on.?site/i.test(input.buyerStructure ?? '');
  const maintenance = tenant750 > 0 ? [input.purchases.filter(p => p.tenant).every(p => p.bottles30 === 0) ? 'Check reorder needs: no observed tenant purchases in the latest 30 days.' : 'Support existing tenant business.'] : [];
  if (tenant750 > 0 && (!input.lastVisitAt || age(input.lastVisitAt, input.calculatedAt) >= 45)) maintenance.push('Relationship follow-up is due; this does not increase growth upside.');
  const result: Assessment = {
    version: ASSESSMENT_VERSION, evidenceVersion: EVIDENCE_VERSION, priority: 0, band: 'LOW',
    state: 'NEEDS_QUALIFICATION', evidenceMode: input.coverage.mode, effort: maintenance.length ? 'MAINTAIN' : 'QUALIFY',
    title: 'Needs qualification/research', action: 'Confirm a product use, buyer access and current location evidence.',
    coverage: input.coverage, observed: { bottles30: sales ? sum('bottles30') : null, bottles60: sales ? sum('bottles60') : null, bottles90: sales ? sum('bottles90') : null,
      equivalents75090: sales && !missingSizes ? round(total750) : null, tenantShare: sales && total750 && !missingSizes ? round(100 * tenant750 / total750) : null,
      recentChange750: input.coverage.completeDays === 90 && !missingSizes ? round(input.purchases.reduce((n,p) => n + 2 * equivalents(p, 'bottles30') - equivalents(p, 'bottles60'), 0)) : null },
    candidates: [], reasons: [], limitations: [...input.coverage.limitations], maintenance,
    calculatedAt: input.calculatedAt, researchAt: input.researchAt, asOf: input.asOf,
  };
  if (!researchFresh) result.limitations.push('Current exact-location research is missing, stale or no longer matches this address.');
  if (missingSizes) result.limitations.push('Some bottle sizes are unknown; their normalized volumes are not inferred.');
  if (input.suppressed || input.closed) {
    return { ...result, state: input.suppressed ? 'SUPPRESSED' : 'INELIGIBLE', effort: 'DO_NOT_PURSUE', title: input.closed ? 'Account reported closed' : 'Pursuit suppressed', action: 'Review account eligibility before pursuing.', reasons: ['Current tenant/account eligibility prevents pursuit.'] };
  }
  for (const product of input.products.filter(p => p.availability !== 'UNAVAILABLE' && (p.priority === null || p.priority > 0))) {
    const uses = currentUses.filter(e => e.productCode === product.itemCode || (!e.productCode && compatibleStyle(product, { category: e.category, subtype: e.subtype, name: e.use })));
    const existing = input.purchases.filter(p => p.tenant && p.itemCode === product.itemCode && p.bottles90 > 0);
    const relevant = input.purchases.filter(p => !p.tenant && p.bottles90 > 0 && compatibleStyle(product, p));
    const priced = relevant.filter(p => p.price750 !== null && product.price750 !== null && p.price750 >= product.price750 * assessmentPolicy.priceRatioMin && p.price750 <= product.price750 * assessmentPolicy.priceRatioMax);
    const protected750 = priced.filter(p => p.local).reduce((n,p) => n + equivalents(p, 'bottles90'), 0);
    const compatible = priced.filter(p => !p.local);
    const compatible750 = compatible.reduce((n,p) => n + equivalents(p, 'bottles90'), 0);
    const development = uses.filter(e => ['BUYER_PLAN', 'DEMAND', 'TRIAL'].includes(e.kind));
    const paths: GrowthPath[] = [];
    if (existing.length && uses.length) paths.push('DEEPEN');
    if (development.length || (!sales && researchFresh && uses.length)) paths.push('DEVELOP');
    if (sales && compatible750 >= assessmentPolicy.minimumCapture750 && protected750 < 1) paths.push('CAPTURE');
    for (const path of paths) {
      const limitations: string[] = [];
      const reasons: string[] = [];
      const assumptions = ['Initial deterministic attention heuristic; not a probability, measured demand or dollar forecast.'];
      const observed = path === 'CAPTURE' ? compatible750 : path === 'DEEPEN' ? existing.reduce((n,p) => n + equivalents(p, 'bottles90'), 0) : null;
      const supportedExpansion = development.length > 0;
      const strongResearch = researchFresh && input.researchConfidence === 'HIGH' && input.operatingStatus === 'Open';
      const potential = path === 'CAPTURE' ? volumePotential(compatible750)
        : Math.min(100, (supportedExpansion ? 65 : 40) + (input.scaleEvidence && researchFresh ? 15 : 0) + (strongResearch && input.cocktailProgram === 'Strong' ? 15 : 0));
      const dates = new Set(compatible.flatMap(p => p.orderDates));
      const continuity = path !== 'CAPTURE' || dates.size >= 3 ? 1 : .85;
      const feasibility = (localBuyer ? 1 : .8) * continuity * (restricted ? .25 : 1);
      const strategy = strategyMultiplier(product);
      let score = Math.min(100, potential * feasibility * strategy);
      if (restricted) score = Math.min(score, 20);
      if (input.coverage.mode === 'PARTIAL_SALES' && path === 'CAPTURE') score = Math.min(score, 65);
      if (!strongResearch && path !== 'CAPTURE') score = Math.min(score, 60);
      if (product.role === 'MAINTENANCE') score = Math.min(score, 39);
      const confidence = path === 'CAPTURE' ? input.coverage.mode === 'SALES_BACKED' && dates.size >= 3 ? 'HIGH' : 'MEDIUM' : strongResearch && supportedExpansion ? 'HIGH' : 'MEDIUM';
      if (product.availability === 'UNVERIFIED') limitations.push('Distribution availability is unverified; confirm market access before proposing supply.');
      if (!localBuyer) limitations.push(restricted ? 'Restricted/centralized buying policy limits attention; establish an approved buying route.' : 'Local buyer access is unconfirmed.');
      if (protected750 > 0) limitations.push('Protected local incumbent: additional-use development only; no displacement claim.');
      if (path === 'CAPTURE') {
        reasons.push(`${round(compatible750)} compatible non-local 750 ml equivalents purchased in 90 days; ${dates.size} distinct purchase dates.`);
        reasons.push('Catalog style and price support a capture hypothesis; confirm the actual pour and switching feasibility.');
        assumptions.push('Existing compatible purchases indicate a possible purchasing stream, not an attainable capture quantity.');
      } else {
        reasons.push(uses[0]?.claim ?? 'Existing product use is recorded.');
        reasons.push(path === 'DEEPEN' ? 'Build on an existing tenant purchase/placement with a supported use.' : 'A supported additional use merits discovery; current category purchases do not set its ceiling.');
        limitations.push('Additional volume is unquantified; menu presence alone does not establish popularity.');
      }
      if (input.scaleEvidence && researchFresh) reasons.push(`Venue context: ${input.scaleEvidence} (not measured spirits volume).`);
      const effort: Effort = product.role === 'MAINTENANCE' ? 'MAINTAIN' : product.availability !== 'AVAILABLE' || !localBuyer || input.coverage.mode === 'PARTIAL_SALES' || confidence !== 'HIGH' ? 'QUALIFY' : score >= 70 ? 'DEDICATED' : score < 40 && input.plannedWork ? 'MENTION' : 'QUALIFY';
      result.candidates.push({ key: `${product.itemCode}:${path}:${uses[0]?.use ?? 'category'}`, product, path, use: uses[0]?.use ?? null, score: round(score), confidence, effort,
        observedCompatible750: observed === null ? null : round(observed), estimatedAdditional750: null, contribution: null,
        upside: path === 'CAPTURE' ? 'Observed compatible stream; attainable additional volume unquantified' : 'Supported use hypothesis; additional volume unquantified',
        reasons, limitations, assumptions, changes: ['Confirm buyer access, actual poured product, trial/reorder evidence and distribution.', 'Record a supported quantity and capture assumptions before estimating upside.'], evidence: uses, components: { potential: round(potential), feasibility: round(feasibility), strategy: round(strategy) } });
    }
  }
  result.candidates.sort((a,b) => b.score - a.score || a.key.localeCompare(b.key));
  result.candidates = result.candidates.slice(0, 3);
  const best = result.candidates[0];
  if (best) {
    result.priority = best.score; result.band = best.score >= 70 ? 'HIGH' : best.score >= 40 ? 'MEDIUM' : 'LOW';
    result.state = 'READY'; result.effort = best.effort;
    result.title = `${best.product.name}${best.use ? ` · ${best.use}` : ''}`;
    result.action = `${effortLabel[best.effort]}: ${pathLabel[best.path].toLowerCase()}.`;
    result.reasons = best.reasons; result.limitations.push(...best.limitations);
  } else result.reasons.push('No sufficiently supported product/use candidate. Low or absent category purchases alone are not evidence of untapped demand.');
  return result;
}

export function readAssessment(value: unknown): Assessment | null {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== ASSESSMENT_VERSION) return null;
  return value as Assessment;
}
