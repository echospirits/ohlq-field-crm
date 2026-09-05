export const OPPORTUNITY_RULES_VERSION = 'RULES_V3';
export const OPPORTUNITY_SIGNAL_VERSION = 'SIGNALS_V3';
export const OPPORTUNITY_RANKING_VERSION = 'PRICE_AFFINITY_V3';

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

export type PortfolioCategory = 'BOURBON' | 'RYE' | 'RUM' | 'VODKA' | 'GIN' | 'GENEVER' | 'TEQUILA' | 'CORDIAL' | 'WHISKEY' | 'BRANDY' | 'SCOTCH' | 'IRISH' | 'CANADIAN';

// Centralized and editable. OHLQ master category/name values are normalized through these aliases.
export const opportunityCategoryMap: Record<PortfolioCategory, { label: string; aliases: string[] }> = {
  BOURBON: { label: 'Bourbon', aliases: ['BOURBON'] },
  RYE: { label: 'Rye', aliases: ['RYE'] },
  RUM: { label: 'Rum', aliases: ['RUM'] },
  VODKA: { label: 'Vodka', aliases: ['VODKA'] },
  GIN: { label: 'Gin', aliases: ['GIN'] },
  GENEVER: { label: 'Genever', aliases: ['GENEVER'] },
  TEQUILA: { label: 'Tequila', aliases: ['TEQUILA'] },
  CORDIAL: { label: 'Liqueur', aliases: ['CORDIAL', 'LIQUEUR'] },
  WHISKEY: { label: 'American whiskey', aliases: ['AMERICAN WHISKEY', 'WHISKEY'] },
  BRANDY: { label: 'Brandy', aliases: ['BRANDY', 'COGNAC'] },
  SCOTCH: { label: 'Scotch', aliases: ['SCOTCH'] },
  IRISH: { label: 'Irish whiskey', aliases: ['IRISH'] },
  CANADIAN: { label: 'Canadian whisky', aliases: ['CANADIAN'] },
};
export const normalizeOpportunityCategory = (category?: string | null, name?: string | null) => {
  const label = (category ?? '').trim().toUpperCase();
  const title = (name ?? '').toUpperCase();
  // Catalog category wins: Rumple Minze is a cordial, not rum.
  if (!label || label === 'AMERICAN WHISKEY' || label === 'WHISKEY') {
    if (/\bGENEVER\b/.test(title)) return 'GENEVER';
    if (/\bRYE\b/.test(title)) return 'RYE';
    if (/\bBOURBON\b/.test(title)) return 'BOURBON';
  }
  return (Object.entries(opportunityCategoryMap).find(([, value]) =>
    value.aliases.some(alias => new RegExp(`\\b${alias}\\b`).test(label || title)),
  )?.[0] ?? null) as PortfolioCategory | null;
};
