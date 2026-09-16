import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { evaluateOpportunityIntelligence } from '../lib/opportunityEngine';

it('refreshes a pursued product without replacing its detection snapshot or converting for another owned item', async () => {
  const updates: Record<string, unknown>[] = [];
  let bulkStatusUpdates = 0;
  const originalHypothesis = { type: 'CATEGORY_CONQUEST', cycleKey: 'original', targetCategory: 'RUM', title: 'Introduce Tenant Rum', recommendedAction: 'Discuss Tenant Rum', explanation: ['Original evidence'], targetProduct: { itemCode: 'A', name: 'Tenant Rum', category: 'RUM', price750: 30, isLocal: false, priority: 1 } };
  const opportunity = { id: 'opp', organizationId: 'tenant', wholesaleAccountId: 'account', status: 'ACTIONED', type: 'CATEGORY_CONQUEST', cycleKey: 'original', targetCategory: 'RUM', productionScore: 80, detectedAt: new Date('2026-08-01'), actionedAt: new Date('2026-08-02'), signalSnapshot: { original: true } };
  const raw = [
    { brand: 'C', wholesaleBottlesSold: 12 },
    { brand: 'B', wholesaleBottlesSold: 12 },
  ].map(r => ({ ...r, reportDate: new Date('2026-09-03'), permitNumber: '12345', agencyId: '1', vendor: 'V' }));
  const catalog = [
    { itemCode: 'A', name: 'Tenant Rum', category: 'Rum', retailPrice: 30, productVolume: 25.4, solItemStatusCode: '70' },
    { itemCode: 'B', name: 'Tenant Vodka', category: 'Vodka', retailPrice: 10, productVolume: 25.4, solItemStatusCode: '70' },
    { itemCode: 'C', name: 'Competitor Rum', category: 'Rum', retailPrice: 30, productVolume: 25.4, solItemStatusCode: '70' },
  ];
  let availableItemCodes = ['A', 'B'];
  const db = {
    organization: { findUnique: async () => ({ id: 'tenant', appName: 'CRM', digestName: 'CRM', displayName: 'Tenant', productLabel: 'Tenant', productPluralLabel: 'Tenant products', products: [{ externalItemCode: 'A' }, { externalItemCode: 'B' }], vendorIdentifiers: [] }) },
    ohlqBrandMasterItem: { findMany: async () => catalog },
    organizationProduct: { findMany: async () => [{ externalItemCode: 'A' }, { externalItemCode: 'B' }] },
    ohlqTenantInventoryImportStatus: { findFirst: async () => ({ diagnostics: {} }) },
    ohlqAgencyInventoryCurrent: { findMany: async () => availableItemCodes.map(itemCode => ({ itemCode })) },
    wholesaleAccount: { findMany: async ({ select }: { select: Record<string, unknown> }) => select.licenseeIds
      ? [{ id: 'account', licenseeId: '12345', licenseeIds: [] }]
      : [{ id: 'account', name: 'Customer', targetProfiles: [], opportunitySignals: [], tags: [], targetPublicResearch: null }] },
    ohlqAnnualSalesByWholesaleRow: { findMany: async () => raw },
    salesOpportunity: {
      findMany: async ({ where, include }: { where: Record<string, unknown>; include?: Record<string, unknown> }) => where.rulesVersion ? [] : include?.events ? [{ ...opportunity, events: [{ metadata: { hypothesis: originalHypothesis } }] }] : [opportunity],
      update: async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); return { ...opportunity, ...data }; },
      updateMany: async () => { bulkStatusUpdates += 1; return { count: 0 }; },
    },
    organizationAccountOverlay: { findMany: async () => [] },
    accountSalesEvent: { findMany: async () => [], createMany: async () => ({ count: 2 }) },
    loggedVisit: { findMany: async () => [] },
    worklistItem: { findFirst: async () => ({ id: 'task' }), findMany: async () => [], updateMany: async () => ({ count: 1 }) },
    opportunityModelVersion: { findFirst: async () => ({ id: 'model' }) },
    opportunityAccountSignal: { upsert: async () => ({}) },
    opportunityEvent: { findFirst: async () => ({ metadata: { hypothesis: originalHypothesis } }), create: async () => ({}) },
    opportunityScore: { upsert: async () => ({}) },
  };
  const result = await evaluateOpportunityIntelligence({ db: db as unknown as PrismaClient, organizationId: 'tenant', asOfDate: new Date('2026-09-04') });
  assert.equal(result.converted, 0);
  assert.equal(result.detected, 0);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].title, 'Introduce Tenant Rum');
  assert.equal(updates[0].cycleKey, 'original');
  assert.equal('signalSnapshot' in updates[0], false);
  assert.equal('status' in updates[0], false);
  updates.length = 0;
  bulkStatusUpdates = 0;
  const scoreOnly = await evaluateOpportunityIntelligence({ db: db as unknown as PrismaClient, organizationId: 'tenant', asOfDate: new Date('2026-09-04'), scoreExistingOnly: true });
  assert.equal(scoreOnly.converted, 0);
  assert.equal(scoreOnly.detected, 0);
  assert.equal(scoreOnly.worklistCreated, 0);
  assert.equal(bulkStatusUpdates, 0);
  assert.equal(updates.length, 1);
  assert.equal('status' in updates[0], false);
  assert.equal('actionedAt' in updates[0], false);
  assert.equal('snoozedUntil' in updates[0], false);
  assert.equal('dismissedAt' in updates[0], false);
  catalog[0].solItemStatusCode = '30';
  updates.length = 0;
  await evaluateOpportunityIntelligence({ db: db as unknown as PrismaClient, organizationId: 'tenant', asOfDate: new Date('2026-09-04') });
  assert.equal(updates.length, 1);
  assert.notEqual(updates[0].title, 'Introduce Tenant Rum');
  assert.equal(updates[0].title, 'Active customer needing attention');
  catalog[0].solItemStatusCode = '70';
  availableItemCodes = ['B'];
  raw.splice(1, 1);
  updates.length = 0;
  await evaluateOpportunityIntelligence({ db: db as unknown as PrismaClient, organizationId: 'tenant', asOfDate: new Date('2026-09-04'), scoreExistingOnly: true });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].title, 'High-fit account');
  assert.equal('status' in updates[0], false);
  updates.length = 0;
  await evaluateOpportunityIntelligence({ db: db as unknown as PrismaClient, organizationId: 'tenant', asOfDate: new Date('2026-09-04') });
  assert.ok(updates.some(update => update.status === 'RESOLVED'));
  availableItemCodes = ['A', 'B'];
  raw.push({ ...raw[0], brand: 'A' });
  updates.length = 0;
  const converted = await evaluateOpportunityIntelligence({ db: db as unknown as PrismaClient, organizationId: 'tenant', asOfDate: new Date('2026-09-04') });
  assert.equal(converted.converted, 1);
  assert.ok(updates.some(update => update.status === 'CONVERTED'));
});
