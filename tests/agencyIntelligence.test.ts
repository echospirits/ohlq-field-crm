import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { OhlqReportDataSource, OhlqReportRunStatus, OpportunityStatus } from '@prisma/client';
import {
  analyzeAgencyProduct,
  analyzeWholesaleInfluence,
  calculatePeerComparison,
  calculateRetailFit,
  type AgencyProductSignals,
} from '../lib/agencyIntelligence';
import {
  agencyIntelligenceInputsComplete,
  aggregateAgencyProductSales,
  buildAgencyIntelligenceEventKey,
  getNextAgencyOpportunityStatus,
} from '../lib/agencyIntelligenceService';
import { getTenantWholesaleSalesWhere } from '../lib/ohlqSalesData';
import type { TenantConfig } from '../lib/tenantConfig';

const base = (overrides: Partial<AgencyProductSignals> = {}): AgencyProductSignals => ({
  itemCode: '2804B',
  itemName: 'Echo Bourbon',
  onHand: 8,
  minimum: 4,
  inventoryStatus: 'Active',
  currentPlacement: true,
  previousPlacement: true,
  retailSales7: 2,
  retailSales30: 8,
  historicalRetailSales: 20,
  daysSinceLastSale: 2,
  peerAgencyCount: 9,
  peerCarryPercent: 70,
  peerAverageSales30: 7,
  peerAverageInventory: 6,
  d8Eligible: false,
  daysSinceLastVisit: 20,
  wholesaleInfluenceBand: 'MEDIUM',
  ...overrides,
});

describe('Agency inventory and opportunity states', () => {
  test('detects a productive stockout and recommends restocking', () => {
    const result = analyzeAgencyProduct(base({ onHand: 0, minimum: 6, retailSales30: 9 }));
    assert.equal(result.inventoryState, 'STOCKOUT');
    assert.equal(result.opportunityState, 'STOCKOUT');
    assert.equal(result.recommendedAction, 'RESTOCK');
  });

  test('detects inventory below its minimum as understocked', () => {
    const result = analyzeAgencyProduct(base({ onHand: 2, minimum: 6, retailSales30: 3 }));
    assert.equal(result.inventoryState, 'UNDERSTOCKED');
    assert.equal(result.opportunityState, 'RESTOCK');
  });

  test('detects dead inventory with no recent sell-through', () => {
    const result = analyzeAgencyProduct(base({ onHand: 8, retailSales7: 0, retailSales30: 0, daysSinceLastSale: 60, peerCarryPercent: 10 }));
    assert.equal(result.inventoryState, 'DEAD_INVENTORY');
    assert.equal(result.recommendedAction, 'INVESTIGATE');
  });

  test('keeps productive inventory healthy', () => {
    const result = analyzeAgencyProduct(base());
    assert.equal(result.inventoryState, 'HEALTHY');
    assert.equal(result.opportunityState, 'WINNING');
  });

  test('does not treat an unknown on-hand value as a stockout', () => {
    const result = analyzeAgencyProduct(base({ onHand: null, retailSales30: 8 }));
    assert.equal(result.inventoryState, 'INSUFFICIENT_DATA');
    assert.equal(result.opportunityState, 'INSUFFICIENT_EVIDENCE');
  });

  test('detects a high-fit missing placement', () => {
    const result = analyzeAgencyProduct(base({ currentPlacement: false, onHand: null, minimum: null, previousPlacement: false }));
    assert.equal(result.inventoryState, 'MISSING_PLACEMENT');
    assert.equal(result.recommendedAction, 'PURSUE_PLACEMENT');
  });
});

describe('Agency retail fit, peers, and tasting', () => {
  test('strong history and peer performance produce a higher explainable fit', () => {
    const strong = calculateRetailFit(base());
    const weak = calculateRetailFit(base({ retailSales30: 0, historicalRetailSales: 0, previousPlacement: false, peerCarryPercent: 0, peerAverageSales30: 0 }));
    assert.ok(strong.fitScore > weak.fitScore);
    assert.ok(strong.reasons.some((reason) => reason.includes('comparable agencies')));
  });

  test('peer comparison excludes the current agency from averages', () => {
    const result = calculatePeerComparison({
      currentCarries: true,
      currentInventory: 10,
      currentSales30: 8,
      groupAgencyCount: 4,
      groupCarryCount: 3,
      groupInventory: 22,
      groupSales30: 20,
    });
    assert.equal(result.peerAgencyCount, 3);
    assert.ok(Math.abs((result.peerCarryPercent ?? 0) - (200 / 3)) < 0.000_001);
    assert.equal(result.peerAverageInventory, 4);
    assert.equal(result.peerAverageSales30, 4);
  });

  test('D8 plus inventory and fit can recommend tasting', () => {
    const result = analyzeAgencyProduct(base({ d8Eligible: true, daysSinceLastVisit: 120, retailSales7: 0, retailSales30: 3, onHand: 10, minimum: 2 }));
    assert.equal(result.tastingOpportunity, true);
    assert.equal(result.opportunityState, 'ACTIVATION_OPPORTUNITY');
    assert.equal(result.recommendedAction, 'SCHEDULE_TASTING');
  });

  test('zero inventory never recommends tasting before inventory restoration', () => {
    const result = analyzeAgencyProduct(base({ d8Eligible: true, daysSinceLastVisit: 120, onHand: 0, retailSales30: 8 }));
    assert.equal(result.tastingOpportunity, false);
    assert.equal(result.recommendedAction, 'RESTOCK');
  });
});

