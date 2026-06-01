import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { syncWholesaleAccountEchoPurchaseState } from '../lib/ohlqWholesalePurchaseState';

const purchaseRow = (overrides = {}) => ({
  brand: '0100A',
  permitNumber: '00072045-1',
  reportDate: new Date('2026-05-01T00:00:00.000Z'),
  vendor: 'Z90399001',
  wholesaleBottlesSold: 2,
  ...overrides,
});

describe('syncWholesaleAccountEchoPurchaseState', () => {
  it('updates the latest Echo purchase state for matching wholesale accounts', async () => {
    const updates: unknown[] = [];
    const db = {
      account: {
        findMany: async () => [],
      },
      ohlqBrandMasterItem: {
        findMany: async () => [{ itemCode: '0100A', name: 'Echo Vodka' }],
      },
      wholesaleAccount: {
        findMany: async () => [
          {
            address: '123 N Main St',
            city: 'Columbus',
            id: 'wholesale-1',
            licenseeId: '72045',
            name: 'Adriennes White Rabbit',
            officialAccountId: null,
            state: 'OH',
            zip: '43215',
          },
        ],
        updateMany: async ({ data }: { data: unknown }) => {
          updates.push(data);
          return { count: 1 };
        },
      },
    } as unknown as PrismaClient;

    const result = await syncWholesaleAccountEchoPurchaseState({
      db,
      rows: [
        purchaseRow(),
        purchaseRow({ brand: '3150B', reportDate: new Date('2026-05-02T00:00:00.000Z') }),
        purchaseRow({ vendor: 'OTHER', reportDate: new Date('2026-05-03T00:00:00.000Z') }),
      ],
    });

    assert.equal(result.matchedPermitNumbers, 1);
    assert.equal(result.skippedRows, 2);
    assert.deepEqual(result.unmatchedPermitNumbers, []);
    assert.equal(result.updatedAccounts, 1);
    const update = updates[0] as {
      ohlqLastEchoPurchaseBottles: number;
      ohlqLastEchoPurchaseDate: Date;
      ohlqLastEchoPurchaseItemCode: string;
      ohlqLastEchoPurchaseItemName: string;
      ohlqLastEchoPurchaseUpdatedAt: Date;
    };
    assert.equal(update.ohlqLastEchoPurchaseBottles, 2);
    assert.equal(update.ohlqLastEchoPurchaseDate.toISOString(), '2026-05-01T00:00:00.000Z');
    assert.equal(update.ohlqLastEchoPurchaseItemCode, '0100A');
    assert.equal(update.ohlqLastEchoPurchaseItemName, 'Echo Vodka');
    assert.ok(update.ohlqLastEchoPurchaseUpdatedAt instanceof Date);
  });

  it('matches a sales permit to an active wholesale account through same-address official records', async () => {
    const updates: unknown[] = [];
    let wholesaleFindCount = 0;
    const db = {
      account: {
        findMany: async () => [
          {
            address: '123 North Main Street',
            city: 'Columbus',
            id: 'official-1',
            licenseeId: '00072045-1',
            officialWholesale: null,
            state: 'OH',
            zip: '43215',
          },
        ],
      },
      ohlqBrandMasterItem: {
        findMany: async () => [{ itemCode: '0100A', name: 'Echo Vodka' }],
      },
      wholesaleAccount: {
        findMany: async () => {
          wholesaleFindCount += 1;
          return wholesaleFindCount === 1
            ? []
            : [
                {
                  address: '123 N Main St.',
                  city: 'COLUMBUS',
                  id: 'wholesale-1',
                  licenseeId: 'manual-old-id',
                  name: 'Adriennes White Rabbit',
                  officialAccountId: null,
                  state: 'Ohio',
                  zip: '43215-1234',
                },
              ];
        },
        updateMany: async ({ data }: { data: unknown }) => {
          updates.push(data);
          return { count: 1 };
        },
      },
    } as unknown as PrismaClient;

    const result = await syncWholesaleAccountEchoPurchaseState({
      db,
      rows: [purchaseRow()],
    });

    assert.equal(result.matchedPermitNumbers, 1);
    assert.equal(result.updatedAccounts, 1);
    assert.equal(updates.length, 1);
  });

  it('matches sales permits against secondary wholesale Licensee IDs', async () => {
    const updates: unknown[] = [];
    const db = {
      account: {
        findMany: async () => [],
      },
      ohlqBrandMasterItem: {
        findMany: async () => [{ itemCode: '0100A', name: 'Echo Vodka' }],
      },
      wholesaleAccount: {
        findMany: async () => [
          {
            address: null,
            city: null,
            id: 'wholesale-1',
            licenseeId: 'PRIMARY-1',
            licenseeIds: [{ licenseeId: '00072045-1' }],
            name: 'Alias Buyer',
            officialAccountId: null,
            state: 'OH',
            zip: null,
          },
        ],
        updateMany: async ({ data }: { data: unknown }) => {
          updates.push(data);
          return { count: 1 };
        },
      },
    } as unknown as PrismaClient;

    const result = await syncWholesaleAccountEchoPurchaseState({
      db,
      rows: [purchaseRow()],
    });

    assert.equal(result.matchedPermitNumbers, 1);
    assert.equal(result.updatedAccounts, 1);
    assert.equal(updates.length, 1);
  });
});
