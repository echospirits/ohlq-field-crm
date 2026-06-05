import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WorklistStatus, type PrismaClient } from '@prisma/client';
import {
  buildWholesaleReactivationAnalysis,
  findOhlqWholesaleReactivationCandidates,
  getOhlqWholesaleReactivationDashboardSummary,
  getReactivationPurchasedAgainMessage,
  getWholesaleReactivationWindows,
  planWholesaleReactivationWorklistSync,
  splitReactivationPurchasedAgainDetail,
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
        { id: 'wholesale-1', licenseeId: '72045', name: 'Adriennes White Rabbit' },
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
    assert.equal(result.candidates[0].licenseeId, '72045');
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

  it('treats secondary Licensee IDs as the same wholesale account', () => {
    const result = buildWholesaleReactivationAnalysis({
      accounts: [
        {
          id: 'wholesale-1',
          licenseeId: 'PRIMARY-1',
          licenseeIds: [{ licenseeId: '00072045-1' }],
          name: 'Adriennes White Rabbit',
        },
      ],
      itemNames: new Map([['0100A', 'Echo Vodka']]),
      rows: [purchaseRow({ permitNumber: '00072045-1', reportDate: new Date('2026-04-01T00:00:00.000Z') })],
      runAt,
    });

    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].wholesaleAccountId, 'wholesale-1');
    assert.equal(result.candidates[0].licenseeId, 'PRIMARY-1');
  });
});

describe('findOhlqWholesaleReactivationCandidates', () => {
  it('uses stored last Echo purchase state instead of requiring raw rows older than 30 days', async () => {
    let findManyCalls = 0;
    const db = {
      wholesaleAccount: {
        findMany: async () => {
          findManyCalls += 1;
          return findManyCalls === 1
            ? [
                {
                  id: 'wholesale-1',
                  licenseeId: '00072045-1',
                  name: 'Adriennes White Rabbit',
                  ohlqLastEchoPurchaseBottles: 2,
                  ohlqLastEchoPurchaseDate: new Date('2026-04-01T00:00:00.000Z'),
                  ohlqLastEchoPurchaseItemCode: '0100A',
                  ohlqLastEchoPurchaseItemName: 'Echo Vodka',
                },
              ]
            : [
                {
                  licenseeId: '00077777-1',
                  ohlqLastEchoPurchaseDate: new Date('2026-05-06T00:00:00.000Z'),
                },
              ];
        },
      },
    };

    const result = await findOhlqWholesaleReactivationCandidates({
      db: db as unknown as PrismaClient,
      runAt,
    });

    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].licenseeId, '00072045-1');
    assert.equal(result.candidates[0].items[0].itemName, 'Echo Vodka');
    assert.equal(result.recentBuyerLicenseeIds.has('77777'), true);
    assert.deepEqual(result.unmatchedLicenseeIds, []);
  });
});

describe('getOhlqWholesaleReactivationDashboardSummary', () => {
  it('uses active worklist items as the dashboard summary source of truth', async () => {
    let worklistWhere: unknown = null;
    const db = {
      wholesaleAccount: {
        findMany: async (args: { where?: { id?: { in?: string[] } } }) => {
          if (!args.where?.id) return [];

          return [
            {
              id: 'wholesale-1',
              name: 'Adriennes White Rabbit',
              ohlqLastEchoPurchaseDate: new Date('2026-05-06T00:00:00.000Z'),
              ohlqLastEchoPurchaseItemCode: '0100A',
              ohlqLastEchoPurchaseItemName: 'Echo Vodka',
            },
          ];
        },
      },
      worklistItem: {
        count: async (args: { where: unknown }) => {
          worklistWhere = args.where;
          return 1;
        },
        findMany: async (args: { where: unknown }) => {
          worklistWhere = args.where;
          return [
            {
              detail: 'Original follow-up context.',
              dueDate: new Date('2026-05-21T00:00:00.000Z'),
              id: 'worklist-1',
              title: 'Follow up',
              wholesaleAccountId: 'wholesale-1',
            },
          ];
        },
      },
    };

    const result = await getOhlqWholesaleReactivationDashboardSummary({
      db: db as unknown as PrismaClient,
      runAt,
    });

    assert.deepEqual(worklistWhere, {
      category: 'WHOLESALE',
      source: 'OHLQ_WHOLESALE_REACTIVATION',
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
      wholesaleAccountId: { not: null },
    });
    assert.equal(result.accountCount, 1);
    assert.equal(result.topAccounts.length, 1);
    assert.equal(result.topAccounts[0].worklistItemId, 'worklist-1');
    assert.equal(result.topAccounts[0].purchasedAgainAt?.toISOString(), '2026-05-06T00:00:00.000Z');
  });
});

describe('planWholesaleReactivationWorklistSync', () => {
  it('creates one worklist item for a new qualifying account', () => {
    const plan = planWholesaleReactivationWorklistSync({
      candidates: [candidate()],
      existingItems: [],
      recentBuyerPurchaseDatesByLicenseeId: new Map(),
    });

    assert.equal(plan.createCandidates.length, 1);
    assert.equal(plan.updateItems.length, 0);
  });

  it('updates an existing open worklist item instead of creating a duplicate', () => {
    const plan = planWholesaleReactivationWorklistSync({
      candidates: [candidate()],
      existingItems: [worklistItem({})],
      recentBuyerPurchaseDatesByLicenseeId: new Map(),
    });

    assert.equal(plan.createCandidates.length, 0);
    assert.equal(plan.updateItems.length, 1);
    assert.equal(plan.updateItems[0].item.id, 'worklist-1');
  });

  it('flags an open stale item for review when the account purchased again in the last 30 days', () => {
    const purchasedAgainAt = new Date('2026-05-01T00:00:00.000Z');
    const plan = planWholesaleReactivationWorklistSync({
      candidates: [],
      existingItems: [worklistItem({})],
      recentBuyerPurchaseDatesByLicenseeId: new Map([
        ['00072045-1', purchasedAgainAt],
        ['72045', purchasedAgainAt],
      ]),
    });

    assert.equal(plan.reviewItems.length, 1);
    assert.equal(plan.reviewItems[0].item.id, 'worklist-1');
    assert.equal(plan.reviewItems[0].purchasedAgainAt, purchasedAgainAt);
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
      recentBuyerPurchaseDatesByLicenseeId: new Map(),
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
      recentBuyerPurchaseDatesByLicenseeId: new Map(),
    });

    assert.equal(plan.createCandidates.length, 1);
  });
});

describe('reactivation purchased-again detail helpers', () => {
  it('parses the review ribbon message separately from the regular detail', () => {
    const message = getReactivationPurchasedAgainMessage(new Date('2026-05-06T00:00:00.000Z'));
    const result = splitReactivationPurchasedAgainDetail(`${message}\n\nOriginal follow-up context.`);

    assert.equal(
      result.purchasedAgainMessage,
      'Account purchased again on 2026-05-06. This worklist item can be cancelled if no follow-up is needed.',
    );
    assert.equal(result.detail, 'Original follow-up context.');
  });
});
