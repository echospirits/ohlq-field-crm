import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { getAgencyVisitContext } from '../lib/agencyVisitContext';

describe('Taster agency visit context', () => {
  it('returns only the compact inventory and recent-sales fields needed by the visit workflow', async () => {
    let productQuery: Record<string, unknown> | undefined;
    const db = {
      agency: {
        findUnique: async () => ({ id: 'agency-1' }),
      },
      agencyProductIntelligence: {
        findMany: async (query: Record<string, unknown>) => {
          productQuery = query;
          return [{
            asOfDate: new Date('2026-08-18T00:00:00.000Z'),
            inventoryStatus: 'Active',
            itemCode: '2847B',
            itemName: 'Echo Spirits Vodka',
            lastSaleDate: new Date('2026-08-17T00:00:00.000Z'),
            minimum: 3,
            onHand: 8,
            retailSales7: 2,
            retailSales30: 7,
          }];
        },
      },
    } as unknown as PrismaClient;

    const context = await getAgencyVisitContext({ agencyId: 'agency-1', db });

    assert.equal(context?.asOfDate, '2026-08-18T00:00:00.000Z');
    assert.deepEqual(context?.inventory[0], {
      inventoryStatus: 'Active',
      itemCode: '2847B',
      itemName: 'Echo Spirits Vodka',
      lastSaleDate: '2026-08-17T00:00:00.000Z',
      minimum: 3,
      onHand: 8,
      retailSales7: 2,
      retailSales30: 7,
    });
    assert.deepEqual(productQuery?.where, {
      agencyId: 'agency-1',
      inventorySnapshotDate: { not: null },
    });
  });

  it('returns null when the selected agency no longer exists', async () => {
    const db = {
      agency: { findUnique: async () => null },
    } as unknown as PrismaClient;

    assert.equal(await getAgencyVisitContext({ agencyId: 'missing', db }), null);
  });
});
