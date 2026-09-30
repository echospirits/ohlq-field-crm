import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import type { TenantConfig } from '../lib/tenantConfig';
import { getTenantConfig } from '../lib/tenantConfig';
import {
  ECHO_VENDOR_ID,
  getAgencyRecentItemSales,
  getTenantAccountSalesEventWhere,
  getWholesaleRecentPurchases,
  getOhlqWindowStartDate,
  isEchoItem,
  normalizeOhlqId,
  summarizeLinkedWholesaleAccountSales,
  toAgencySalesSummaryItems,
} from '../lib/ohlqSalesData';

const otherTenantConfig: TenantConfig = {
  appName: 'Neat',
  digestName: 'Neat',
  entityName: 'Other Distillery',
  id: 'other-tenant',
  productLabel: 'Other Distillery',
  productPluralLabel: 'Other Distillery items',
  productFilter: { excludedItemCodes: [], itemCodes: ['0200B'], mode: 'item-list', vendorIds: ['OTHER'] },
};

describe('OHLQ Echo item filtering', () => {
  it('includes Echo vendor rows and excludes item code 3150B', () => {
    assert.equal(isEchoItem(ECHO_VENDOR_ID, '0100A'), true);
    assert.equal(isEchoItem(ECHO_VENDOR_ID.toLowerCase(), '0100A'), true);
    assert.equal(isEchoItem(ECHO_VENDOR_ID, '3150B'), false);
    assert.equal(isEchoItem('000000932', '0100A'), false);
  });

  it('builds tenant-specific purchase timeline filters', () => {
    assert.deepEqual(
      getTenantAccountSalesEventWhere({
        appName: 'Tenant',
        digestName: 'Tenant',
        entityName: 'Tenant Co.',
        id: 'tenant',
        productLabel: 'Tenant',
        productPluralLabel: 'Tenant products',
        productFilter: { excludedItemCodes: [], itemCodes: ['A', 'B'], mode: 'item-list', vendorIds: ['VENDOR'] },
      }),
      { itemCode: { in: ['A', 'B'] } },
    );
    assert.deepEqual(
      getTenantAccountSalesEventWhere({
        appName: 'Tenant',
        digestName: 'Tenant',
        entityName: 'Tenant Co.',
        id: 'tenant',
        productLabel: 'Tenant',
        productPluralLabel: 'Tenant products',
        productFilter: { excludedItemCodes: ['X'], itemCodes: [], mode: 'vendor-exclusions', vendorIds: ['VENDOR'] },
      }),
      { itemCode: { notIn: ['X'] }, vendor: { in: ['VENDOR'] } },
    );
  });
});

describe('getWholesaleRecentPurchases', () => {
  it('matches permit suffix variants and aggregates purchases by item name', async () => {
    const whereClauses: unknown[] = [];
    const db = {
      account: {
        findMany: async () => [],
      },
      ohlqAnnualSalesByWholesaleRow: {
        findFirst: async () => ({ reportDate: new Date('2026-05-12T00:00:00.000Z') }),
        findMany: async ({ where }: { where: unknown }) => {
          whereClauses.push(where);
          return [
          {
            agencyId: '10101',
            brand: '0100A',
            permitNumber: '00072045-1',
            reportDate: new Date('2026-05-12T00:00:00.000Z'),
            vendor: ECHO_VENDOR_ID,
            wholesaleBottlesSold: 3,
          },
          {
            agencyId: '10100',
            brand: '0200B',
            permitNumber: '00072045-1',
            reportDate: new Date('2026-05-11T00:00:00.000Z'),
            vendor: 'OTHER',
            wholesaleBottlesSold: 1,
          },
          {
            agencyId: '10100',
            brand: '0100A',
            permitNumber: '00072045-2',
            reportDate: new Date('2026-05-10T00:00:00.000Z'),
            vendor: ECHO_VENDOR_ID,
            wholesaleBottlesSold: 2,
          },
          {
            agencyId: '10200',
            brand: '0300C',
            permitNumber: '99999999-1',
            reportDate: new Date('2026-05-10T00:00:00.000Z'),
            vendor: 'OTHER',
            wholesaleBottlesSold: 99,
          },
          ];
        },
      },
      ohlqBrandMasterItem: {
        findMany: async () => [
          { itemCode: '0200B', name: 'Zeta Whiskey' },
          { itemCode: '0100A', name: 'Alpha Vodka' },
        ],
      },
    } as unknown as PrismaClient;

    const result = await getWholesaleRecentPurchases({
      account: { licenseeId: '72045' },
      config: getTenantConfig(),
      db,
      licenseeId: '72045',
    });

    assert.equal(result.tracked.count, 1);
    assert.equal(result.all.count, 2);
    assert.equal(result.all.purchaseLineCount, 3);
    assert.equal(result.all.totalBottlesSold, 6);
    assert.deepEqual(result.all.items.map((item) => item.itemCode), ['0100A', '0200B']);
    assert.equal(result.tracked.items[0].itemCode, '0100A');
    assert.equal(result.tracked.items[0].totalBottlesSold, 5);
    assert.equal(result.tracked.items[0].purchaseLineCount, 2);
    assert.equal(result.tracked.items[0].agencyCount, 2);
    assert.equal(result.productLabel, 'Echo');

    const otherTenantResult = await getWholesaleRecentPurchases({
      account: { licenseeId: '72045' },
      config: otherTenantConfig,
      db,
    });
    assert.deepEqual(otherTenantResult.tracked.items.map((item) => item.itemCode), ['0200B']);
    assert.equal(otherTenantResult.tracked.totalBottlesSold, 1);
    assert.equal(otherTenantResult.productLabel, 'Other Distillery');
    assert.deepEqual(otherTenantResult.all, result.all);
    for (const where of whereClauses) {
      assert.equal((where as { brand?: unknown }).brand, undefined);
      assert.ok((where as { OR: unknown[] }).OR.length > 0);
    }
  });
});

