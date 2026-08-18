import {
  AGENCY_INTELLIGENCE_RULES_VERSION,
  AGENCY_INTELLIGENCE_SCORING_VERSION,
  agencyIntelligenceConfig,
} from './agencyIntelligenceConfig';

export type IntelligenceBand = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT_DATA';
export type InventoryState =
  | 'HEALTHY'
  | 'STOCKOUT'
  | 'UNDERSTOCKED'
  | 'DEAD_INVENTORY'
  | 'MISSING_PLACEMENT'
  | 'AT_RISK'
  | 'INSUFFICIENT_DATA';
export type ProductOpportunityState =
  | 'WINNING'
  | 'MAINTAIN'
  | 'RESTOCK'
  | 'STOCKOUT'
  | 'PLACEMENT_OPPORTUNITY'
  | 'ACTIVATION_OPPORTUNITY'
  | 'AT_RISK'
  | 'DEAD_INVENTORY'
  | 'LOW_PRIORITY'
  | 'INSUFFICIENT_EVIDENCE';
export type RecommendedAction =
  | 'MAINTAIN'
  | 'RESTOCK'
  | 'PURSUE_PLACEMENT'
  | 'SCHEDULE_TASTING'
  | 'INVESTIGATE'
  | 'REDUCE_PRIORITY'
  | 'MONITOR'
  | 'NO_ACTION';

export type AgencyProductSignals = {
  itemCode: string;
  itemName: string;
  onHand: number | null;
  minimum: number | null;
  inventoryStatus: string | null;
  currentPlacement: boolean;
  previousPlacement: boolean;
  retailSales7: number;
  retailSales30: number;
  historicalRetailSales: number;
  daysSinceLastSale: number | null;
  peerAgencyCount: number;
  peerCarryPercent: number | null;
  peerAverageSales30: number | null;
  peerAverageInventory: number | null;
  d8Eligible: boolean;
  daysSinceLastVisit: number | null;
  wholesaleInfluenceBand: IntelligenceBand;
};

export type AgencyProductAnalysis = {
  daysOfSupply: number | null;
  estimatedMonthlyVelocity: number;
  fitBand: IntelligenceBand;
  fitScore: number;
  inventoryState: InventoryState;
  opportunityState: ProductOpportunityState;
  priorityBand: IntelligenceBand;
  priorityScore: number;
  reasons: string[];
  recommendedAction: RecommendedAction;
  rulesVersion: string;
  scoringVersion: string;
  tastingOpportunity: boolean;
};

export type WholesaleInfluenceSignals = {
  linkedWholesaleCount: number;
  activeWholesaleCount: number;
  echoBuyerCount: number;
  echoBottles30: number;
  lapsedWholesaleCount: number;
  openWholesaleOpportunityCount: number;
};

export type WholesaleInfluenceAnalysis = WholesaleInfluenceSignals & {
  band: IntelligenceBand;
  reasons: string[];
};

export function calculatePeerComparison({
  currentCarries,
  currentInventory,
  currentSales30,
  groupAgencyCount,
  groupCarryCount,
  groupInventory,
  groupSales30,
}: {
  currentCarries: boolean;
  currentInventory: number;
  currentSales30: number;
  groupAgencyCount: number;
  groupCarryCount: number;
  groupInventory: number;
  groupSales30: number;
}) {
  const peerAgencyCount = Math.max(0, groupAgencyCount - 1);
  return {
    peerAgencyCount,
    peerAverageInventory: peerAgencyCount > 0 ? (groupInventory - currentInventory) / peerAgencyCount : null,
    peerAverageSales30: peerAgencyCount > 0 ? (groupSales30 - currentSales30) / peerAgencyCount : null,
    peerCarryPercent: peerAgencyCount > 0
      ? ((groupCarryCount - (currentCarries ? 1 : 0)) / peerAgencyCount) * 100
      : null,
  };
}

const clamp = (value: number, minimum = 0, maximum = 100) => Math.max(minimum, Math.min(maximum, value));

const bandForScore = (score: number, highMinimum: number, mediumMinimum: number): IntelligenceBand =>
  score >= highMinimum ? 'HIGH' : score >= mediumMinimum ? 'MEDIUM' : 'LOW';

