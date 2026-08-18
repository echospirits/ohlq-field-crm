export const AGENCY_INTELLIGENCE_RULES_VERSION = 'AGENCY_RULES_V1';
export const AGENCY_INTELLIGENCE_SCORING_VERSION = 'AGENCY_RETAIL_FIT_V1';

export const agencyIntelligenceConfig = {
  inventory: {
    stockoutDemandBottles30: 2,
    understockedDaysOfSupply: 14,
    deadInventoryDaysWithoutSale: 45,
    deadInventoryMinimumOnHand: 3,
  },
  fit: {
    highMinimum: 65,
    mediumMinimum: 40,
    strongSales30: 8,
    moderateSales30: 4,
    historicalSales: 12,
    strongPeerCarryPercent: 60,
    moderatePeerCarryPercent: 30,
    minimumPeerAgencies: 3,
  },
  tasting: {
    minimumFitScore: 55,
    minimumOnHand: 2,
    maximumSales30: 4,
    noRecentVisitDays: 90,
  },
  priority: {
    highMinimum: 70,
    mediumMinimum: 40,
  },
  wholesale: {
    highBuyerCount: 4,
    highBottles30: 24,
    highOpenOpportunityCount: 3,
    mediumBuyerCount: 1,
    mediumBottles30: 6,
    mediumOpenOpportunityCount: 1,
    lapseDays: 30,
  },
} as const;
