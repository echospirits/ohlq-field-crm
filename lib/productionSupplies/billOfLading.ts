import type { Prisma, SupplySource } from '@prisma/client';
import { z } from 'zod';
import { knownNumber, normalize, sameUnit } from './domain';
import { isCurrentSupplyEvidence, readSupplySourceProvenance, type SupplySourceProvenance } from './orderConfirmation';
import type { ValidatedSupplyEvidence } from './service';
import { normalizeSupplyLocation, normalizeSupplyMaterial } from './statusDomain';
import { isWatchedSupplyOrder } from './watch';

const retainedBillFacts = z.object({
  kind: z.literal('SHIPMENT'),
  supplier: z.string().nullish(),
  orderReference: z.string().nullish(),
  shipments: z.array(z.object({ referenceType: z.string(), reference: z.string(), carrier: z.string().nullish() })),
});

function billOfLading(value: unknown) {
  const parsed = retainedBillFacts.safeParse(value);
  if (!parsed.success) return null;
  const bills = parsed.data.shipments.filter(shipment => shipment.referenceType === 'BILL_OF_LADING');
  if (bills.length !== 1) return null;
  const [bill] = bills;
  const reference = bill.reference.trim();
  if (!/^[a-z0-9][a-z0-9._/-]{3,99}$/i.test(reference) || !/\d/.test(reference)) return null;
  return { ...bill, reference, supplier: parsed.data.supplier, orderReference: parsed.data.orderReference };
}

function authenticatedCurrentMessage(provenance: SupplySourceProvenance) {
  return isCurrentSupplyEvidence(provenance) && provenance.productionTeamAuthorized === true &&
    provenance.direction === 'RECEIVED' && provenance.senderAuthenticated === true && Boolean(provenance.fromEmail);
}

/** A retained PDF can be reconsidered after its own message body has been linked. */
export function isAttachedBillOfLadingCandidate(source: Pick<SupplySource, 'attachmentKey' | 'provider' | 'mimeType' | 'mailboxConnectionId' | 'extractedFacts'>) {
  const provenance = readSupplySourceProvenance(source.extractedFacts);
  return Boolean(source.attachmentKey && source.mailboxConnectionId && source.provider === 'GOOGLE' &&
    source.mimeType === 'application/pdf' && provenance.evidenceContext === 'ATTACHMENT' &&
    authenticatedCurrentMessage(provenance) && billOfLading(source.extractedFacts));
}

export function activeBillOfLadingWhere(organizationId: string, reference: string): Prisma.SupplyShipmentWhereInput {
  return { organizationId, referenceType: 'BILL_OF_LADING', reference: { equals: reference.trim(), mode: 'insensitive' }, OR: [{ provider: null }, { provider: { not: 'SOURCE_WITHDRAWN' } }] };
}

/** Only exact, quantity-bounded line matches can establish freight coverage. */
function shipmentCoverage(
  facts: ValidatedSupplyEvidence['lines'],
  lines: Array<{ id: string; sku: string | null; description: string; unit: string | null; quantity: unknown }>,
) {
  const matched = facts.flatMap(fact => {
    const quantity = knownNumber(fact.quantity);
    if (quantity === null || quantity <= 0) return [];
    const candidates = lines.filter(line =>
      sameUnit(line.unit, fact.unit) &&
      (line.sku && fact.sku ? normalize(line.sku) === normalize(fact.sku) :
        normalizeSupplyMaterial(line.description) === normalizeSupplyMaterial(fact.description)));
    if (candidates.length !== 1) return [];
    const [line] = candidates;
    const ordered = knownNumber(line.quantity);
    return ordered !== null && quantity <= ordered ? [{ lineId: line.id, quantity, ordered }] : [];
  });
  return matched.filter(item => matched.filter(candidate => candidate.lineId === item.lineId).length === 1);
}

