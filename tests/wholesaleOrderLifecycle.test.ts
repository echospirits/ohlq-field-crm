import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertWholesaleOrderTotals,
  hashWholesaleOrderRequest,
  MAX_WHOLESALE_ORDER_TOTAL_CENTS,
  parseWholesaleOrderDate,
  markWholesaleOrderFiledManually,
  markWholesaleOrderSent,
  persistGeneratedWholesaleOrder,
  WholesaleOrderLifecycleError,
  wholesaleOrderSnapshotSchema,
} from '../lib/wholesaleOrders';
import type { PrismaClient } from '@prisma/client';

const snapshot = wholesaleOrderSnapshotSchema.parse({
  version: 1,
  a3aSignature: 'Sales Person',
  customerSignature: '',
  saleDate: '2026-09-10',
  customer: { address: '1 Main St', city: 'Columbus', dba: 'Customer DBA', f2Permit: false, name: 'Customer LLC', permitNumber: '10012465-1-2', phone: '', postalCode: '43215', state: 'OH' },
  seller: { addressLine1: '2 Seller Ave', city: 'Columbus', email: '', name: 'Seller', phone: '', postalCode: '43212', state: 'OH', storeId: '90399' },
  lines: [{ itemCode: '2849B', itemName: 'Genever', quantityBottles: 3, unitPriceCents: 3384, wholesalePrice: 33.84, vendor: '000123' }],
  totals: { subtotalCents: 10152, sinTaxCents: 0, totalCents: 10152 },
});

test('wholesale order request hashes are stable across object key order and detect changed details', () => {
  const first = { saleDate: '2026-09-10', customer: { name: 'Customer', permitNumber: '10012465-1-2' }, lines: [{ itemCode: '2849B', quantityBottles: 3 }] };
  const reordered = { lines: [{ quantityBottles: 3, itemCode: '2849B' }], customer: { permitNumber: '10012465-1-2', name: 'Customer' }, saleDate: '2026-09-10' };
  assert.equal(hashWholesaleOrderRequest(first), hashWholesaleOrderRequest(reordered));
  assert.notEqual(hashWholesaleOrderRequest(first), hashWholesaleOrderRequest({ ...first, lines: [{ itemCode: '2849B', quantityBottles: 4 }] }));
});

test('wholesale order dates reject rollover dates and accept leap days', () => {
  assert.equal(parseWholesaleOrderDate('2026-02-29'), null);
  assert.equal(parseWholesaleOrderDate('2026-13-01'), null);
  assert.equal(parseWholesaleOrderDate('not-a-date'), null);
  assert.equal(parseWholesaleOrderDate('2028-02-29')?.toISOString(), '2028-02-29T00:00:00.000Z');
});

test('wholesale order totals remain within PostgreSQL integer storage', () => {
  assert.equal(assertWholesaleOrderTotals(MAX_WHOLESALE_ORDER_TOTAL_CENTS - 100, 100), MAX_WHOLESALE_ORDER_TOTAL_CENTS);
  assert.throws(
    () => assertWholesaleOrderTotals(MAX_WHOLESALE_ORDER_TOTAL_CENTS, 1),
    (error) => error instanceof WholesaleOrderLifecycleError && error.message.includes('supported range'),
  );
});

test('immutable wholesale order snapshots retain permit suffix, seller store, vendor, and line quantities', () => {
  assert.equal(snapshot.customer.permitNumber, '10012465-1-2');
  assert.deepEqual(snapshot.lines.map(({ itemCode, quantityBottles, vendor }) => ({ itemCode, quantityBottles, vendor })), [{ itemCode: '2849B', quantityBottles: 3, vendor: '000123' }]);
  assert.equal(snapshot.seller.storeId, '90399');
});

const generatedInput = {
  organizationId: 'org-a', wholesaleAccountId: 'account-a', directSaleLocationId: 'location-a', createdByUserId: 'user-a',
  clientRequestId: '4ab7d3ee-4fe3-4cab-bfcb-9214804f20f4', requestHash: 'hash-a', snapshot,
  pdfBytes: Uint8Array.from([37, 80, 68, 70]), pdfFilename: 'order.pdf',
};

