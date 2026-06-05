import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  ECHO_VENDOR_ID,
  getWholesaleRecentPurchases,
  getOhlqWindowStartDate,
  isEchoItem,
  normalizeOhlqId,
  toAgencySalesSummaryItems,
} from '../lib/ohlqSalesData';

describe('OHLQ Echo item filtering', () => {
  it('includes Echo vendor rows and excludes item code 3150B', () => {
    assert.equal(isEchoItem(ECHO_VENDOR_ID, '0100A'), true);
    assert.equal(isEchoItem(ECHO_VENDOR_ID.toLowerCase(), '0100A'), true);
    assert.equal(isEchoItem(ECHO_VENDOR_ID, '3150B'), false);
    assert.equal(isEchoItem('000000932', '0100A'), false);
  });
});

describe('getWholesaleRecentPurchases', () => {
  it('matches permit suffix variants and aggregates purchases by item name', async () => {
    const db = {
      account: {
        findMany: async () => [],
      },
      ohlqAnnualSalesByWholesaleRow: {
        findFirst: async () => ({ reportDate: new Date('2026-05-12T00:00:00.000Z') }),
        findMany: async () => [
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
        ],
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
      db,
      licenseeId: '72045',
    });

    assert.equal(result.all.count, 2);
    assert.deepEqual(
      result.all.items.map((item) => item.itemName),
      ['Alpha Vodka', 'Zeta Whiskey'],
    );
    assert.equal(result.all.purchaseLineCount, 3);
    assert.equal(result.all.items[0].totalBottlesSold, 5);
    assert.equal(result.all.items[0].purchaseLineCount, 2);
    assert.equal(result.all.items[0].agencyCount, 2);
    assert.equal(result.echo.count, 1);
    assert.equal(result.echo.items[0].itemCode, '0100A');
    assert.equal(result.echo.items[0].totalBottlesSold, 5);
    assert.equal(result.tracked.count, 1);
    assert.equal(result.productLabel, 'Echo');
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
