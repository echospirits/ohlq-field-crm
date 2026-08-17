export const OPPORTUNITY_RULES_VERSION = 'RULES_V2';
export const OPPORTUNITY_SIGNAL_VERSION = 'SIGNALS_V2';
export const OPPORTUNITY_RANKING_VERSION = 'RULE_BASED_V2';

export const opportunityRules = {
  lapseLookbackDays: 90,
  lapseRecentDays: 30,
  firstOrderWindowDays: 30,
  noTouchDays: 45,
  minimumCategoryBottles90Days: 6,
  activePurchaseBottles90Days: 6,
  conversionWindowDays: 90,
  expirationDays: 120,
  nationalChainScoreCap: 20,
  autoCreateWorklist: {
    LAPSED_BUYER: true,
    FIRST_ORDER_FOLLOW_UP: true,
    CATEGORY_CONQUEST: false,
    CROSS_SELL: false,
    NO_RECENT_TOUCH: true,
  },
} as const;

// Explicit, reviewable fallbacks until public research marks isNationalChain directly.
// Local and regional groups are intentionally excluded.
export const nationalChainNamePatterns = [
  'applebee',
  'bj s restaurant',
  'bjs restaurant',
  'brio',
  'buffalo wild wings',
  'cheddar s',
  'chili s',
  'cracker barrel',
  'first watch',
  'longhorn steakhouse',
  'olive garden',
  'outback steakhouse',
  'red lobster',
  'red robin',
  'smokey bones',
  'texas roadhouse',
  'yard house',
] as const;

export type PortfolioCategory = 'BOURBON' | 'RYE' | 'RUM';

// Centralized and editable. OHLQ master category/name values are normalized through these aliases.
export const opportunityCategoryMap: Record<PortfolioCategory, { label: string; aliases: string[] }> = {
  BOURBON: { label: 'Bourbon', aliases: ['BOURBON'] },
  RYE: { label: 'Rye', aliases: ['RYE'] },
  RUM: { label: 'Rum', aliases: ['RUM'] },
};
export const normalizeOpportunityCategory = (category?: string | null, name?: string | null) => {
  const haystack = `${category ?? ''} ${name ?? ''}`.toUpperCase();
  return (Object.entries(opportunityCategoryMap).find(([, value]) =>
    value.aliases.some((alias) => haystack.includes(alias)),
  )?.[0] ?? null) as PortfolioCategory | null;
};
