import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma, PrismaClient, SupplySource } from '@prisma/client';
import { reconcileAttachedBillOfLading } from '../lib/productionSupplies/billOfLading';
import { readSupplySourceProvenance } from '../lib/productionSupplies/orderConfirmation';
import { replayWatchedSupplyEvidence } from '../lib/productionSupplies/replay';
import { ingestEvidence, supplyEvidenceInput } from '../lib/productionSupplies/service';

const actor = { organizationId: 'fixture-tenant', userId: 'fixture-owner' };
const teamId = '2fec6bd0-b2c3-4224-bdc1-4ac507d062fe';
const preferences = {
  accountConfiguration: { version: 1, territories: [], categories: [], fields: [], teams: [{ id: teamId, name: 'Production', memberIds: [actor.userId] }] },
  productionSupplies: { productionTeamId: teamId },
};
const messageDate = new Date('2026-01-05T15:00:00Z');
const reference = 'BOL-78942';
const destination = '846 Fixture Ave, Columbus, OH 43214';
const provenance = {
  contentVersion: 'SUPPLY_CURRENT_V1', evidenceContext: 'ATTACHMENT', direction: 'RECEIVED',
  fromEmail: 'shipping@supplier.invalid', senderAuthenticated: true, productionTeamAuthorized: true,
  internetMessageId: 'a'.repeat(64),
};
const evidence = supplyEvidenceInput.shape.evidence.parse({
  kind: 'SHIPMENT', supplier: 'Fixture Glass Plant', orderReference: 'PO-716', destination,
  lines: [{ description: 'Empty Glass Bottles', quantity: 3, unit: 'pallets' }],
  // Retained document content is untrusted for lifecycle conclusions.
  orderDeliveryComplete: true, orderDeliveredDate: '2026-01-05', paymentReceived: true,
  shipments: [{ referenceType: 'BILL_OF_LADING', reference, carrier: 'Fixture Freight', status: 'UNKNOWN', freight: { originPostalCode: '01234', proNumber: null } }],
})!;

function fixture() {
  const attachment = {
    id: 'fixture-pdf', ...actor, mailboxConnectionId: 'fixture-inbox', provider: 'GOOGLE', messageId: 'fixture-message',
    messageDate, attachmentKey: 'part-2', contentHash: 'fixture-pdf-bytes', extractionStatus: 'COMPLETE',
    mimeType: 'application/pdf', filename: 'fixture.pdf', extractedFacts: { ...structuredClone(evidence), _provenance: provenance },
  };
  const line = { id: 'line-1', sku: 'SKU-750', description: '750ml Tennessee bottles', quantity: 3, unit: 'pallets', ignored: false, allocations: [{ needId: 'need-1' }] };
  const order = { id: 'order-1', supplier: 'Fixture Packaging', orderReference: null as string | null, destination: null as string | null, status: 'ORDERED', ignored: false, reviewRequired: false, manualFields: [] as string[], lines: [line] };
  const body = {
    id: 'fixture-body', extractedFacts: {
      kind: 'SHIPMENT', supplier: order.supplier, shipments: [{ referenceType: 'BILL_OF_LADING', reference }],
      _provenance: { ...provenance, evidenceContext: 'CURRENT_MESSAGE' },
    },
  };
  const shipment = { id: 'shipment-1', orderId: order.id, carrier: null as string | null, destination: null as string | null, status: 'UNKNOWN' };
  const shipments = [shipment];
  const links: Array<{ orderId: string; sourceId: string }> = [];
  const coverage: Array<{ lineId: string; shipmentId: string; quantity: number | null }> = [];
  const audits: Array<{ action: string; detail: unknown }> = [];
  const anchors: Array<{ order: typeof order; source: typeof body }> = [{ order, source: body }];
  const tx = {
    organization: { findFirst: async () => ({ id: actor.organizationId, crmPreferences: preferences }) },
    user: { findFirst: async () => ({ id: actor.userId, role: 'USER' }) },
    organizationFeature: { findFirst: async () => ({ id: 'fixture-entitlement' }) },
    mailboxConnection: { findFirst: async () => ({ enabled: true, provider: 'GOOGLE', scope: 'https://www.googleapis.com/auth/gmail.readonly', accessTokenEncrypted: 'supply-v1.fixture' }) },
    $executeRaw: async () => 1,
    supplyOrderSource: {
      findMany: async ({ where }: { where: { organizationId: string; source: Record<string, unknown> } }) => {
        assert.deepEqual(where.source, { ...actor, mailboxConnectionId: attachment.mailboxConnectionId, messageId: attachment.messageId, messageDate, provider: 'GOOGLE', attachmentKey: '', extractionStatus: 'COMPLETE' });
        assert.equal(where.organizationId, actor.organizationId);
        return anchors;
      },
      findUnique: async ({ where }: { where: { organizationId_orderId_sourceId: { sourceId: string } } }) => links.find(link => link.sourceId === where.organizationId_orderId_sourceId.sourceId),
      create: async ({ data }: { data: typeof links[number] }) => links.push(data),
    },
    supplyShipment: {
      findMany: async ({ where }: { where: Prisma.SupplyShipmentWhereInput }) => {
        assert.equal(where.organizationId, actor.organizationId);
        assert.deepEqual(where.reference, { equals: reference, mode: 'insensitive' });
        return shipments;
      },
      update: async ({ data }: { data: Partial<typeof shipment> }) => Object.assign(shipment, data),
    },
    supplyOrder: { findFirst: async () => order, update: async ({ data }: { data: Partial<typeof order> }) => Object.assign(order, data) },
    supplyNeed: { findMany: async () => [{ id: 'need-1', description: line.description, location: 'Location unknown', unit: line.unit, createdAt: messageDate, warnings: [], audits: [], allocations: [] }] },
    supplyCatalogItem: { findMany: async () => [] },
    supplyShipmentLine: {
      findMany: async () => coverage,
      create: async ({ data }: { data: typeof coverage[number] }) => coverage.push(data),
    },
    supplySource: {
      findFirst: async () => attachment,
      findMany: async ({ where }: { where: { extractedFacts: { equals: string } } }) => where.extractedFacts.equals === 'SHIPMENT' && !links.length ? [attachment] : [],
      update: async ({ data }: { data: Partial<typeof attachment> }) => Object.assign(attachment, data),
    },
    supplyAudit: {
      findFirst: async () => null,
      create: async ({ data }: { data: typeof audits[number] }) => audits.push(data),
    },
  };
  const db = { ...tx, $transaction: async (callback: (client: typeof tx) => unknown) => callback(tx) } as unknown as PrismaClient;
  return { db, tx: tx as unknown as Prisma.TransactionClient, order, line, shipment, shipments, body, attachment, links, coverage, audits, anchors };
}