function makePersistenceDb() {
  let stored: Record<string, unknown> | null = null;
  let creates = 0;
  const wholesaleOrder = {
    findUnique: async () => stored,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      creates += 1;
      stored = { id: 'order-a', status: 'PDF_GENERATED', ...data };
      return stored;
    },
  };
  const tx = { $executeRaw: async () => 1, wholesaleOrder };
  const db = {
    wholesaleOrder,
    $transaction: async (callback: (value: typeof tx) => unknown) => callback(tx),
  } as unknown as PrismaClient;
  return { db, getCreates: () => creates };
}

test('retrying the same client request returns the persisted PDF without a duplicate', async () => {
  const fake = makePersistenceDb();
  const first = await persistGeneratedWholesaleOrder(generatedInput, fake.db);
  const retry = await persistGeneratedWholesaleOrder(generatedInput, fake.db);
  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(retry.order.id, first.order.id);
  assert.equal(fake.getCreates(), 1);
});

test('reusing a client request id with changed details is rejected', async () => {
  const fake = makePersistenceDb();
  await persistGeneratedWholesaleOrder(generatedInput, fake.db);
  await assert.rejects(
    persistGeneratedWholesaleOrder({ ...generatedInput, requestHash: 'different-hash' }, fake.db),
    (error) => error instanceof WholesaleOrderLifecycleError && error.code === 'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(fake.getCreates(), 1);
});

function makeStatusDb(initial: { id: string; organizationId: string; status: 'PDF_GENERATED' | 'SENT' | 'FILED' }) {
  let order: Record<string, unknown> = { ...initial, sentAt: null, sentByUserId: null, filedAt: null, filedByUserId: null, filedSource: null };
  const wholesaleOrder = {
    findFirst: async ({ where }: { where: { id: string; organizationId: string } }) => where.id === order.id && where.organizationId === order.organizationId ? order : null,
    update: async ({ data }: { data: Record<string, unknown> }) => { order = { ...order, ...data }; return order; },
  };
  const tx = { $executeRaw: async () => 1, wholesaleOrder };
  return {
    db: { $transaction: async (callback: (value: typeof tx) => unknown) => callback(tx) } as unknown as PrismaClient,
    getOrder: () => order,
  };
}

test('tenant-scoped status mutation cannot see another organization order', async () => {
  const fake = makeStatusDb({ id: 'order-a', organizationId: 'org-a', status: 'PDF_GENERATED' });
  await assert.rejects(
    markWholesaleOrderFiledManually({ id: 'order-a', organizationId: 'org-b', actorUserId: 'user-b' }, fake.db),
    (error) => error instanceof WholesaleOrderLifecycleError && error.code === 'NOT_FOUND',
  );
  assert.equal(fake.getOrder().status, 'PDF_GENERATED');
});

test('a Filed order is terminal and cannot be marked Sent', async () => {
  const fake = makeStatusDb({ id: 'order-a', organizationId: 'org-a', status: 'FILED' });
  await assert.rejects(
    markWholesaleOrderSent({ id: 'order-a', organizationId: 'org-a', actorUserId: 'user-a' }, fake.db),
    (error) => error instanceof WholesaleOrderLifecycleError && error.code === 'INVALID_TRANSITION',
  );
  assert.equal(fake.getOrder().status, 'FILED');
});

test('manual filing records the actor, timestamp, and MANUAL provenance', async () => {
  const fake = makeStatusDb({ id: 'order-a', organizationId: 'org-a', status: 'PDF_GENERATED' });
  await markWholesaleOrderFiledManually({ id: 'order-a', organizationId: 'org-a', actorUserId: 'user-a' }, fake.db);
  const order = fake.getOrder();
  assert.equal(order.status, 'FILED');
  assert.equal(order.filedByUserId, 'user-a');
  assert.equal(order.filedSource, 'MANUAL');
  assert.ok(order.filedAt instanceof Date);
});

test('create endpoint accepts the JSON contract used by the order form', () => {
  const source = readFileSync('app/api/wholesale-orders/pdf/route.ts', 'utf8');
  assert.match(source, /rawPayload = await request\.json\(\)/);
  assert.doesNotMatch(source, /request\.formData\(\)/);
  assert.match(source, /clientRequestId: z\.string\(\)\.uuid\(\)/);
});