const statusLooksAtRisk = (status: string | null) =>
  Boolean(status && /(inactive|discontinued|delist|pending removal|closeout)/i.test(status));

export function calculateRetailFit(signals: AgencyProductSignals) {
  const rules = agencyIntelligenceConfig.fit;
  let score = 15;
  const reasons: string[] = [];

  if (signals.retailSales30 >= rules.strongSales30) {
    score += 30;
    reasons.push(`${signals.retailSales30} retail bottles sold in the last 30 days`);
  } else if (signals.retailSales30 >= rules.moderateSales30) {
    score += 20;
    reasons.push(`Steady recent demand: ${signals.retailSales30} retail bottles in 30 days`);
  } else if (signals.retailSales30 > 0) {
    score += 10;
    reasons.push(`Recent retail demand: ${signals.retailSales30} bottle${signals.retailSales30 === 1 ? '' : 's'} in 30 days`);
  }

  if (signals.historicalRetailSales >= rules.historicalSales) {
    score += 12;
    reasons.push('Strong observed sales history');
  }
  if (signals.previousPlacement) {
    score += 8;
    reasons.push('Previously placed at this agency');
  }
  if (signals.peerAgencyCount >= rules.minimumPeerAgencies && signals.peerCarryPercent !== null) {
    if (signals.peerCarryPercent >= rules.strongPeerCarryPercent) {
      score += 15;
      reasons.push(`${Math.round(signals.peerCarryPercent)}% of comparable agencies carry this item`);
    } else if (signals.peerCarryPercent >= rules.moderatePeerCarryPercent) {
      score += 8;
      reasons.push(`${Math.round(signals.peerCarryPercent)}% of comparable agencies carry this item`);
    }
  }
  if (
    signals.peerAgencyCount >= rules.minimumPeerAgencies &&
    signals.peerAverageSales30 !== null &&
    signals.peerAverageSales30 >= rules.moderateSales30 &&
    signals.retailSales30 < signals.peerAverageSales30 * 0.5
  ) {
    score += 8;
    reasons.push(`Comparable agencies average ${signals.peerAverageSales30.toFixed(1)} bottles in 30 days`);
  }
  if (signals.d8Eligible) {
    score += 5;
    reasons.push('D8 tasting eligible');
  }
  if (signals.wholesaleInfluenceBand === 'HIGH') score += 5;
  else if (signals.wholesaleInfluenceBand === 'MEDIUM') score += 3;

  if (
    (signals.onHand ?? 0) >= agencyIntelligenceConfig.inventory.deadInventoryMinimumOnHand &&
    signals.retailSales30 === 0 &&
    (signals.daysSinceLastSale ?? Number.POSITIVE_INFINITY) >=
      agencyIntelligenceConfig.inventory.deadInventoryDaysWithoutSale
  ) {
    score -= 20;
    reasons.push('Existing inventory has not shown recent sell-through');
  }
  if (statusLooksAtRisk(signals.inventoryStatus)) {
    score -= 15;
    reasons.push(`Inventory status is ${signals.inventoryStatus}`);
  }

  const fitScore = clamp(Math.round(score));
  return {
    fitBand: bandForScore(fitScore, rules.highMinimum, rules.mediumMinimum),
    fitScore,
    reasons,
  };
}

export function detectInventoryState(signals: AgencyProductSignals, fitBand: IntelligenceBand): InventoryState {
  const rules = agencyIntelligenceConfig.inventory;
  const onHand = signals.onHand ?? 0;
  const monthlyVelocity = signals.retailSales30;
  const daysOfSupply = monthlyVelocity > 0 && onHand > 0 ? (onHand / monthlyVelocity) * 30 : null;

  if (statusLooksAtRisk(signals.inventoryStatus) && (signals.currentPlacement || signals.previousPlacement)) return 'AT_RISK';
  if (signals.currentPlacement && signals.onHand === null) return 'INSUFFICIENT_DATA';
  if (!signals.currentPlacement) {
    if (fitBand === 'HIGH') return signals.previousPlacement ? 'AT_RISK' : 'MISSING_PLACEMENT';
    return 'INSUFFICIENT_DATA';
  }
  if (onHand === 0 && signals.retailSales30 >= rules.stockoutDemandBottles30) return 'STOCKOUT';
  if (onHand === 0) return 'INSUFFICIENT_DATA';
  if (
    onHand > 0 &&
    ((signals.minimum !== null && onHand < signals.minimum) ||
      (daysOfSupply !== null && daysOfSupply < rules.understockedDaysOfSupply))
  ) return 'UNDERSTOCKED';
  if (
    onHand >= rules.deadInventoryMinimumOnHand &&
    signals.retailSales30 === 0 &&
    (signals.daysSinceLastSale ?? Number.POSITIVE_INFINITY) >= rules.deadInventoryDaysWithoutSale
  ) return 'DEAD_INVENTORY';
  return 'HEALTHY';
}

