import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { evaluateOpportunityIntelligence } from '../lib/opportunityEngine';
import { forEachInBatches } from '../lib/forEachInBatches';

function fixture(failId?: string) {
  const ids = Array.from({ length: 9 }, (_, index) => `account-${index}`);
  const completed = new Set<string>();
  const started: string[] = [];
  let active = 0;
  let peak = 0;
  const db = {
    organization: { findUnique: async () => ({ id: 'tenant', appName: 'CRM', digestName: 'CRM', displayName: 'Tenant', productLabel: 'Tenant', productPluralLabel: 'Tenant products', products: [], vendorIdentifiers: [] }) },
    ohlqBrandMasterItem: { findMany: async () => [] },
    organizationProduct: { findMany: async () => [] },
    ohlqTenantInventoryImportStatus: { findFirst: async () => null },
    ohlqAgencyInventoryCurrent: { findMany: async () => [] },
    wholesaleAccount: { findMany: async ({ select }: { select: Record<string, unknown> }) => select.licenseeIds
      ? ids.map(id => ({ id, licenseeId: id, licenseeIds: [] }))
      : ids.map(id => ({ id, name: id, targetProfiles: [], opportunitySignals: [], tags: [], targetPublicResearch: null })) },
    ohlqAnnualSalesByWholesaleRow: { findMany: async () => [] },
    salesOpportunity: {
      findMany: async ({ where }: { where: { organizationId: string; wholesaleAccountId?: string } }) => {
        assert.equal(where.organizationId, 'tenant');
        if (where.wholesaleAccountId) assert.ok(completed.has(where.wholesaleAccountId), 'signal write must finish before later account operations');
        return [];
      },
      updateMany: async () => ({ count: 0 }),
    },
    organizationAccountOverlay: { findMany: async () => [] },
    accountSalesEvent: { findMany: async () => [], createMany: async () => ({ count: 0 }) },
    loggedVisit: { findMany: async () => [] },
    worklistItem: { findMany: async () => [] },
    opportunityModelVersion: { findFirst: async () => ({ id: 'model' }) },
    opportunityAccountSignal: {
      upsert: async ({ where, create }: { where: { organizationId_wholesaleAccountId: { organizationId: string; wholesaleAccountId: string } }; create: { organizationId: string; wholesaleAccountId: string } }) => {
        const key = where.organizationId_wholesaleAccountId;
        assert.equal(key.organizationId, 'tenant');
        assert.equal(create.organizationId, 'tenant');
        assert.equal(create.wholesaleAccountId, key.wholesaleAccountId);
        started.push(key.wholesaleAccountId);
        peak = Math.max(peak, ++active);
        try {
          if (key.wholesaleAccountId === failId) throw new Error('fixture failure');
          await delay(8);
          completed.add(key.wholesaleAccountId);
          return {};
        } finally { active--; }
      },
    },
  };
  return { db: db as unknown as PrismaClient, ids, completed, started, active: () => active, peak: () => peak };
}

test('full intelligence refresh bounds independent account writes and preserves tenant scope and account ordering', async () => {
  const f = fixture();
  const result = await evaluateOpportunityIntelligence({ db: f.db, organizationId: 'tenant', asOfDate: new Date('2026-09-27') });
  assert.equal(result.accountsEvaluated, f.ids.length);
  assert.deepEqual(f.started, f.ids);
  assert.equal(f.completed.size, f.ids.length);
  assert.equal(f.peak(), 4);
  assert.equal(f.active(), 0);
});

test('targeted intelligence refreshes stay serial', async () => {
  const f = fixture();
  await evaluateOpportunityIntelligence({ db: f.db, organizationId: 'tenant', accountIds: f.ids, asOfDate: new Date('2026-09-27') });
  assert.equal(f.peak(), 1);
  assert.deepEqual(f.started, f.ids);
});

test('intelligence previews remain ordered and perform no account writes', async () => {
  const f = fixture();
  const result = await evaluateOpportunityIntelligence({ db: f.db, organizationId: 'tenant', dryRun: true, asOfDate: new Date('2026-09-27') });
  assert.deepEqual(result.previews?.map(preview => preview.accountId), f.ids);
  assert.deepEqual(f.started, []);
});

test('an account failure settles started writes and stops before the next batch', async () => {
  const f = fixture('account-1');
  await assert.rejects(evaluateOpportunityIntelligence({ db: f.db, organizationId: 'tenant', asOfDate: new Date('2026-09-27') }), /fixture failure/);
  assert.equal(f.active(), 0);
  assert.deepEqual(f.started, f.ids.slice(0, 4));
  assert.equal(f.completed.size, 3);
});

test('a synchronous worker failure also drains started work before rejecting', async () => {
  let completed = false;
  await assert.rejects(forEachInBatches([0, 1, 2], 2, (value) => {
    if (value === 1) throw new Error('synchronous failure');
    return delay(8).then(() => { completed = true; });
  }), /synchronous failure/);
  assert.equal(completed, true);
});
