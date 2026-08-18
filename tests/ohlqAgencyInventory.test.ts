import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  getAgencyInventoryHistory,
  getAgencyInventorySnapshot,
  getAgenciesWithCurrentItem,
  getCurrentAgencyInventory,
  getCurrentAgencyItemInventory,
  getLatestInventorySnapshotDate,
  isTenantAgencyInventoryItem,
} from '../lib/ohlqAgencyInventory';

describe('agency inventory business rules', () => {
  it('protects downstream reads with the Echo vendor, exclusions, and distillery-only rule', () => {
    const base = {
      detailCodeDescription: 'A3A Bailment',
      itemCode: '2847B',
      vendorId: 'Z90399001',
    };

    assert.equal(isTenantAgencyInventoryItem(base), true);
    assert.equal(isTenantAgencyInventoryItem({ ...base, itemCode: '3150B' }), false);
    assert.equal(isTenantAgencyInventoryItem({ ...base, itemCode: '3750B' }), false);
    assert.equal(isTenantAgencyInventoryItem({ ...base, itemCode: '4359B' }), false);
    assert.equal(isTenantAgencyInventoryItem({ ...base, vendorId: 'OTHER' }), false);
    assert.equal(
      isTenantAgencyInventoryItem({ ...base, detailCodeDescription: ' a3a distillery only ' }),
      false,
    );
  });
});

describe('agency inventory query services', () => {
  it('uses the current-state table for current reads and latest-date lookup', async () => {
    const calls: Array<{ method: string; args: unknown }> = [];
    const latestDate = new Date('2026-08-18T00:00:00.000Z');
    const db = {
      ohlqAgencyInventoryCurrent: {
        findFirst: async (args: unknown) => {
          calls.push({ method: 'current.findFirst', args });
          return calls.length === 2 ? { snapshotDate: latestDate } : { itemCode: '2847B' };
        },
        findMany: async (args: unknown) => {
          calls.push({ method: 'current.findMany', args });
          return [{ itemCode: '2847B' }];
        },
      },
      ohlqAgencyInventorySnapshot: {
        findMany: async (args: unknown) => {
          calls.push({ method: 'snapshot.findMany', args });
          return [];
        },
      },
    } as unknown as PrismaClient;

    await getCurrentAgencyInventory({ agencyNumber: ' 10509 ', db });
    await getLatestInventorySnapshotDate({ db });
    await getCurrentAgencyItemInventory({ agencyNumber: '10509', db, itemCode: ' 2847b ' });
    await getAgenciesWithCurrentItem({ db, itemCode: '2847b' });

    assert.equal(calls.filter((call) => call.method === 'current.findMany').length, 2);
    assert.equal(calls.filter((call) => call.method === 'current.findFirst').length, 2);
    assert.equal(calls.filter((call) => call.method === 'snapshot.findMany').length, 0);
    assert.deepEqual(
      (calls[0].args as { where: { agencyNumber: string } }).where.agencyNumber,
      '10509',
    );
    assert.deepEqual(
      (calls[2].args as { where: { itemCode: string } }).where.itemCode,
      '2847B',
    );
  });

  it('queries history in chronological order and an exact coherent snapshot by date', async () => {
    const calls: unknown[] = [];
    const db = {
      ohlqAgencyInventorySnapshot: {
        findMany: async (args: unknown) => {
          calls.push(args);
          return [];
        },
      },
    } as unknown as PrismaClient;

    await getAgencyInventoryHistory({
      agencyNumber: '10509',
      db,
      itemCode: '2847B',
      range: { from: '2026-08-01', to: '2026-08-18' },
    });
    await getAgencyInventorySnapshot({ agencyNumber: '10509', db, snapshotDate: '2026-08-18' });

    const history = calls[0] as {
      orderBy: { snapshotDate: string };
      where: { snapshotDate: { gte: Date; lte: Date } };
    };
    assert.deepEqual(history.orderBy, { snapshotDate: 'asc' });
    assert.equal(history.where.snapshotDate.gte.toISOString(), '2026-08-01T00:00:00.000Z');
    assert.equal(history.where.snapshotDate.lte.toISOString(), '2026-08-18T00:00:00.000Z');

    const snapshot = calls[1] as { where: { snapshotDate: Date } };
    assert.equal(snapshot.where.snapshotDate.toISOString(), '2026-08-18T00:00:00.000Z');
  });
});
