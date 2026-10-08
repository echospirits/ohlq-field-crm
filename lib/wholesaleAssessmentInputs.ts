import type { OrganizationProduct, OhlqBrandMasterItem } from '@prisma/client';
import { catalogLiters, isKnownOhioBrand, pricePer750 } from './opportunityAffinity';
import { normalizeOpportunityCategory } from './opportunityConfig';
import { isOpportunityEligibleOhlqProduct } from './ohlqProductEligibility';
import { normalizeUsState } from './usStates';
import type { AssessmentProduct, AssessmentPurchase, StrategyRole, UseEvidence } from './wholesaleAssessment';

export function marketPortfolio(decisions: OrganizationProduct[], catalog: Map<string, OhlqBrandMasterItem>, state: string | null,
  inventory: { trusted: boolean; available: Set<string>; distilleryOnly: Set<string> }): AssessmentProduct[] {
  const market = normalizeUsState(state);
  const codes = [...new Set(decisions.map(p => p.externalItemCode))];
  return codes.flatMap(code => {
    const exact = decisions.find(p => p.externalItemCode === code && p.market === market);
    const decision = exact ?? decisions.find(p => p.externalItemCode === code && p.market === 'ALL') ?? decisions.find(p => p.externalItemCode === code && p.active && !p.discontinued && ['OWNED', 'REPRESENTED'].includes(p.status));
    if (!decision || !decision.active || decision.discontinued || !['OWNED', 'REPRESENTED'].includes(decision.status)) return [];
    const master = catalog.get(code);
    if (market === 'OH' && master && !isOpportunityEligibleOhlqProduct(master, inventory.distilleryOnly)) return [];
    const availability = decision.distributionStatus === 'UNAVAILABLE' && (exact || decision.market === 'ALL') ? 'UNAVAILABLE'
      : decision.distributionStatus === 'AVAILABLE' && (exact || decision.market === 'ALL') ? 'AVAILABLE'
      : market === 'OH' && inventory.trusted ? inventory.available.has(code) ? 'AVAILABLE' : 'UNAVAILABLE' : 'UNVERIFIED';
    return [{ itemCode: code, name: decision.displayName ?? master?.name ?? code, category: normalizeOpportunityCategory(master?.category ?? decision.category, master?.name ?? decision.displayName),
      subtype: decision.subcategory, price750: master ? pricePer750(master.retailPrice, master.productVolume) : null,
      liters: master ? catalogLiters(master.productVolume) : null, priority: decision.strategicPriority,
      role: ['FOCUS','OPPORTUNISTIC','MAINTENANCE'].includes(decision.opportunityRole ?? '') ? decision.opportunityRole as StrategyRole : 'NEUTRAL', availability }];
  });
}

export function aggregatePurchases(events: Array<{ itemCode: string; itemName: string; category: string | null; bottles: number; reportDate: Date }>,
  catalog: Map<string, OhlqBrandMasterItem>, tenantCodes: Set<string>, asOf: Date): AssessmentPurchase[] {
  const purchases = new Map<string, AssessmentPurchase>();
  for (const event of events) {
    const days = Math.round((asOf.getTime() - event.reportDate.getTime()) / 86_400_000);
    if (days < 0 || days >= 90) continue;
    const master = catalog.get(event.itemCode);
    let purchase = purchases.get(event.itemCode);
    if (!purchase) {
      purchase = { itemCode: event.itemCode, name: master?.name ?? event.itemName,
        category: normalizeOpportunityCategory(master?.category ?? event.category, master?.name ?? event.itemName), subtype: null,
        price750: master ? pricePer750(master.retailPrice, master.productVolume) : null, liters: master ? catalogLiters(master.productVolume) : null,
        local: isKnownOhioBrand(master?.name ?? event.itemName), tenant: tenantCodes.has(event.itemCode), bottles30: 0, bottles60: 0, bottles90: 0, orderDates: [] };
      purchases.set(event.itemCode, purchase);
    }
    purchase.bottles90 += event.bottles;
    if (days < 60) purchase.bottles60 += event.bottles;
    if (days < 30) purchase.bottles30 += event.bottles;
    const date = event.reportDate.toISOString().slice(0,10);
    if (!purchase.orderDates.includes(date)) purchase.orderDates.push(date);
  }
  return [...purchases.values()];
}

export function storedResearchUses(snapshot: unknown, observedAt: string | null, validIdentity: boolean): UseEvidence[] {
  if (!snapshot || typeof snapshot !== 'object' || !validIdentity || !observedAt) return [];
  const stored = snapshot as { productUses?: UseEvidence[]; researchEvidence?: Array<{ field: string; claim: string; sourceUrl: string; exactLocation: boolean }> };
  const structured = Array.isArray(stored.productUses) ? stored.productUses.filter(e => e && typeof e.use === 'string' && typeof e.source === 'string' && typeof e.observedAt === 'string' && typeof e.exactLocation === 'boolean') : [];
  // Legacy facts can support a menu-use hypothesis, never buyer demand or popularity.
  const legacy = (Array.isArray(stored.researchEvidence) ? stored.researchEvidence : []).flatMap(e => {
    if (!e.exactLocation || !/menu|cocktail/i.test(e.field) || !e.sourceUrl) return [];
    const matched = ['BOURBON','RYE','RUM','VODKA','GIN','TEQUILA'].filter(c => new RegExp(`\\b${c}\\b`, 'i').test(e.claim));
    return matched.map(category => ({ productCode: null, category, subtype: null, use: `${category.toLowerCase()} menu use`, kind: 'MENU' as const,
      claim: e.claim, source: e.sourceUrl, observedAt, exactLocation: true, pouredProduct: null, status: null }));
  });
  return [...structured, ...legacy];
}
