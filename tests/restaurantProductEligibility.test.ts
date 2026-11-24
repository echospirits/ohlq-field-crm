import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { isRestaurantProductRestricted, loadRestaurantProductRestrictions } from '../lib/restaurantProductEligibility';

test('restaurant restrictions use known delistings and completed tenant inventory classification', async () => {
  const calls: Record<string, unknown> = {};
  const db = {
    ohlqBrandMasterItem: {
      findMany: async (args: unknown) => {
        calls.catalog = args;
        return [
          { itemCode: 'DELISTED', solItemStatusCode: ' 30 ' },
          { itemCode: 'OTHER', solItemStatusCode: '130' },
        ];
      },
    },
    ohlqTenantInventoryImportStatus: {
      findFirst: async (args: unknown) => {
        calls.report = args;
        return { diagnostics: { distilleryOnlyItemCodes: [' diagnostic-only ', 'DELISTED'] } };
      },
    },
    ohlqAgencyInventoryCurrent: {
      groupBy: async (args: unknown) => {
        calls.inventory = args;
        return [
          { itemCode: 'SHORT', detailCodeDescription: 'a-3a   dist', status: 'Active' },
          { itemCode: 'LONG', detailCodeDescription: 'A3A Distillery Only', status: 'Active' },
          { itemCode: 'LONG', detailCodeDescription: 'A3A Bailment', status: 'Delisted' },
          { itemCode: 'DUAL', detailCodeDescription: 'A3A DIST', status: 'Active' },
          { itemCode: 'DUAL', detailCodeDescription: 'A3A BAILMENT', status: 'Active' },
          { itemCode: 'SPECIAL', detailCodeDescription: 'A3A Distillery Only Special', status: 'Active' },
        ];
      },
    },
  } as unknown as PrismaClient;

  const restricted = await loadRestaurantProductRestrictions('echo', db);
  assert.deepEqual([...restricted].sort(), ['DELISTED', 'DIAGNOSTIC-ONLY', 'LONG', 'SHORT']);
  assert.equal(isRestaurantProductRestricted(' diagnostic-only ', restricted), true);
  assert.equal(isRestaurantProductRestricted('other', restricted), false);
  assert.deepEqual(calls.catalog, {
    where: { solItemStatusCode: { contains: '30' } },
    select: { itemCode: true, solItemStatusCode: true },
  });
  assert.deepEqual(calls.report, {
    where: { organizationId: 'echo', status: 'COMPLETED' },
    orderBy: [{ reportDate: 'desc' }, { updatedAt: 'desc' }],
    select: { diagnostics: true },
  });
  assert.deepEqual(calls.inventory, {
    where: { organizationId: 'echo' },
    by: ['itemCode', 'detailCodeDescription', 'status'],
  });

  delete calls.catalog;
  const preloaded = await loadRestaurantProductRestrictions('echo', db, [
    { itemCode: 'NEW', solItemStatusCode: '30' },
  ]);
  assert.equal(preloaded.has('NEW'), true);
  assert.equal(calls.catalog, undefined);
});
