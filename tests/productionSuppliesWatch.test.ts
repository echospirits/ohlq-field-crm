import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { isWatchedSupplyOrder, isWatchedSupplyOrderRecord, scopeSupplyEvidence, watchedSupplyOrderWhere } from '../lib/productionSupplies/watch';
import type { WatchedSupplyMaterial } from '../lib/productionSupplies/statusDomain';

const now = new Date('2026-11-12T12:00:00Z');
const watched = { key: 'catalog-one:facility', material: 'Raisins', location: 'Fixture facility', unit: 'lb', catalogItemId: 'catalog-one', aliases: ['Raisins', 'RAW-0042'], vendorRefs: [{ supplier: 'Fixture supplier', sku: 'SUPPLIER-42' }], needIds: ['need-one'], latestWarningAt: now, sharedUse: false } as WatchedSupplyMaterial;
function watchDb(options: { noWatch?: boolean; orders?: Array<Record<string, unknown>>; opaque?: boolean } = {}) {
  const queries: Array<Record<string, unknown>> = [];
  const item = { id: 'catalog-one', name: 'Raisins', confirmed: true, sharedUse: false, departments: ['PRODUCTION'], aliases: [{ alias: 'RAW-0042', supplier: '', sku: '' }, { alias: 'supplier raisins', supplier: 'Fixture supplier', sku: 'SUPPLIER-42' }], rules: [] };
  const need = { id: 'need-one', description: options.opaque ? 'RAW-0042' : 'Raisins', location: 'Fixture facility', unit: 'lb', catalogItemId: options.opaque ? null : 'catalog-one', createdAt: now, latestWarningAt: now, source: 'DISTILLX5_EMAIL', resolvedAt: null, warnings: [], allocations: [], catalogItem: options.opaque ? null : item };
  const db = {
    supplyNeed: { findMany: async (args: Record<string, unknown>) => { queries.push(args); return options.noWatch ? [] : [need]; } },
    supplyClassificationRule: { findMany: async () => [{ active: true, catalogItemId: 'catalog-one', supplier: 'Fixture supplier', sku: 'SUPPLIER-42' }] },
    supplyCatalogItem: { findMany: async () => options.opaque || options.noWatch ? [] : [item] },
    supplyOrder: {
      findMany: async (args: Record<string, unknown>) => { queries.push(args); return options.orders ?? []; },
      findFirst: async (args: Record<string, unknown>) => { queries.push(args); const where = args.where as { organizationId: string; id: string }; return options.orders?.find(order => order.organizationId === where.organizationId && order.id === where.id) ?? null; },
    },
  };
  return { db: db as unknown as PrismaClient, queries };
}

test('only Dx5 warning provenance opens watches; quotes and generic warnings create no operational facts', async () => {
  const fake = watchDb({ noWatch: true });
  const dx5 = { kind: 'WARNING', warningSource: 'DISTILLX5_EMAIL', warning: { material: 'RAW-0042' } };
  assert.equal((await scopeSupplyEvidence('tenant-one', dx5, fake.db)).evidence, dx5);
  for (const evidence of [{ kind: 'WARNING', warningSource: 'OTHER_EMAIL' }, { kind: 'QUOTE' }, { kind: 'OTHER' }, { kind: 'ORDER', supplier: 'Fixture supplier', lines: [{ description: 'Raisins' }] }]) {
    assert.equal((await scopeSupplyEvidence('tenant-one', evidence, fake.db)).evidence, null);
  }
});

test('mixed invoice retains only watched material operational lines without changing retained source facts', async () => {
  const fake = watchDb();
  const original = { kind: 'ORDER', supplier: 'Fixture supplier', destination: 'Fixture facility', orderReference: 'ORDER-42', lines: [{ description: 'Raisins', sku: 'SUPPLIER-42', quantity: 20, unit: 'lb' }, { description: 'Unrelated bar supplies', sku: 'UNRELATED', quantity: 1, unit: 'case' }], shipments: [{ referenceType: 'PARCEL', reference: 'FIXTURE12345', carrier: 'UPS' }] };
  const result = await scopeSupplyEvidence('tenant-one', original, fake.db);
  assert.equal(result.evidence?.lines.length, 1);
  assert.equal(result.evidence?.lines[0].description, 'Raisins');
  assert.equal(original.lines.length, 2);
  assert.equal(result.evidence?.shipments.length, 1);
  assert.ok(fake.queries.every(query => (query.where as { organizationId: string }).organizationId === 'tenant-one'));
});

test('raw Dx5 IDs never become guessed supplier SKU identities or supplier-wide matches', async () => {
  const fake = watchDb({ opaque: true });
  for (const line of [{ description: 'Raisins', sku: 'RAW-0042' }, { description: 'Unrelated bar item', sku: 'RAW-0042' }, { description: 'Different material', sku: 'SUPPLIER-42' }]) {
    const result = await scopeSupplyEvidence('tenant-one', { kind: 'ORDER', supplier: 'Fixture supplier', lines: [line] }, fake.db);
    assert.equal(result.evidence, null);
  }
});

test('line-free shipping/cancellation updates require one exact watched order and consistent destination', async () => {
  const order = { id: 'order-one', organizationId: 'tenant-one', supplier: 'Fixture supplier', destination: 'Fixture facility', ignored: false, lines: [{ description: 'Raisins', catalogItemId: 'catalog-one', ignored: false, unit: 'lb', allocations: [] }] };
  const update = { kind: 'SHIPMENT', supplier: 'Fixture supplier', orderReference: 'ORDER-42', destination: 'Fixture facility', orderStatus: 'CANCELLED', lines: [], shipments: [] };
  assert.ok((await scopeSupplyEvidence('tenant-one', update, watchDb({ orders: [order] }).db)).evidence);
  assert.equal((await scopeSupplyEvidence('tenant-one', { ...update, destination: 'Conflicting facility' }, watchDb({ orders: [order] }).db)).evidence, null);
  assert.equal((await scopeSupplyEvidence('tenant-one', update, watchDb({ orders: [order, { ...order, id: 'ambiguous' }] }).db)).evidence, null);
  assert.equal((await scopeSupplyEvidence('tenant-one', update, watchDb({ orders: [{ ...order, lines: [{ description: 'Unrelated material', ignored: false, allocations: [] }] }] }).db)).evidence, null);
});

test('tracking scope preserves tenant boundary, ignores ignored lines/orders, and accepts explicit watched allocation', async () => {
  const order = { id: 'order-one', organizationId: 'tenant-one', supplier: 'Fixture supplier', destination: 'Fixture facility', ignored: false, lines: [{ description: 'Retained supplier description', ignored: false, allocations: [{ needId: 'need-one' }] }] };
  assert.equal(isWatchedSupplyOrderRecord(order, [watched]), true);
  assert.equal(isWatchedSupplyOrderRecord({ ...order, ignored: true }, [watched]), false);
  assert.equal(isWatchedSupplyOrderRecord({ ...order, destination: 'Conflicting facility' }, [watched]), false);
  assert.equal(isWatchedSupplyOrderRecord({ ...order, lines: [{ ...order.lines[0], ignored: true }] }, [watched]), false);
  const fake = watchDb({ orders: [order] });
  assert.equal(await isWatchedSupplyOrder('tenant-two', 'order-one', fake.db, [watched]), false);
  assert.equal(await isWatchedSupplyOrder('tenant-one', 'order-one', fake.db, [watched]), true);
  assert.equal(watchedSupplyOrderWhere('tenant-one', [watched]).organizationId, 'tenant-one');
});
