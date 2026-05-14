import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WorklistStatus } from '@prisma/client';
import {
  buildWholesaleReactivationAnalysis,
  getWholesaleReactivationWindows,
  planWholesaleReactivationWorklistSync,
  type ReactivationWorklistSnapshot,
  type WholesaleReactivationCandidate,
  type WholesaleReactivationPurchaseRow,
} from '../lib/ohlqWholesaleReactivation';

const runAt = new Date('2026-05-14T15:00:00.000Z');

const purchaseRow = (
  overrides: Partial<WholesaleReactivationPurchaseRow>,
): WholesaleReactivationPurchaseRow => ({
  brand: '0100A',
  permitNumber: '00072045-1',
  reportDate: new Date('2026-04-01T00:00:00.000Z'),
  vendor: 'Z90399001',
  wholesaleBottlesSold: 2,
  ...overrides,
});

const candidate = (overrides: Partial<WholesaleReactivationCandidate> = {}): WholesaleReactivationCandidate => ({
  accountName: 'Adriennes White Rabbit',
  daysSinceLastEchoPurchase: 43,
  items: [
    {
      itemCode: '0100A',
      itemName: 'Echo Vodka',
      mostRecentPurchaseDate: new Date('2026-04-01T00:00:00.000Z'),
      wholesaleBottlesSold: 2,
    },
  ],
  licenseeId: '00072045-1',
  mostRecentPurchaseDate: new Date('2026-04-01T00:00:00.000Z'),
  totalWholesaleBottlesSold: 2,
  wholesaleAccountId: 'wholesale-1',
  ...overrides,
});

const worklistItem = (overrides: Partial<ReactivationWorklistSnapshot>): ReactivationWorklistSnapshot => ({
  cancelledAt: null,
  completedAt: null,
  id: 'worklist-1',
  licenseeId: '00072045-1',
  status: WorklistStatus.OPEN,
  updatedAt: new Date('2026-05-01T00:00:00.000Z'),
  wholesaleAccountId: 'wholesale-1',
  ...overrides,
});

describe('getWholesaleReactivationWindows', () => {
  it('uses date-only 90-day and 30-day windows relative to the run date', () => {
    const windows = getWholesaleReactivationWindows({ runAt });

    assert.equal(windows.runDate.toISOString(), '2026-05-14T00:00:00.000Z');
    assert.equal(windows.ninetyDayStartDate.toISOString(), '2026-02-13T00:00:00.000Z');
    assert.equal(windows.recentStartDate.toISOString(), '2026-04-14T00:00:00.000Z');
    assert.equal(windows.dueDate.toISOString(), '2026-05-21T00:00:00.000Z');
  });
});

