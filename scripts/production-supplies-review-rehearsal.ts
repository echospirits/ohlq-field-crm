import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { parseEnvironmentFile } from '../lib/environmentFile';

/** Synthetic persisted regression; never run this against shared TST or production. */
async function main() {
  const file = process.argv.find(arg => arg.startsWith('--env-file='))?.slice(11) || '.env.supplies.local';
  const env = Object.fromEntries(parseEnvironmentFile(readFileSync(file, 'utf8')));
  if (env.APP_ENV !== 'development' || env.DATABASE_TARGET_ID !== 'supplies-rehearsal' || new URL(env.DATABASE_URL).hostname !== env.EXPECTED_DATABASE_HOST || !env.EXPECTED_DATABASE_HOST.endsWith('.neon.tech')) throw new Error('Review rehearsal requires the explicitly isolated supplies-rehearsal target.');
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  const direct = new URL(env.DATABASE_URL); direct.hostname = direct.hostname.replace('-pooler.', '.');
  const db = new PrismaClient({ datasourceUrl: direct.toString() });
  const service = await import('../lib/productionSupplies/service');
  const run = randomUUID().slice(0, 8), organizationId = `org_supply_review_${run}`, userId = `supply_review_${run}`, otherId = `supply_review_other_${run}`;
  const actor = { organizationId, userId };
  const lines = [
    { description: 'Synthetic ingredient', sku: 'TEST1000', quantity: 1, unit: 'CASE' },
    { description: 'Synthetic citrus A', sku: 'TEST200', quantity: 1, unit: 'CASE' },
    { description: 'Synthetic citrus B', sku: 'TEST300', quantity: 2, unit: 'CASE' },
    { description: 'Synthetic gloves', sku: 'TEST400', quantity: 5, unit: 'EACH' },
    { description: 'Synthetic produce', sku: 'TEST500', quantity: 3, unit: 'EACH' },
  ];
  const source = (messageId: string, messageDate: string) => ({ provider: 'SYNTHETIC_REVIEW', messageId, messageDate, contentHash: `${run}-${messageId}`, historical: true, extractionStatus: 'REVIEW', extractionError: 'Synthetic incomplete invoice; order relationship requires owner review.' });
  try {
    await db.organization.create({ data: { id: organizationId, name: 'Synthetic review fixture', displayName: 'Synthetic review fixture', slug: `supply-review-${run}`, accountStatus: 'ACTIVE', features: { create: [{ featureKey: 'PRODUCTION_SUPPLIES', enabled: true }] } } });
    await db.user.createMany({ data: [userId, otherId].map(id => ({ id, organizationId, email: `${id}@example.invalid`, role: 'ADMIN', isActive: true })) });
    const order = await service.createManualOrder(actor, { supplier: 'Synthetic Supplier', orderReference: `TEST-ORDER-${run}`, destination: 'Synthetic destination', idempotencyKey: `order-${run}`, lines: [{ description: 'Synthetic existing material', sku: 'TEST100', quantity: 2, unit: 'CASE', department: 'PRODUCTION' }] }, db);
    const manualLine = await db.supplyOrderLine.findFirstOrThrow({ where: { organizationId, orderId: order.id } });
    await service.updateLineDetails(actor, { lineId: manualLine.id, quantity: 2, unit: 'CASE' }, db);
    const invoice = await service.ingestEvidence(actor, { source: source(`invoice-${run}`, '2026-11-11T16:00:00Z'), evidence: { kind: 'SHIPMENT', supplier: 'Synthetic Supplier', invoiceDate: '2026-11-11', lines, shipments: [] } }, db);
    assert.equal(await db.supplyOrderLine.count({ where: { organizationId, orderId: order.id } }), 1);
    await assert.rejects(() => service.reviewSupplySource({ organizationId, userId: otherId }, { sourceId: invoice.sourceId, decision: 'ATTACH', orderId: order.id }, db), /original mailbox owner/);
    await assert.rejects(() => service.reviewSupplySource(actor, { sourceId: invoice.sourceId, decision: 'ATTACH', orderId: 'foreign-or-unavailable-order' }, db), /existing order/);
    await service.reviewSupplySource(actor, { sourceId: invoice.sourceId, decision: 'ATTACH', orderId: order.id }, db);
    let saved = await db.supplyOrder.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true, sources: true } });
    assert.equal(saved.lines.length, 6); assert.equal(saved.sources.length, 1); assert.equal(saved.invoiceDate?.toISOString().slice(0, 10), '2026-11-11');
    assert.equal(saved.lines.find(line => line.sku === 'TEST100')!.department, 'PRODUCTION');
    assert.equal(saved.lines.find(line => line.sku === 'TEST1000')!.quantity?.toString(), '1');
    assert.equal(saved.lines.filter(line => lines.some(fact => fact.sku === line.sku)).length, 5);
    await service.reviewSupplySource(actor, { sourceId: invoice.sourceId, decision: 'ATTACH', orderId: order.id }, db);
    assert.equal(await db.supplyOrderLine.count({ where: { organizationId, orderId: order.id } }), 6);
    const exact = await service.ingestEvidence(actor, { source: source(`exact-${run}`, '2026-11-12T16:00:00Z'), evidence: { kind: 'SHIPMENT', supplier: 'Synthetic Supplier', lines: [{ description: 'Exact synthetic material', sku: 'TEST100', quantity: 99, unit: 'CASE' }], shipments: [] } }, db);
    await service.reviewSupplySource(actor, { sourceId: exact.sourceId, decision: 'ATTACH', orderId: order.id }, db);
    const older = await service.ingestEvidence(actor, { source: source(`older-${run}`, '2026-11-10T16:00:00Z'), evidence: { kind: 'SHIPMENT', supplier: 'Synthetic Supplier', invoiceDate: '2026-11-10', lines: [{ ...lines[0], quantity: 99 }], shipments: [] } }, db);
    await service.reviewSupplySource(actor, { sourceId: older.sourceId, decision: 'ATTACH', orderId: order.id }, db);
    saved = await db.supplyOrder.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true, sources: true } });
    assert.equal(saved.lines.length, 6); assert.equal(saved.lines.find(line => line.sku === 'TEST100')!.quantity?.toString(), '2');
    assert.equal(saved.lines.find(line => line.sku === 'TEST1000')!.quantity?.toString(), '1');
    assert.equal(saved.invoiceDate?.toISOString().slice(0, 10), '2026-11-11');
    assert.match((await db.supplySource.findUniqueOrThrow({ where: { id: invoice.sourceId } })).extractionError || '', /incomplete/);
    console.log(JSON.stringify({ target: 'supplies-rehearsal', synthetic: true, passed: ['owner-and-tenant-guard', 'all-five-mixed-invoice-lines-attached', 'distinct-raw-skus-preserved', 'repeat-attach-idempotent', 'manual-quantity-and-classification-preserved', 'older-facts-do-not-regress-newer-lines-or-invoice-date', 'partial-extraction-warning-retained'], sharedTstWrites: false }));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Source review rehearsal failed.'); process.exitCode = 1; });