describe('getAgencyRecentItemSales', () => {
  it('uses the selected organization products for both sales windows', async () => {
    const whereClauses: unknown[] = [];
    const db = {
      ohlqAnnualSalesRow: {
        findFirst: async () => ({ reportDate: new Date('2026-05-12T00:00:00.000Z') }),
        groupBy: async ({ where }: { where: unknown }) => {
          whereClauses.push(where);
          return [{ brand: '0200B', _max: { reportDate: new Date('2026-05-12T00:00:00.000Z') }, _sum: { retailBottlesSold: 2, wholesaleBottlesSold: 0 } }];
        },
      },
      ohlqBrandMasterItem: { findMany: async () => [{ itemCode: '0200B', name: 'Zeta Whiskey' }] },
    } as unknown as PrismaClient;

    const windows = await getAgencyRecentItemSales({ agencyId: '10101', config: otherTenantConfig, db });
    assert.equal(whereClauses.length, 2);
    for (const where of whereClauses) {
      assert.deepEqual((where as { brand: unknown }).brand, { in: ['0200B'] });
      assert.equal((where as { agencyId: string }).agencyId, '10101');
    }
    assert.deepEqual(windows.map((window) => window.items.map((item) => item.itemCode)), [['0200B'], ['0200B']]);
  });
});

describe('summarizeLinkedWholesaleAccountSales', () => {
  it('populates every linked account from raw permit sales, including Echo volume', () => {
    const result = summarizeLinkedWholesaleAccountSales({
      accounts: [
        { id: 'account-1', licenseeId: '1998001', licenseeIds: [] },
        { id: 'account-2', licenseeId: '72045', licenseeIds: [] },
      ],
      rows: [
        { brand: '2847B', permitNumber: '01998001-1', vendor: ECHO_VENDOR_ID, wholesaleBottlesSold: 9 },
        { brand: 'OTHER', permitNumber: '01998001-1', vendor: 'OTHER', wholesaleBottlesSold: 12 },
      ],
    });

    assert.deepEqual(result.get('account-1'), { accountId: 'account-1', allBottles: 21, echoBottles: 9 });
    assert.deepEqual(result.get('account-2'), { accountId: 'account-2', allBottles: 0, echoBottles: 0 });
  });
});

describe('normalizeOhlqId', () => {
  it('normalizes without removing meaningful formatting', () => {
    assert.equal(normalizeOhlqId(' 00072045-1 '), '00072045-1');
    assert.equal(normalizeOhlqId('t40949003'), 'T40949003');
    assert.equal(normalizeOhlqId(''), null);
  });
});

describe('getOhlqWindowStartDate', () => {
  it('uses inclusive report-date windows', () => {
    assert.equal(getOhlqWindowStartDate(new Date('2026-05-12T00:00:00.000Z'), 7).toISOString(), '2026-05-06T00:00:00.000Z');
    assert.equal(getOhlqWindowStartDate(new Date('2026-05-12T00:00:00.000Z'), 30).toISOString(), '2026-04-13T00:00:00.000Z');
  });
});

describe('toAgencySalesSummaryItems', () => {
  it('aggregates and labels item-code sales rows', () => {
    const items = toAgencySalesSummaryItems(
      [
        {
          brand: '0100A',
          _max: { reportDate: new Date('2026-05-12T00:00:00.000Z') },
          _sum: { retailBottlesSold: 8, wholesaleBottlesSold: 4 },
        },
        {
          brand: '0200B',
          _max: { reportDate: new Date('2026-05-10T00:00:00.000Z') },
          _sum: { retailBottlesSold: 2, wholesaleBottlesSold: 0 },
        },
      ],
      new Map([
        ['0100A', 'Echo Vodka'],
        ['0200B', 'Echo Rum'],
      ]),
    );

    assert.deepEqual(items.map((item) => item.itemCode), ['0100A', '0200B']);
    assert.equal(items[0].itemName, 'Echo Vodka');
    assert.equal(items[0].totalBottlesSold, 12);
    assert.equal(items[0].mostRecentSaleDate, '2026-05-12');
  });

  it('keeps item-code displays readable while waiting for the brand master lookup', () => {
    const items = toAgencySalesSummaryItems(
      [
        {
          brand: '0300C',
          _max: { reportDate: new Date('2026-05-12T00:00:00.000Z') },
          _sum: { retailBottlesSold: 1, wholesaleBottlesSold: 0 },
        },
      ],
      new Map(),
    );

    assert.equal(items[0].itemCode, '0300C');
    assert.equal(items[0].itemName, 'Name pending');
  });
});