/** Use the vendor's authenticated, linked message to anchor the freight document. */
export async function reconcileAttachedBillOfLading(
  tx: Prisma.TransactionClient,
  source: SupplySource,
  evidence: ValidatedSupplyEvidence,
) {
  if (!isAttachedBillOfLadingCandidate(source)) return null;
  const attachment = billOfLading(evidence);
  if (!attachment) return null;
  const provenance = readSupplySourceProvenance(source.extractedFacts);
  const { organizationId, mailboxConnectionId, userId, messageId, messageDate } = source;
  const anchors = await tx.supplyOrderSource.findMany({
    where: {
      organizationId,
      source: { organizationId, mailboxConnectionId, userId, messageId, messageDate, provider: 'GOOGLE', attachmentKey: '', extractionStatus: 'COMPLETE' },
      order: { organizationId, ignored: false, status: { notIn: ['CANCELLED', 'IGNORED'] } },
    },
    include: { source: { select: { id: true, extractedFacts: true } }, order: { include: { lines: { where: { organizationId, ignored: false } } } } },
    take: 2,
  });
  if (anchors.length !== 1) return null;
  const [anchor] = anchors;
  const body = billOfLading(anchor.source.extractedFacts);
  const bodyProvenance = readSupplySourceProvenance(anchor.source.extractedFacts);
  if (!body || normalize(body.reference) !== normalize(attachment.reference) || !authenticatedCurrentMessage(bodyProvenance) ||
      bodyProvenance.evidenceContext !== 'CURRENT_MESSAGE' || bodyProvenance.fromEmail !== provenance.fromEmail ||
      bodyProvenance.internetMessageId !== provenance.internetMessageId) return null;

  const order = anchor.order;
  const conflicts = (left?: string | null, right?: string | null) => Boolean(left && right && left !== right);
  if (conflicts(normalize(body.supplier), normalize(order.supplier)) ||
      conflicts(body.orderReference, attachment.orderReference) || conflicts(order.orderReference, attachment.orderReference) ||
      conflicts(normalizeSupplyLocation(order.destination), normalizeSupplyLocation(evidence.destination))) return null;
  const shipments = await tx.supplyShipment.findMany({
    where: activeBillOfLadingWhere(organizationId, attachment.reference),
    select: { id: true, orderId: true, carrier: true, destination: true, status: true, providerMode: true },
    take: 2,
  });
  const [shipment] = shipments;
  if (shipments.length !== 1 || shipment.orderId !== order.id || shipment.providerMode === 'test' ||
      conflicts(normalize(shipment.carrier), normalize(attachment.carrier)) ||
      conflicts(normalizeSupplyLocation(shipment.destination), normalizeSupplyLocation(evidence.destination)) ||
      !await isWatchedSupplyOrder(organizationId, order.id, tx)) return null;

  const link = { organizationId, orderId: order.id, sourceId: source.id };
  const priorLink = await tx.supplyOrderSource.findUnique({ where: { organizationId_orderId_sourceId: link } });
  const shipmentUpdate: Prisma.SupplyShipmentUpdateInput = {};
  if (!shipment.carrier && attachment.carrier) shipmentUpdate.carrier = attachment.carrier;
  const locator = evidence.shipments.find(fact => fact.referenceType === 'BILL_OF_LADING' && normalize(fact.reference) === normalize(attachment.reference))?.freight;
  if (!['DELIVERED', 'CANCELLED', 'RETURNED'].includes(shipment.status) &&
      (shipmentUpdate.carrier || !priorLink && (locator?.proNumber || locator?.originPostalCode))) shipmentUpdate.nextCheckAt = new Date();
  if (!normalizeSupplyLocation(shipment.destination) && normalizeSupplyLocation(evidence.destination)) shipmentUpdate.destination = evidence.destination;
  if (Object.keys(shipmentUpdate).length) await tx.supplyShipment.update({ where: { organizationId_id: { organizationId, id: shipment.id } }, data: shipmentUpdate });

  const orderUpdate: Prisma.SupplyOrderUpdateInput = {};
  if (!order.orderReference && attachment.orderReference && !order.manualFields.includes('orderReference')) orderUpdate.orderReference = attachment.orderReference;
  if (!normalizeSupplyLocation(order.destination) && normalizeSupplyLocation(evidence.destination) && !order.manualFields.includes('destination')) orderUpdate.destination = evidence.destination;
  if (Object.keys(orderUpdate).length) await tx.supplyOrder.update({ where: { organizationId_id: { organizationId, id: order.id } }, data: orderUpdate });

  const coverage = shipmentCoverage(evidence.lines, order.lines);
  const savedCoverage: string[] = [];
  if (coverage.length && !['CANCELLED', 'RETURNED'].includes(shipment.status)) {
    const existing = await tx.supplyShipmentLine.findMany({
      where: { organizationId, lineId: { in: coverage.map(line => line.lineId) }, shipment: { organizationId, OR: [{ provider: null }, { provider: { not: 'SOURCE_WITHDRAWN' } }], status: { notIn: ['CANCELLED', 'RETURNED'] } } },
      select: { shipmentId: true, lineId: true, quantity: true },
    });
    for (const { lineId, quantity, ordered } of coverage) {
      const prior = existing.filter(line => line.lineId === lineId);
      if (prior.some(line => line.shipmentId === shipment.id || knownNumber(line.quantity) === null) ||
          prior.reduce((total, line) => total + Number(line.quantity), quantity) > ordered) continue;
      await tx.supplyShipmentLine.create({ data: { organizationId, shipmentId: shipment.id, lineId, quantity } });
      savedCoverage.push(lineId);
    }
  }

  if (!priorLink) await tx.supplyOrderSource.create({ data: link });
  if (!provenance.freightDocumentOnly) await tx.supplySource.update({
    where: { organizationId_id: { organizationId, id: source.id } },
    data: { extractedFacts: { ...source.extractedFacts as Prisma.JsonObject, _provenance: { ...provenance, freightDocumentOnly: true } } as Prisma.InputJsonValue },
  });
  if (!priorLink || !provenance.freightDocumentOnly || Object.keys(shipmentUpdate).length || Object.keys(orderUpdate).length || savedCoverage.length) {
    await tx.supplyAudit.create({ data: {
      organizationId, orderId: order.id, actorUserId: userId, action: 'FREIGHT_DOCUMENT_LINKED',
      detail: { sourceId: source.id, anchorSourceId: anchor.source.id, shipmentId: shipment.id, shipmentLines: savedCoverage },
    } });
  }
  return { orderId: order.id, review: order.reviewRequired };
}