const isTastingOpportunity = (signals: AgencyProductSignals, fitScore: number, inventoryState: InventoryState) => {
  const rules = agencyIntelligenceConfig.tasting;
  return (
    signals.d8Eligible &&
    (signals.onHand ?? 0) >= rules.minimumOnHand &&
    fitScore >= rules.minimumFitScore &&
    signals.retailSales30 <= rules.maximumSales30 &&
    (signals.daysSinceLastVisit === null || signals.daysSinceLastVisit >= rules.noRecentVisitDays) &&
    inventoryState !== 'STOCKOUT' &&
    inventoryState !== 'UNDERSTOCKED'
  );
};

const opportunityForState = ({
  fitBand,
  inventoryState,
  tastingOpportunity,
}: {
  fitBand: IntelligenceBand;
  inventoryState: InventoryState;
  tastingOpportunity: boolean;
}): { action: RecommendedAction; state: ProductOpportunityState } => {
  if (inventoryState === 'STOCKOUT') return { action: 'RESTOCK', state: 'STOCKOUT' };
  if (inventoryState === 'UNDERSTOCKED') return { action: 'RESTOCK', state: 'RESTOCK' };
  if (inventoryState === 'MISSING_PLACEMENT') return { action: 'PURSUE_PLACEMENT', state: 'PLACEMENT_OPPORTUNITY' };
  if (tastingOpportunity) return { action: 'SCHEDULE_TASTING', state: 'ACTIVATION_OPPORTUNITY' };
  if (inventoryState === 'DEAD_INVENTORY') return { action: 'INVESTIGATE', state: 'DEAD_INVENTORY' };
  if (inventoryState === 'AT_RISK') return { action: 'INVESTIGATE', state: 'AT_RISK' };
  if (inventoryState === 'INSUFFICIENT_DATA') return { action: 'MONITOR', state: 'INSUFFICIENT_EVIDENCE' };
  if (fitBand === 'HIGH') return { action: 'MAINTAIN', state: 'WINNING' };
  if (fitBand === 'LOW') return { action: 'REDUCE_PRIORITY', state: 'LOW_PRIORITY' };
  return { action: 'MAINTAIN', state: 'MAINTAIN' };
};

export function analyzeAgencyProduct(signals: AgencyProductSignals): AgencyProductAnalysis {
  const fit = calculateRetailFit(signals);
  const inventoryState = detectInventoryState(signals, fit.fitBand);
  const tastingOpportunity = isTastingOpportunity(signals, fit.fitScore, inventoryState);
  const opportunity = opportunityForState({ fitBand: fit.fitBand, inventoryState, tastingOpportunity });
  const stateBoost: Record<ProductOpportunityState, number> = {
    STOCKOUT: 30,
    RESTOCK: 24,
    PLACEMENT_OPPORTUNITY: 22,
    ACTIVATION_OPPORTUNITY: 18,
    AT_RISK: 16,
    DEAD_INVENTORY: 14,
    WINNING: 2,
    MAINTAIN: 0,
    LOW_PRIORITY: -20,
    INSUFFICIENT_EVIDENCE: -25,
  };
  const priorityScore = clamp(fit.fitScore + stateBoost[opportunity.state]);
  const onHand = signals.onHand ?? 0;
  const daysOfSupply = signals.retailSales30 > 0 && onHand > 0 ? (onHand / signals.retailSales30) * 30 : null;
  const stateReasons: string[] = [];

  if (inventoryState === 'STOCKOUT') stateReasons.push(`0 on hand with ${signals.retailSales30} sold in 30 days`);
  if (inventoryState === 'UNDERSTOCKED') stateReasons.push(`${onHand} on hand${signals.minimum !== null ? ` versus minimum ${signals.minimum}` : ''}`);
  if (inventoryState === 'MISSING_PLACEMENT') stateReasons.push('High fit with no current placement');
  if (inventoryState === 'DEAD_INVENTORY') stateReasons.push(`${onHand} on hand with no recent sell-through`);
  if (tastingOpportunity) stateReasons.push('Inventory is available and no recent Agency visit is recorded');

  return {
    daysOfSupply,
    estimatedMonthlyVelocity: signals.retailSales30,
    fitBand: fit.fitBand,
    fitScore: fit.fitScore,
    inventoryState,
    opportunityState: opportunity.state,
    priorityBand: bandForScore(
      priorityScore,
      agencyIntelligenceConfig.priority.highMinimum,
      agencyIntelligenceConfig.priority.mediumMinimum,
    ),
    priorityScore,
    reasons: [...stateReasons, ...fit.reasons].slice(0, 5),
    recommendedAction: opportunity.action,
    rulesVersion: AGENCY_INTELLIGENCE_RULES_VERSION,
    scoringVersion: AGENCY_INTELLIGENCE_SCORING_VERSION,
    tastingOpportunity,
  };
}

