import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { getAgencyMarketEligibleItemCodes } from '../lib/agencyMarketEligibility';
import { getAgencyMarketFitsForDisplay } from '../lib/agencyMarketIntelligenceService';

test('agency candidates require active status and store-distribution evidence', () => {
  const codes = ['ACTIVE', 'DELISTED', 'DIST', 'DIST-LONG', 'DIAGNOSTIC', 'UNLISTED', 'UNKNOWN', 'STALE-STATUS'];
  const catalog = codes.map((itemCode) => ({ itemCode, solItemStatusCode: itemCode === 'DELISTED' ? '30' : itemCode === 'UNKNOWN' ? null : '70' }));
  const listings = codes.filter((code) => code !== 'UNLISTED').map((itemCode) => ({
    itemCode,
    detailCodeDescription: itemCode === 'DIST' ? ' a3a dist ' : itemCode === 'DIST-LONG' ? 'A3A Distillery Only' : 'A3A Bailment',
    status: itemCode === 'STALE-STATUS' ? 'Delisted' : 'Active',
  }));
  assert.deepEqual([...getAgencyMarketEligibleItemCodes({ catalog, listings, diagnostics: { distilleryOnlyItemCodes: ['DIAGNOSTIC'] } })], ['ACTIVE']);
  assert.equal(listings.length, 7, 'the filter must not mutate inventory');
});

test('a statewide store listing permits entry/expansion without local stock or positive on-hand', () => {
  const eligible = getAgencyMarketEligibleItemCodes({
    catalog: [{ itemCode: 'NEW-TO-AGENCY', solItemStatusCode: ' 70 ' }],
    listings: [{ itemCode: 'NEW-TO-AGENCY', detailCodeDescription: 'A3A Bailment', status: 'Active' }],
    diagnostics: null,
  });
  assert.equal(eligible.has('NEW-TO-AGENCY'), true);
  assert.equal(getAgencyMarketEligibleItemCodes({ catalog: [{ itemCode: 'UNKNOWN-LISTING', solItemStatusCode: '70' }], listings: [], diagnostics: null }).size, 0);
});

test('saved fits recheck current eligibility and tenant decisions before top-five display', async () => {
  const fits = ['DELISTED', 'DIST', 'INACTIVE', 'GOOD', 'MISSING'].map((itemCode) => ({ itemCode, currentPlacement: true }));
  const scoped: Array<{ where: Record<string, unknown> }> = [];
  const record = (args: { where: Record<string, unknown> }) => { scoped.push(args); };
  const db = {
    agencyProductMarketFit: { findMany: async (args: { where: Record<string, unknown> }) => { record(args); return fits; } },
    ohlqBrandMasterItem: { findMany: async () => fits.filter((fit) => fit.itemCode !== 'MISSING').map((fit) => ({ itemCode: fit.itemCode, solItemStatusCode: fit.itemCode === 'DELISTED' ? '30' : '70' })) },
    ohlqAgencyInventoryCurrent: { findMany: async (args: { where: Record<string, unknown> }) => { record(args); assert.equal('agencyId' in args.where, false); return fits.map((fit) => ({ itemCode: fit.itemCode, status: 'Active', detailCodeDescription: 'A3A Bailment' })); } },
    ohlqTenantInventoryImportStatus: { findFirst: async (args: { where: Record<string, unknown> }) => { record(args); return { diagnostics: { distilleryOnlyItemCodes: ['DIST'] } }; } },
    organizationProduct: { findMany: async (args: { where: Record<string, unknown> }) => { record(args); assert.equal(args.where.active, true); assert.equal(args.where.discontinued, false); return fits.filter((fit) => fit.itemCode !== 'INACTIVE').map((fit) => ({ externalItemCode: fit.itemCode })); } },
  } as unknown as PrismaClient;
  assert.deepEqual((await getAgencyMarketFitsForDisplay({ db, agencyId: 'agency-10562', organizationId: 'tenant-a' })).map((fit) => fit.itemCode), ['GOOD']);
  assert.ok(scoped.every((args) => args.where.organizationId === 'tenant-a'));
  assert.equal(fits.length, 5, 'saved fits and inventory history remain untouched');
});

test('empty saved fits need no catalog queries and inventory display stays independent', async () => {
  const db = { agencyProductMarketFit: { findMany: async () => [] } } as unknown as PrismaClient;
  assert.deepEqual(await getAgencyMarketFitsForDisplay({ db, agencyId: 'agency', organizationId: 'tenant' }), []);
  const service = readFileSync('lib/agencyMarketIntelligenceService.ts', 'utf8');
  assert.match(service, /if \(!master \|\| !eligibleItemCodes\.has\(master\.itemCode\)\) return \[\]/);
  const inventory = readFileSync('app/agencies/AgencyIntelligencePanel.tsx', 'utf8');
  assert.match(inventory, /const currentInventory = products\.filter\(\(product\) => product\.inventorySnapshotDate !== null\)/);
  assert.doesNotMatch(inventory, /getAgencyMarketEligibleItemCodes/);
});