describe('buildWholesaleReactivationAnalysis', () => {
  it('flags Licensee IDs with Echo purchases in 90 days and none in 30 days', () => {
    const result = buildWholesaleReactivationAnalysis({
      accounts: [
        { id: 'wholesale-1', licenseeId: '00072045-1', name: 'Adriennes White Rabbit' },
        { id: 'wholesale-2', licenseeId: 'T40949003', name: 'Recent Buyer' },
        { id: 'wholesale-3', licenseeId: 'COLD-1', name: 'Cold Buyer' },
      ],
      itemNames: new Map([['0100A', 'Echo Vodka']]),
      rows: [
        purchaseRow({ permitNumber: '00072045-1', reportDate: new Date('2026-04-01T00:00:00.000Z') }),
        purchaseRow({ brand: '3150B', permitNumber: '00072045-1', reportDate: new Date('2026-04-03T00:00:00.000Z') }),
        purchaseRow({ permitNumber: 't40949003', reportDate: new Date('2026-05-06T00:00:00.000Z') }),
        purchaseRow({ permitNumber: 'COLD-1', reportDate: new Date('2026-01-10T00:00:00.000Z') }),
        purchaseRow({ permitNumber: 'OTHER-1', vendor: '000000932' }),
        purchaseRow({ permitNumber: 'MISSING-1', reportDate: new Date('2026-03-30T00:00:00.000Z') }),
      ],
      runAt,
    });

    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].licenseeId, '00072045-1');
    assert.equal(result.candidates[0].items[0].itemName, 'Echo Vodka');
    assert.equal(result.candidates[0].totalWholesaleBottlesSold, 2);
    assert.equal(result.recentBuyerLicenseeIds.has('T40949003'), true);
    assert.deepEqual(result.unmatchedLicenseeIds, ['MISSING-1']);
  });

  it('does not flag Licensee IDs with recent purchases, no 90-day purchases, wrong vendor, or item 3150B only', () => {
    const result = buildWholesaleReactivationAnalysis({
      accounts: [
        { id: 'recent', licenseeId: 'RECENT-1', name: 'Recent Buyer' },
        { id: 'cold', licenseeId: 'COLD-1', name: 'Cold Buyer' },
        { id: 'other', licenseeId: 'OTHER-1', name: 'Other Vendor' },
        { id: 'excluded', licenseeId: 'EXCLUDED-1', name: 'Excluded Item' },
      ],
      rows: [
        purchaseRow({ permitNumber: 'RECENT-1', reportDate: new Date('2026-05-01T00:00:00.000Z') }),
        purchaseRow({ permitNumber: 'COLD-1', reportDate: new Date('2026-01-10T00:00:00.000Z') }),
        purchaseRow({ permitNumber: 'OTHER-1', vendor: '000000932' }),
        purchaseRow({ brand: '3150B', permitNumber: 'EXCLUDED-1' }),
      ],
      runAt,
    });

    assert.equal(result.candidates.length, 0);
  });
});

describe('planWholesaleReactivationWorklistSync', () => {
  it('creates one worklist item for a new qualifying account', () => {
    const plan = planWholesaleReactivationWorklistSync({
      candidates: [candidate()],
      existingItems: [],
      recentBuyerLicenseeIds: new Set(),
    });

    assert.equal(plan.createCandidates.length, 1);
    assert.equal(plan.updateItems.length, 0);
  });

  it('updates an existing open worklist item instead of creating a duplicate', () => {
    const plan = planWholesaleReactivationWorklistSync({
      candidates: [candidate()],
      existingItems: [worklistItem({})],
      recentBuyerLicenseeIds: new Set(),
    });

    assert.equal(plan.createCandidates.length, 0);
    assert.equal(plan.updateItems.length, 1);
    assert.equal(plan.updateItems[0].item.id, 'worklist-1');
  });

  it('cancels an open stale item when the account purchased again in the last 30 days', () => {
    const plan = planWholesaleReactivationWorklistSync({
      candidates: [],
      existingItems: [worklistItem({})],
      recentBuyerLicenseeIds: new Set(['00072045-1']),
    });

    assert.equal(plan.cancelItems.length, 1);
  });

  it('does not recreate a manually completed current-lapse item', () => {
    const plan = planWholesaleReactivationWorklistSync({
      candidates: [candidate()],
      existingItems: [
        worklistItem({
          completedAt: new Date('2026-04-20T00:00:00.000Z'),
          status: WorklistStatus.COMPLETED,
        }),
      ],
      recentBuyerLicenseeIds: new Set(),
    });

    assert.equal(plan.createCandidates.length, 0);
    assert.equal(plan.skippedCandidates.length, 1);
  });

  it('creates a new item when the account has a new qualifying lapse after an older completion', () => {
    const plan = planWholesaleReactivationWorklistSync({
      candidates: [candidate({ mostRecentPurchaseDate: new Date('2026-04-15T00:00:00.000Z') })],
      existingItems: [
        worklistItem({
          completedAt: new Date('2026-04-01T00:00:00.000Z'),
          status: WorklistStatus.COMPLETED,
        }),
      ],
      recentBuyerLicenseeIds: new Set(),
    });

    assert.equal(plan.createCandidates.length, 1);
  });
});