test('automatic ingestion links the authenticated PDF whose shipper differs from the seller', async () => {
  const f = fixture();
  const input = { source: { ...f.attachment, ...provenance, messageDate: messageDate.toISOString() }, evidence };
  const result = await ingestEvidence(actor, input, f.db, { reconcile: false });
  assert.equal(result.orderId, f.order.id);
  assert.equal(f.links.length, 1);
  assert.equal(f.order.supplier, 'Fixture Packaging');
  assert.equal(f.order.orderReference, 'PO-716');
  assert.equal(f.shipment.carrier, 'Fixture Freight');
  assert.equal(f.shipment.destination, destination);
  assert.equal(f.shipment.status, 'UNKNOWN');
  assert.equal(f.attachment.extractedFacts.supplier, 'Fixture Glass Plant');
  assert.deepEqual(f.attachment.extractedFacts.shipments[0].freight, { originPostalCode: '01234', proNumber: null });
  assert.equal(readSupplySourceProvenance(f.attachment.extractedFacts).freightDocumentOnly, true);
  assert.deepEqual(f.coverage, [], 'A generic commodity must not become a quantity for a specific bottle');
  await ingestEvidence(actor, input, f.db, { reconcile: false });
  assert.equal(f.links.length, 1);
  assert.equal(f.audits.length, 1);
});

test('a retained completed PDF is replayed even without a material match or newer freight metadata', async () => {
  const f = fixture();
  delete f.attachment.extractedFacts.shipments[0].freight;
  const importResult = await replayWatchedSupplyEvidence(actor.organizationId, f.db, ingestEvidence, {
    scope: async () => ({ evidence: null, reason: 'The commodity wording is generic.', materialKeys: [] }),
  });
  assert.equal(importResult.attempted, 1);
  assert.equal(importResult.linked, 1);
  assert.equal(importResult.errors, 0);
  assert.equal(f.shipment.carrier, 'Fixture Freight');
  assert.equal(f.attachment.extractedFacts.shipments[0].freight, undefined);
});

test('document coverage requires an exact unique line and preserves previously allocated quantities', async () => {
  const f = fixture();
  const document = { ...evidence, lines: [{ sku: f.line.sku, description: 'Supplier item wording', quantity: 2, unit: f.line.unit }] };
  f.coverage.push({ shipmentId: 'prior-shipment', lineId: f.line.id, quantity: 1 });
  const apply = () => reconcileAttachedBillOfLading(f.tx, f.attachment as unknown as SupplySource, document);
  await apply();
  await apply();
  assert.equal(f.coverage.length, 2);
  assert.deepEqual(f.coverage[1], { organizationId: actor.organizationId, shipmentId: f.shipment.id, lineId: f.line.id, quantity: 2 });
  const ambiguous = fixture();
  ambiguous.order.lines.push({ ...ambiguous.line, id: 'line-2' });
  await reconcileAttachedBillOfLading(ambiguous.tx, ambiguous.attachment as unknown as SupplySource, document);
  assert.deepEqual(ambiguous.coverage, []);
});

test('incompatible bill of lading evidence cannot enrich an existing shipment', async () => {
  for (const configure of [
    (f: ReturnType<typeof fixture>) => { f.attachment.extractedFacts._provenance = { ...provenance, senderAuthenticated: false }; },
    (f: ReturnType<typeof fixture>) => { f.body.extractedFacts._provenance.fromEmail = 'another-sender@fixture.invalid'; },
    (f: ReturnType<typeof fixture>) => { f.body.extractedFacts.shipments[0].reference = 'BOL-11111'; },
    (f: ReturnType<typeof fixture>) => { f.order.orderReference = 'PO-999'; },
    (f: ReturnType<typeof fixture>) => { f.order.destination = 'Different facility'; },
    (f: ReturnType<typeof fixture>) => { f.shipments.push({ ...f.shipment, id: 'conflicting-shipment', orderId: 'another-order' }); },
  ]) {
    const f = fixture();
    configure(f);
    assert.equal(await reconcileAttachedBillOfLading(f.tx, f.attachment as unknown as SupplySource, evidence), null);
    assert.equal(f.shipment.carrier, null);
    assert.deepEqual(f.links, []);
    assert.deepEqual(f.audits, []);
  }
});