test('wholesale influence uses linked buyers, volume, lapses, and open opportunities', () => {
  const result = analyzeWholesaleInfluence({
    linkedWholesaleCount: 18,
    activeWholesaleCount: 16,
    echoBuyerCount: 6,
    echoBottles30: 40,
    lapsedWholesaleCount: 3,
    openWholesaleOpportunityCount: 3,
  });
  assert.equal(result.band, 'HIGH');
  assert.ok(result.reasons.some((reason) => reason.includes('open wholesale opportunities')));
});

describe('daily Agency intelligence safety and idempotency', () => {
  const completed = (dataSource: OhlqReportDataSource) => ({ dataSource, status: OhlqReportRunStatus.COMPLETED });

  test('requires every source to complete before evaluation', () => {
    assert.equal(agencyIntelligenceInputsComplete([
      completed(OhlqReportDataSource.ANNUAL_SALES_SUMMARY),
      completed(OhlqReportDataSource.ANNUAL_SALES_SUMMARY_BY_WHOLESALE),
    ]), false);
    assert.equal(agencyIntelligenceInputsComplete([
      completed(OhlqReportDataSource.ANNUAL_SALES_SUMMARY),
      completed(OhlqReportDataSource.ANNUAL_SALES_SUMMARY_BY_WHOLESALE),
      completed(OhlqReportDataSource.AGENCY_INVENTORY_REPORT),
    ]), true);
  });

  test('uses a deterministic daily event key to prevent duplicate changes', () => {
    const input = { agencyId: 'agency-1', asOfDate: new Date('2026-08-18T00:00:00Z'), eventType: 'STOCKOUT_REACHED', itemCode: '2804B' };
    assert.equal(buildAgencyIntelligenceEventKey(input), buildAgencyIntelligenceEventKey(input));
  });

  test('preserves dismissals until signals materially change', () => {
    assert.equal(getNextAgencyOpportunityStatus({
      actionable: true,
      asOfDate: new Date('2026-08-18T00:00:00Z'),
      changed: false,
      previous: { status: OpportunityStatus.DISMISSED, snoozedUntil: null },
    }), OpportunityStatus.DISMISSED);
    assert.equal(getNextAgencyOpportunityStatus({
      actionable: true,
      asOfDate: new Date('2026-08-18T00:00:00Z'),
      changed: true,
      previous: { status: OpportunityStatus.DISMISSED, snoozedUntil: null },
    }), OpportunityStatus.OPEN);
  });

  test('preserves accepted opportunities while their signal state is unchanged', () => {
    assert.equal(getNextAgencyOpportunityStatus({
      actionable: true,
      asOfDate: new Date('2026-08-18T00:00:00Z'),
      changed: false,
      previous: { status: OpportunityStatus.ACTIONED, snoozedUntil: null },
    }), OpportunityStatus.ACTIONED);
  });
});

test('uses the tenant product filter for wholesale rows', () => {
  const config = {
    appName: 'Neat',
    digestName: 'Neat',
    entityName: 'Echo Spirits',
    id: 'echo-spirits',
    productLabel: 'Echo',
    productPluralLabel: 'Echo items',
    productFilter: {
      excludedItemCodes: ['EXCLUDED'],
      itemCodes: [],
      mode: 'vendor-exclusions',
      vendorIds: ['ECHO'],
    },
  } as TenantConfig;
  assert.deepEqual(getTenantWholesaleSalesWhere(config), {
    brand: { notIn: ['EXCLUDED'] },
    vendor: { in: ['ECHO'] },
  });
});

test('counts retail and wholesale-through-agency bottles in store velocity and last sale', () => {
  const sales = aggregateAgencyProductSales([
    {
      agencyId: ' 10562 ',
      brand: '2847B',
      reportDate: new Date('2026-07-23T00:00:00Z'),
      retailBottlesSold: 0,
      wholesaleBottlesSold: 7,
    },
    {
      agencyId: '10562',
      brand: '2847B',
      reportDate: new Date('2026-08-12T00:00:00Z'),
      retailBottlesSold: 0,
      wholesaleBottlesSold: 9,
    },
  ], new Date('2026-08-11T00:00:00Z'));

  assert.deepEqual(sales.get('10562|2847B'), {
    lastSaleDate: new Date('2026-08-12T00:00:00Z'),
    retailSales7: 9,
    retailSales30: 16,
    wholesaleSales30: 16,
  });
});