export function analyzeWholesaleInfluence(signals: WholesaleInfluenceSignals): WholesaleInfluenceAnalysis {
  const rules = agencyIntelligenceConfig.wholesale;
  const high =
    signals.echoBuyerCount >= rules.highBuyerCount ||
    signals.echoBottles30 >= rules.highBottles30 ||
    signals.openWholesaleOpportunityCount >= rules.highOpenOpportunityCount;
  const medium =
    signals.echoBuyerCount >= rules.mediumBuyerCount ||
    signals.echoBottles30 >= rules.mediumBottles30 ||
    signals.openWholesaleOpportunityCount >= rules.mediumOpenOpportunityCount ||
    signals.activeWholesaleCount >= 3;
  const reasons = [
    `${signals.activeWholesaleCount} active linked wholesale account${signals.activeWholesaleCount === 1 ? '' : 's'}`,
    `${signals.echoBuyerCount} current Echo wholesale buyer${signals.echoBuyerCount === 1 ? '' : 's'}`,
  ];
  if (signals.echoBottles30 > 0) reasons.push(`${signals.echoBottles30} wholesale Echo bottles in 30 days`);
  if (signals.openWholesaleOpportunityCount > 0) reasons.push(`${signals.openWholesaleOpportunityCount} open wholesale opportunities`);
  if (signals.lapsedWholesaleCount > 0) reasons.push(`${signals.lapsedWholesaleCount} lapsed wholesale buyers`);

  return { ...signals, band: high ? 'HIGH' : medium ? 'MEDIUM' : 'LOW', reasons: reasons.slice(0, 4) };
}

export function getMeaningfulAgencyChange(
  previous: Pick<AgencyProductAnalysis, 'inventoryState' | 'opportunityState'> | null,
  current: Pick<AgencyProductAnalysis, 'inventoryState' | 'opportunityState'>,
) {
  if (!previous) return 'DETECTED';
  if (previous.inventoryState !== current.inventoryState) {
    if (current.inventoryState === 'STOCKOUT') return 'STOCKOUT_REACHED';
    if (previous.inventoryState === 'STOCKOUT') return 'RESTOCKED';
    if (current.inventoryState === 'UNDERSTOCKED') return 'BELOW_MINIMUM';
    if (current.inventoryState === 'DEAD_INVENTORY') return 'DEAD_INVENTORY_THRESHOLD';
    if (current.inventoryState === 'MISSING_PLACEMENT') return 'PLACEMENT_MISSING';
    return 'INVENTORY_STATE_CHANGED';
  }
  if (previous.opportunityState !== current.opportunityState) return 'OPPORTUNITY_STATE_CHANGED';
  return null;
}

export const isActionableAgencyOpportunity = (state: ProductOpportunityState) =>
  !['WINNING', 'MAINTAIN', 'LOW_PRIORITY', 'INSUFFICIENT_EVIDENCE'].includes(state);
