import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma';
import { classifyLine, fingerprint, knownNumber, lineAvailableQuantity, normalize, sameUnit, validateAllocation } from './domain';
import { hasSupplyAccess, productionMemberIds, readSupplySettings } from './config';
import { normalizeSupplyLocation } from './statusDomain';
import { catalogInput, classificationInput, expectationInput, ignoreInput, lineDetailsInput, orderDetailsInput, linkNeedInput, manualOrderInput, needInput, needDetailsInput, noteInput, ownerInput, receiptInput, resolveNeedInput, ruleInput, trackingInput, type SupplyActor } from './schemas';
import { scopeSupplyEvidence } from './watch';
import { canReadSupplyMailbox } from './mailAccess';
import { replayWatchedSupplyEvidence, type ReplayOptions } from './replay';

type Tx = Prisma.TransactionClient;
export class SupplyError extends Error { constructor(message: string) { super(message); this.name = 'SupplyError'; } }
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export async function assertSupplyActor(db: Tx, actor: SupplyActor, manage = true) {
  const [organization, user, feature] = await Promise.all([
    db.organization.findFirst({ where: { id: actor.organizationId, active: true, accountStatus: { notIn: ['SUSPENDED', 'CANCELLED'] } }, select: { id: true, crmPreferences: true } }),
    db.user.findFirst({ where: { id: actor.userId, organizationId: actor.organizationId, isActive: true }, select: { id: true, role: true } }),
    db.organizationFeature.findFirst({ where: { organizationId: actor.organizationId, featureKey: 'PRODUCTION_SUPPLIES', enabled: true }, select: { id: true } }),
  ]);
  if (!organization || !user || !feature) throw new SupplyError('Production Supplies access is unavailable.');
  if (manage && !hasSupplyAccess(user, readSupplySettings(organization.crmPreferences), true)) throw new SupplyError('Production Supplies management permission is required.');
  return { organization, user };
}
async function owner(db: Tx, actor: SupplyActor, userId?: string) {
  if (userId && !await db.user.findFirst({ where: { id: userId, organizationId: actor.organizationId, isActive: true }, select: { id: true } })) throw new SupplyError('Choose an active person in this organization.');
}
async function catalog(db: Tx, actor: SupplyActor, itemId?: string) {
  if (!itemId) return null;
  const item = await db.supplyCatalogItem.findFirst({ where: { id: itemId, organizationId: actor.organizationId } });
  if (!item) throw new SupplyError('Catalog item is unavailable.');
  return item;
}
async function lock(db: Tx, organizationId: string) { await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`supply:${organizationId}`},0))`; }
async function audit(db: Tx, actor: SupplyActor, action: string, detail: unknown, orderId?: string, needId?: string) { await db.supplyAudit.create({ data: { organizationId: actor.organizationId, actorUserId: actor.userId, action, detail: json(detail), orderId, needId } }); }
async function mutate<T>(actor: SupplyActor, db: PrismaClient, action: (tx: Tx) => Promise<T>) {
  return db.$transaction(async tx => { await assertSupplyActor(tx, actor); await lock(tx, actor.organizationId); return action(tx); }, { timeout: 30000 });
}

export async function createManualOrder(actor: SupplyActor, raw: unknown, db: PrismaClient = prisma) {
  const input = manualOrderInput.parse(raw);
  return mutate(actor, db, async tx => {
    const existing = await tx.supplyOrder.findUnique({ where: { organizationId_dedupeKey: { organizationId: actor.organizationId, dedupeKey: `manual:${input.idempotencyKey}` } } });
    if (existing) return existing;
    await owner(tx, actor, input.ownerUserId);
    for (const line of input.lines) await catalog(tx, actor, line.catalogItemId);
    const order = await tx.supplyOrder.create({ data: { organizationId: actor.organizationId, dedupeKey: `manual:${input.idempotencyKey}`, supplier: input.supplier, normalizedSupplier: normalize(input.supplier), orderReference: input.orderReference || null, destination: input.destination || null, ownerUserId: input.ownerUserId, orderedAt: input.orderedAt ? new Date(input.orderedAt) : null, notes: input.notes, manualFields: ['supplier', 'destination', 'orderedAt', 'orderReference'], reviewRequired: input.lines.some(l => l.department === 'NEEDS_REVIEW'), lines: { create: input.lines.map((line, index) => ({ lineKey: `manual:${index}`, description: line.description, quantity: line.quantity, unit: line.unit, sku: line.sku, catalogItemId: line.catalogItemId, department: line.department, manualClassification: true, classificationSource: 'MANUAL', classificationConfidence: 1, classificationExplanation: 'Entered for this purchase.', notes: line.notes })) } } });
    await audit(tx, actor, 'ORDER_CREATED', { manual: true }, order.id);
    return order;
  });
}
export const createOrder = createManualOrder;

export async function createNeed(actor: SupplyActor, raw: unknown, db: PrismaClient = prisma) {
  const input = needInput.parse(raw);
  return mutate(actor, db, async tx => {
    await owner(tx, actor, input.ownerUserId); await catalog(tx, actor, input.catalogItemId);
    const need = await tx.supplyNeed.upsert({ where: { organizationId_dedupeKey: { organizationId: actor.organizationId, dedupeKey: `manual:${input.idempotencyKey}` } }, create: { organizationId: actor.organizationId, dedupeKey: `manual:${input.idempotencyKey}`, description: input.description, catalogItemId: input.catalogItemId, location: input.location, quantity: input.quantity, unit: input.unit, ownerUserId: input.ownerUserId, priority: input.priority, notes: input.notes }, update: {} });
    await audit(tx, actor, 'NEED_CREATED', { manual: true }, undefined, need.id);
    return need;
  });
}
export async function updateLineClassification(actor: SupplyActor, raw: unknown, db: PrismaClient = prisma) {
  const input = classificationInput.parse(raw);
  return mutate(actor, db, async tx => {
    const line = await tx.supplyOrderLine.findFirst({ where: { organizationId: actor.organizationId, id: input.lineId }, include: { order: true, allocations: true } });
    if (!line) throw new SupplyError('Order line is unavailable.');
    await catalog(tx, actor, input.catalogItemId);
    const total = knownNumber(line.quantity);
    if (input.productionQuantity !== undefined || input.barQuantity !== undefined) {
      if (input.department !== 'SHARED' || total === null || (input.productionQuantity ?? 0) + (input.barQuantity ?? 0) > total + 0.000001) throw new SupplyError('A Shared allocation requires a known quantity and cannot exceed the purchase quantity.');
    }
    const allocated = line.allocations.reduce((sum, a) => sum + (knownNumber(a.quantity) ?? 0), 0);
    const available = lineAvailableQuantity({ quantity: line.quantity, department: input.department, productionQuantity: input.productionQuantity });
    if (allocated > 0 && (available === null || available + 0.000001 < allocated)) throw new SupplyError('Remove or reduce linked need allocations before reducing production coverage.');
    if (input.remember && !line.sku) throw new SupplyError('A remembered rule needs a specific supplier SKU. This purchase can still be corrected without remembering.');
    const result = await tx.supplyOrderLine.update({ where: { organizationId_id: { organizationId: actor.organizationId, id: line.id } }, data: { department: input.department, catalogItemId: input.catalogItemId ?? line.catalogItemId, manualClassification: true, classificationSource: 'MANUAL', classificationConfidence: 1, classificationExplanation: input.notes || 'Reviewed for this purchase.', productionQuantity: input.productionQuantity ?? null, barQuantity: input.barQuantity ?? null } });
    if (input.remember && line.sku) await tx.supplyClassificationRule.upsert({ where: { organizationId_supplier_sku: { organizationId: actor.organizationId, supplier: line.order.normalizedSupplier, sku: normalize(line.sku) } }, create: { organizationId: actor.organizationId, supplier: line.order.normalizedSupplier, sku: normalize(line.sku), department: input.department, catalogItemId: input.catalogItemId ?? line.catalogItemId, unit: line.unit, packSize: line.packSize, explanation: input.notes || 'Reviewed matching supplier and SKU.', reviewedByUserId: actor.userId }, update: { department: input.department, catalogItemId: input.catalogItemId ?? line.catalogItemId, unit: line.unit, packSize: line.packSize, explanation: input.notes || 'Reviewed matching supplier and SKU.', reviewedByUserId: actor.userId, active: true } });
    await tx.supplyOrder.update({ where: { organizationId_id: { organizationId: actor.organizationId, id: line.orderId } }, data: { reviewRequired: Boolean(await tx.supplyOrderLine.count({ where: { organizationId: actor.organizationId, orderId: line.orderId, department: 'NEEDS_REVIEW', ignored: false } })) } });
    await audit(tx, actor, 'CLASSIFICATION_REVIEWED', { lineId: line.id, before: line.department, after: input.department, remembered: input.remember }, line.orderId);
    return result;
  });
}
export async function linkNeed(actor: SupplyActor, raw: unknown, db: PrismaClient = prisma) {
  const input = linkNeedInput.parse(raw);
  return mutate(actor, db, async tx => {
    const [need, line] = await Promise.all([
      tx.supplyNeed.findFirst({ where: { organizationId: actor.organizationId, id: input.needId, resolvedAt: null } }),
      tx.supplyOrderLine.findFirst({ where: { organizationId: actor.organizationId, id: input.lineId }, include: { order: true, allocations: true, receiptLines: true } }),
    ]);
    if (!need || !line || line.ignored || line.order.ignored || line.order.status === 'CANCELLED') throw new SupplyError('Choose an open need and an active order line.');
    if (need.catalogItemId && line.catalogItemId && need.catalogItemId !== line.catalogItemId) throw new SupplyError('The materials do not match. Correct their catalog mapping first.');
    if (line.order.destination && normalize(need.location) !== normalize(line.order.destination)) throw new SupplyError('Destinations differ. Correct the destination before linking.');
    const other = line.allocations.filter(a => a.needId !== need.id), already = other.reduce((sum, a) => sum + (knownNumber(a.quantity) ?? 0), 0);
    try { validateAllocation({ lineQuantity: lineAvailableQuantity(line), alreadyAllocated: already, quantity: input.quantity, lineUnit: line.unit, needUnit: need.unit, unit: input.unit }); } catch (error) { throw new SupplyError(error instanceof Error ? error.message : 'Quantity allocation is invalid.'); }
    const receipts = line.receiptLines.filter(r => sameUnit(r.unit, input.unit));
    const grossReceived = receipts.reduce((sum, r) => sum + Number(r.quantity), 0), damagedReceived = receipts.reduce((sum, r) => sum + Number(r.damagedQuantity ?? 0), 0);
    const totalReceived = line.department === 'SHARED' ? line.quantity !== null && grossReceived >= Number(line.quantity) && damagedReceived === 0 ? knownNumber(line.productionQuantity) ?? 0 : 0 : grossReceived - damagedReceived;
    const allocatedReceived = other.reduce((sum, a) => sum + Number(a.receivedQuantity), 0);
    const allocation = await tx.supplyNeedAllocation.upsert({ where: { organizationId_needId_lineId: { organizationId: actor.organizationId, needId: need.id, lineId: line.id } }, create: { organizationId: actor.organizationId, needId: need.id, lineId: line.id, quantity: input.quantity, unit: input.unit || null, receivedQuantity: Math.max(0, Math.min(input.quantity ?? 0, totalReceived - allocatedReceived)), confirmed: true, explanation: input.quantity === undefined ? 'Reviewed link; quantity coverage remains unknown.' : 'Reviewed item, destination and quantity allocation.' }, update: { quantity: input.quantity ?? null, unit: input.unit || null, receivedQuantity: Math.max(0, Math.min(input.quantity ?? 0, totalReceived - allocatedReceived)), confirmed: true } });
    await audit(tx, actor, 'NEED_LINKED', { lineId: line.id, quantity: input.quantity ?? null, unit: input.unit ?? null }, line.orderId, need.id);
    return allocation;
  });
}
export async function recordReceipt(actor: SupplyActor, raw: unknown, db: PrismaClient = prisma) {
  const input = receiptInput.parse(raw);
  return mutate(actor, db, async tx => {
    const existing = await tx.supplyReceipt.findUnique({ where: { organizationId_idempotencyKey: { organizationId: actor.organizationId, idempotencyKey: input.idempotencyKey } } });
    if (existing) { if (existing.orderId !== input.orderId) throw new SupplyError('Receipt key already belongs to another order.'); return existing; }
    const order = await tx.supplyOrder.findFirst({ where: { organizationId: actor.organizationId, id: input.orderId }, include: { lines: { include: { receiptLines: true, allocations: { orderBy: { createdAt: 'asc' } } } } } });
    if (!order || order.ignored || order.status === 'CANCELLED') throw new SupplyError('Order is unavailable for receipt.');
    const shipment = input.shipmentId ? await tx.supplyShipment.findFirst({ where: { organizationId: actor.organizationId, id: input.shipmentId, orderId: order.id }, include: { lines: true, receipts: { include: { lines: true } } } }) : null;
    if (input.shipmentId && !shipment) throw new SupplyError('Shipment is unavailable.');
    if (shipment && ['RETURNED', 'CANCELLED'].includes(shipment.status)) throw new SupplyError('Returned or cancelled shipments cannot be received.');
    if (new Set(input.lines.map(l => l.lineId)).size !== input.lines.length) throw new SupplyError('Each line can appear only once in a receipt.');
    for (const received of input.lines) {
      const line = order.lines.find(l => l.id === received.lineId);
      if (!line || !sameUnit(line.unit, received.unit)) throw new SupplyError('Receipt units must match the selected order line. Confirm the order quantity and unit first.');
      if ((received.damagedQuantity ?? 0) > received.quantity) throw new SupplyError('Damaged quantity cannot exceed received quantity.');
      const prior = line.receiptLines.reduce((sum, r) => sum + Number(r.quantity), 0), ordered = knownNumber(line.quantity);
      if (ordered !== null && prior + received.quantity > ordered + 0.000001) throw new SupplyError('Received quantity exceeds the outstanding ordered quantity.');
      const shipmentLine = shipment?.lines.find(l => l.lineId === line.id);
      if (shipment && shipment.lines.length && !shipmentLine) throw new SupplyError('This line is not in the selected shipment.');
      const shipmentQuantity = knownNumber(shipmentLine?.quantity);
      const priorShipment = shipment?.receipts.flatMap(r => r.lines).filter(r => r.lineId === line.id).reduce((sum, r) => sum + Number(r.quantity), 0) ?? 0;
      if (shipmentQuantity !== null && priorShipment + received.quantity > shipmentQuantity + 0.000001) throw new SupplyError('Receipt exceeds this shipment’s outstanding quantity.');
      // A partial Shared receipt does not establish whether Production or Bar
      // received those units. Only a complete undamaged line establishes its
      // previously reviewed purchase allocation; otherwise receipt coverage is unknown.
      const totalDamage = line.receiptLines.reduce((sum, r) => sum + Number(r.damagedQuantity ?? 0), 0) + (received.damagedQuantity ?? 0);
      let remaining = line.department === 'SHARED' ? ordered !== null && prior + received.quantity >= ordered && totalDamage === 0 ? Math.max(0, (knownNumber(line.productionQuantity) ?? 0) - line.allocations.reduce((sum, a) => sum + Number(a.receivedQuantity), 0)) : 0 : received.quantity - (received.damagedQuantity ?? 0);
      for (const allocation of line.allocations) {
        if (!sameUnit(allocation.unit, received.unit) || allocation.quantity === null || remaining <= 0) continue;
        const applied = Math.max(0, Math.min(remaining, Number(allocation.quantity) - Number(allocation.receivedQuantity)));
        if (applied) await tx.supplyNeedAllocation.update({ where: { id: allocation.id }, data: { receivedQuantity: { increment: applied } } });
        remaining -= applied;
      }
    }
    const receipt = await tx.supplyReceipt.create({ data: { organizationId: actor.organizationId, orderId: order.id, shipmentId: input.shipmentId, idempotencyKey: input.idempotencyKey, receivedByUserId: actor.userId, notes: input.notes, lines: { create: input.lines.map(line => ({ lineId: line.lineId, quantity: line.quantity, shortageQuantity: line.shortageQuantity, damagedQuantity: line.damagedQuantity, unit: line.unit, notes: line.notes })) } } });
    const allReceived = order.lines.every(line => line.quantity !== null && line.receiptLines.reduce((sum, r) => sum + Number(r.quantity), 0) + input.lines.filter(r => r.lineId === line.id).reduce((sum, r) => sum + r.quantity, 0) >= Number(line.quantity));
    if (allReceived) await tx.supplyOrder.update({ where: { organizationId_id: { organizationId: actor.organizationId, id: order.id } }, data: { status: 'RECEIVED' } });
    await audit(tx, actor, 'RECEIPT_RECORDED', { receiptId: receipt.id, shipmentId: input.shipmentId ?? null, lines: input.lines }, order.id);
    return receipt;
  });
}
export async function unlinkNeed(actor: SupplyActor, raw: unknown, db: PrismaClient = prisma) {
  const input = linkNeedInput.pick({ needId: true, lineId: true }).parse(raw);
  return mutate(actor, db, async tx => {
    const allocation = await tx.supplyNeedAllocation.findUnique({ where: { organizationId_needId_lineId: { organizationId: actor.organizationId, needId: input.needId, lineId: input.lineId } }, include: { line: true } });
    if (!allocation) throw new SupplyError('Link is unavailable.');
    await tx.supplyNeedAllocation.delete({ where: { id: allocation.id } });
    await audit(tx, actor, 'NEED_UNLINKED', { lineId: input.lineId, allocatedQuantity: allocation.quantity, receivedQuantity: allocation.receivedQuantity }, allocation.line.orderId, input.needId);
    return { id: allocation.id };
  });
}
export async function resolveNeed(actor: SupplyActor, raw: unknown, db: PrismaClient = prisma) {
  const input = resolveNeedInput.parse(raw);
  return mutate(actor, db, async tx => {
    const need = await tx.supplyNeed.findFirst({ where: { id: input.needId, organizationId: actor.organizationId } });
    if (!need) throw new SupplyError('Need is unavailable.');
    if (need.resolvedAt) return need;
    const result = await tx.supplyNeed.update({ where: { organizationId_id: { organizationId: actor.organizationId, id: need.id } }, data: { resolvedAt: new Date(), resolvedByUserId: actor.userId, activeKey: null } });
    await audit(tx, actor, 'NEED_RESOLVED', { note: input.note }, undefined, need.id); return result;
  });
}
export async function addNote(actor: SupplyActor, raw: unknown, db: PrismaClient = prisma) {
  const input = noteInput.parse(raw);
  return mutate(actor, db, async tx => {
    const record = input.orderId ? await tx.supplyOrder.findFirst({ where: { id: input.orderId, organizationId: actor.organizationId } }) : await tx.supplyNeed.findFirst({ where: { id: input.needId, organizationId: actor.organizationId } });
    if (!record) throw new SupplyError('Record is unavailable.');
    await audit(tx, actor, 'NOTE_ADDED', { note: input.note }, input.orderId, input.needId);
    const notes = [record.notes, input.note].filter(Boolean).join('\n');
    return input.orderId ? tx.supplyOrder.update({ where: { organizationId_id: { organizationId: actor.organizationId, id: input.orderId } }, data: { notes } }) : tx.supplyNeed.update({ where: { organizationId_id: { organizationId: actor.organizationId, id: input.needId! } }, data: { notes } });
  });
}
export async function assignOwner(actor: SupplyActor, raw: unknown, db: PrismaClient = prisma) {
  const input = ownerInput.parse(raw);
  return mutate(actor, db, async tx => {
    await owner(tx, actor, input.ownerUserId);
    const result = input.orderId ? await tx.supplyOrder.updateMany({ where: { organizationId: actor.organizationId, id: input.orderId }, data: { ownerUserId: input.ownerUserId ?? null, manualFields: { push: 'ownerUserId' } } }) : await tx.supplyNeed.updateMany({ where: { organizationId: actor.organizationId, id: input.needId }, data: { ownerUserId: input.ownerUserId ?? null } });
    if (!result.count) throw new SupplyError('Record is unavailable.');
    await audit(tx, actor, 'OWNER_ASSIGNED', { ownerUserId: input.ownerUserId ?? null }, input.orderId, input.needId); return result;
  });
}
export async function attachTracking(actor: SupplyActor, raw: unknown, db: PrismaClient = prisma) {
  const input = trackingInput.parse(raw);
  return mutate(actor, db, async tx => {
    const order = await tx.supplyOrder.findFirst({ where: { id: input.orderId, organizationId: actor.organizationId }, include: { lines: true } });
    if (!order) throw new SupplyError('Order is unavailable.');
    try { new Intl.DateTimeFormat('en', { timeZone: input.timezone }); } catch { throw new SupplyError('Choose a valid destination time zone.'); }
    for (const link of input.lines) { const line = order.lines.find(l => l.id === link.lineId); if (!line || (link.quantity !== undefined && line.quantity !== null && link.quantity > Number(line.quantity))) throw new SupplyError('Shipment line allocation is invalid.'); }
    const existing = await tx.supplyShipment.findFirst({ where: { organizationId: actor.organizationId, referenceType: input.referenceType, reference: input.reference, carrier: input.carrier || null } });
    if (existing && existing.orderId !== order.id) throw new SupplyError('This shipment reference is already attached to another order. Review the match.');
    if (existing) return existing;
    const shipment = await tx.supplyShipment.create({ data: { organizationId: actor.organizationId, orderId: order.id, referenceType: input.referenceType, reference: input.reference, carrier: input.carrier || null, destination: input.destination || order.destination, timezone: input.timezone, nextCheckAt: new Date(), lines: { create: input.lines.map(l => ({ lineId: l.lineId, quantity: l.quantity })) } } });
    await audit(tx, actor, 'TRACKING_ATTACHED', { shipmentId: shipment.id, referenceType: input.referenceType }, order.id); return shipment;
  });
}
export async function saveCatalogItem(actor: SupplyActor, raw: unknown, db: PrismaClient = prisma) {
  const input = catalogInput.parse(raw);
  return mutate(actor, db, async tx => {
    await catalog(tx, actor, input.id);
    const data = { name: input.name, normalizedName: normalize(input.name), category: input.category, unit: input.unit, packSize: input.packSize, departments: input.departments, sharedUse: input.sharedUse, productAssociation: input.productAssociation, confirmed: true };
    const item = input.id ? await tx.supplyCatalogItem.update({ where: { organizationId_id: { organizationId: actor.organizationId, id: input.id } }, data }) : await tx.supplyCatalogItem.create({ data: { ...data, organizationId: actor.organizationId } });
    await tx.supplyCatalogAlias.deleteMany({ where: { organizationId: actor.organizationId, catalogItemId: item.id, supplier: '', sku: '' } });
    if (input.aliases.length) await tx.supplyCatalogAlias.createMany({ data: [...new Set(input.aliases.map(normalize))].map(alias => ({ organizationId: actor.organizationId, catalogItemId: item.id, alias })), skipDuplicates: true });
    await audit(tx, actor, 'CATALOG_SAVED', { itemId: item.id }); return item;
  });
}
export async function ignoreSupply(actor: SupplyActor, raw: unknown, db: PrismaClient = prisma) {
  const input = ignoreInput.parse(raw);
  return mutate(actor, db, async tx => {
    const line = input.lineId ? await tx.supplyOrderLine.findFirst({ where: { organizationId: actor.organizationId, id: input.lineId }, include: { allocations: true } }) : null;
    if (input.lineId && !line) throw new SupplyError('Line is unavailable.');
    if (input.ignored && line?.allocations.some(a => a.quantity !== null)) throw new SupplyError('Remove linked need allocations before ignoring this line.');
    if (input.ignored && input.orderId && await tx.supplyNeedAllocation.count({ where: { organizationId: actor.organizationId, quantity: { not: null }, line: { orderId: input.orderId } } })) throw new SupplyError('Remove linked need allocations before ignoring this order.');
    const result = input.orderId ? await tx.supplyOrder.updateMany({ where: { organizationId: actor.organizationId, id: input.orderId }, data: { ignored: input.ignored, manualFields: { push: 'ignored' } } }) : await tx.supplyOrderLine.updateMany({ where: { organizationId: actor.organizationId, id: input.lineId }, data: { ignored: input.ignored, manualClassification: true } });
    if (!result.count) throw new SupplyError('Record is unavailable.');
    await audit(tx, actor, 'VISIBILITY_REVIEWED', input, input.orderId ?? line?.orderId); return result;
  });
}
export async function saveArrivalExpectation(actor: SupplyActor, raw: unknown, db: PrismaClient = prisma) {
  const input = expectationInput.parse(raw);
  return mutate(actor, db, async tx => {
    const shipment = await tx.supplyShipment.findFirst({ where: { organizationId: actor.organizationId, id: input.shipmentId } });
    if (!shipment) throw new SupplyError('Shipment is unavailable.');
    try { new Intl.DateTimeFormat('en', { timeZone: input.timezone }); } catch { throw new SupplyError('Choose a valid time zone.'); }
    if (input.endDate && input.endDate < input.startDate) throw new SupplyError('Arrival range end must follow its start.');
    if (['TIME_WINDOW', 'APPOINTMENT'].includes(input.precision) && !input.timeStart) throw new SupplyError('A time window or appointment needs a local start time.');
    await tx.supplyArrivalEstimate.updateMany({ where: { organizationId: actor.organizationId, shipmentId: shipment.id, source: input.source, current: true }, data: { current: false } });
    const estimate = await tx.supplyArrivalEstimate.create({ data: { ...input, organizationId: actor.organizationId, sourceEventAt: new Date() } });
    await audit(tx, actor, 'ARRIVAL_EXPECTATION_SAVED', { estimateId: estimate.id, source: input.source }, shipment.orderId); return estimate;
  });
}
export async function saveClassificationRule(actor: SupplyActor, raw: unknown, db: PrismaClient = prisma) {
  const input = ruleInput.parse(raw);
  return mutate(actor, db, async tx => {
    await catalog(tx, actor, input.catalogItemId);
    if (input.id && !await tx.supplyClassificationRule.findFirst({ where: { organizationId: actor.organizationId, id: input.id } })) throw new SupplyError('Rule is unavailable.');
    const data = { supplier: normalize(input.supplier), sku: normalize(input.sku), department: input.department, unit: input.unit, catalogItemId: input.catalogItemId, explanation: input.explanation, active: input.active, reviewedByUserId: actor.userId };
    const rule = input.id ? await tx.supplyClassificationRule.update({ where: { id: input.id }, data }) : await tx.supplyClassificationRule.upsert({ where: { organizationId_supplier_sku: { organizationId: actor.organizationId, supplier: data.supplier, sku: data.sku } }, create: { ...data, organizationId: actor.organizationId }, update: data });
    await audit(tx, actor, 'CLASSIFICATION_RULE_SAVED', { ruleId: rule.id }); return rule;
  });
}
export async function updateLineDetails(actor: SupplyActor, raw: unknown, db: PrismaClient = prisma) {
  const input = lineDetailsInput.parse(raw);
  return mutate(actor, db, async tx => {
    const line = await tx.supplyOrderLine.findFirst({ where: { organizationId: actor.organizationId, id: input.lineId }, include: { receiptLines: true, allocations: true } });
    if (!line) throw new SupplyError('Line is unavailable.');
    const received = line.receiptLines.reduce((sum, r) => sum + Number(r.quantity), 0), allocated = line.allocations.reduce((sum, a) => sum + Number(a.quantity ?? 0), 0);
    if (input.quantity !== undefined && input.quantity < Math.max(received, allocated)) throw new SupplyError('Quantity cannot be less than received or allocated amounts.');
    if (input.unit !== undefined && !sameUnit(input.unit, line.unit) && (received || allocated)) throw new SupplyError('Units cannot change while quantities are received or allocated.');
    const { lineId: _lineId, ...data } = input;
    const fields = [...new Set([...line.manualFields, ...Object.keys(data)])];
    const result = await tx.supplyOrderLine.update({ where: { organizationId_id: { organizationId: actor.organizationId, id: line.id } }, data: { ...data, manualFields: fields } });
    await audit(tx, actor, 'LINE_DETAILS_REVIEWED', input, line.orderId); return result;
  });
}
export async function updateOrderDetails(actor: SupplyActor, raw: unknown, db: PrismaClient = prisma) {
  const input = orderDetailsInput.parse(raw);
  return mutate(actor, db, async tx => {
    const order = await tx.supplyOrder.findFirst({ where: { organizationId: actor.organizationId, id: input.orderId } });
    if (!order) throw new SupplyError('Order is unavailable.');
    const { orderId: _orderId, orderedAt, ...data } = input;
    const result = await tx.supplyOrder.update({ where: { organizationId_id: { organizationId: actor.organizationId, id: order.id } }, data: { ...data, ...(orderedAt ? { orderedAt: new Date(orderedAt) } : {}), manualFields: [...new Set([...order.manualFields, ...Object.keys(input).filter(k => k !== 'orderId')])] } });
    await audit(tx, actor, 'ORDER_DETAILS_REVIEWED', input, order.id); return result;
  });
}
export async function updateNeedDetails(actor: SupplyActor, raw: unknown, db: PrismaClient = prisma) {
  const input = needDetailsInput.parse(raw);
  return mutate(actor, db, async tx => {
    const need = await tx.supplyNeed.findFirst({ where: { organizationId: actor.organizationId, id: input.needId }, include: { allocations: true } });
    if (!need || need.resolvedAt) throw new SupplyError('Choose an open need.');
    await catalog(tx, actor, input.catalogItemId);
    if (need.allocations.length && ((input.location !== undefined && normalize(input.location) !== normalize(need.location)) || (input.unit !== undefined && !sameUnit(input.unit, need.unit)) || (input.catalogItemId !== undefined && input.catalogItemId !== need.catalogItemId))) throw new SupplyError('Unlink replenishment before changing the material, location or unit.');
    const received = need.allocations.reduce((sum, a) => sum + Number(a.receivedQuantity), 0);
    if (input.quantity !== undefined && input.quantity < received) throw new SupplyError('Needed quantity cannot be lower than quantities already received.');
    const { needId: _needId, ...data } = input;
    const result = await tx.supplyNeed.update({ where: { organizationId_id: { organizationId: actor.organizationId, id: need.id } }, data });
    await audit(tx, actor, 'NEED_DETAILS_REVIEWED', input, undefined, need.id); return result;
  });
}

type SupplyLineFact = NonNullable<z.infer<typeof supplyEvidenceInput>['evidence']>['lines'][number];
/** Exact source identifiers and units only; a reviewed order association never implies a fuzzy item merge. */
async function reconcileOrderLineEvidence(tx: Tx, actor: SupplyActor, order: { id: string; supplier: string; destination: string | null }, facts: SupplyLineFact[], observedAt: Date) {
  const [items, rules, existingLines] = await Promise.all([
    tx.supplyCatalogItem.findMany({ where: { organizationId: actor.organizationId }, include: { aliases: true } }),
    tx.supplyClassificationRule.findMany({ where: { organizationId: actor.organizationId, active: true } }),
    tx.supplyOrderLine.findMany({ where: { organizationId: actor.organizationId, orderId: order.id } }),
  ]);
  const occurrences = new Map<string, number>(), used = new Set<string>();
  let review = false;
  for (const fact of facts) {
    const matches = items.filter(item => normalize(item.name) === normalize(fact.description) || item.aliases.some(alias => (!alias.supplier || normalize(alias.supplier) === normalize(order.supplier)) && (alias.sku ? normalize(alias.sku) === normalize(fact.sku) : normalize(alias.alias) === normalize(fact.description))));
    const item = fact.catalogItemId ? await catalog(tx, actor, fact.catalogItemId) : matches.length === 1 ? matches[0] : null;
    const baseKey = fingerprint(fact.sku ? `sku:${normalize(fact.sku)}` : `description:${normalize(fact.description)}`, normalize(fact.unit));
    const occurrence = occurrences.get(baseKey) ?? 0; occurrences.set(baseKey, occurrence + 1);
    const lineKey = `${baseKey}:${occurrence}`;
    let existing = existingLines.find(line => line.lineKey === lineKey && !used.has(line.id));
    // A manual row has a different internal key. Reuse it only for one exact SKU
    // and unit match, never for a similar description or a shortened vendor code.
    if (!existing && fact.sku) {
      const exact = existingLines.filter(line => !used.has(line.id) && normalize(line.sku) === normalize(fact.sku) && normalize(line.unit) === normalize(fact.unit));
      if (exact.length === 1) existing = exact[0];
    }
    if (existing) used.add(existing.id);
    if (existing?.lastEvidenceAt && existing.lastEvidenceAt > observedAt) continue;
    const classification = classifyLine({ supplier: order.supplier, sku: fact.sku, unit: fact.unit, packSize: fact.packSize, catalog: item, rules });
    review ||= !existing?.manualClassification && classification.department === 'NEEDS_REVIEW';
    const data = { description: fact.description, sku: fact.sku, quantity: fact.quantity, unit: fact.unit, packSize: fact.packSize, backorderedQuantity: fact.backorderedQuantity, lastEvidenceAt: observedAt,
      ...(existing?.manualClassification ? {} : { catalogItemId: classification.catalogItemId ?? item?.id, department: classification.department, classificationSource: classification.source, classificationConfidence: classification.confidence, classificationExplanation: classification.explanation }) };
    const update = existing ? Object.fromEntries(Object.entries(data).filter(([key]) => !existing.manualFields.includes(key))) : data;
    const line = existing ? await tx.supplyOrderLine.update({ where: { organizationId_id: { organizationId: actor.organizationId, id: existing.id } }, data: update }) : await tx.supplyOrderLine.create({ data: { ...data, organizationId: actor.organizationId, orderId: order.id, lineKey } });
    if (!existing) { existingLines.push(line); used.add(line.id); }
    if (line.catalogItemId && ['PRODUCTION', 'SHARED'].includes(line.department) && order.destination) {
      const needs = await tx.supplyNeed.findMany({ where: { organizationId: actor.organizationId, catalogItemId: line.catalogItemId, location: order.destination, resolvedAt: null } });
      for (const need of needs) await tx.supplyNeedAllocation.upsert({ where: { organizationId_needId_lineId: { organizationId: actor.organizationId, needId: need.id, lineId: line.id } }, create: { organizationId: actor.organizationId, needId: need.id, lineId: line.id, explanation: 'Catalog material and destination match. Quantity coverage remains unknown until reviewed.' }, update: {} });
    }
  }
  return { review };
}
export async function reviewSupplySource(actor: SupplyActor, raw: unknown, db: PrismaClient = prisma) {
  const input = z.object({ sourceId: z.string().min(1).max(120), decision: z.enum(['ATTACH', 'IGNORE']), orderId: z.string().max(120).optional() }).parse(raw);
  return mutate(actor, db, async tx => {
    const source = await tx.supplySource.findFirst({ where: { id: input.sourceId, organizationId: actor.organizationId, userId: actor.userId } });
    if (!source) throw new SupplyError('Only the original mailbox owner can review this unconfirmed source.');
    if (input.decision === 'IGNORE') {
      await tx.supplySource.update({ where: { id: source.id }, data: { extractionStatus: 'IGNORED', nextExtractionAt: null } });
      await audit(tx, actor, 'SOURCE_IGNORED', { sourceId: source.id }); return { id: source.id };
    }
    const order = input.orderId ? await tx.supplyOrder.findFirst({ where: { organizationId: actor.organizationId, id: input.orderId } }) : null;
    if (!order) throw new SupplyError('Choose the existing order this operational evidence belongs to.');
    const evidence = supplyEvidenceInput.shape.evidence.safeParse(source.extractedFacts);
    if (!evidence.success || !evidence.data || !['ORDER', 'SHIPMENT'].includes(evidence.data.kind)) throw new SupplyError('No validated order or shipment facts are available. Correct extraction or enter the order manually.');
    const lineResult = await reconcileOrderLineEvidence(tx, actor, order, evidence.data.lines, source.messageDate);
    const newer = !order.lastEvidenceAt || source.messageDate >= order.lastEvidenceAt;
    const orderData: Prisma.SupplyOrderUpdateInput = {};
    for (const key of ['orderedAt', 'invoiceDate', 'paymentDate', 'estimatedShipDate'] as const) if (evidence.data[key] && !order.manualFields.includes(key) && (newer || !order[key])) orderData[key] = new Date(evidence.data[key]!);
    if (newer) orderData.lastEvidenceAt = source.messageDate;
    orderData.reviewRequired = lineResult.review || Boolean(await tx.supplyOrderLine.count({ where: { organizationId: actor.organizationId, orderId: order.id, department: 'NEEDS_REVIEW', ignored: false } }));
    await tx.supplyOrder.update({ where: { organizationId_id: { organizationId: actor.organizationId, id: order.id } }, data: orderData });
    for (const shipping of evidence.data.shipments) {
      const existing = await tx.supplyShipment.findFirst({ where: { organizationId: actor.organizationId, referenceType: shipping.referenceType, reference: shipping.reference, carrier: shipping.carrier || null } });
      if (existing && existing.orderId !== order.id) throw new SupplyError('This tracking reference belongs to another order. Review that relationship first.');
      if (!existing) await tx.supplyShipment.create({ data: { organizationId: actor.organizationId, orderId: order.id, referenceType: shipping.referenceType, reference: shipping.reference, carrier: shipping.carrier || null, destination: order.destination, status: shipping.status || 'UNKNOWN', statusEventAt: source.messageDate, nextCheckAt: new Date(), arrivalEstimates: shipping.eta ? { create: [{ ...shipping.eta, sourceId: source.id, sourceEventAt: source.messageDate }] } : undefined } });
    }
    await tx.supplyOrderSource.upsert({ where: { organizationId_orderId_sourceId: { organizationId: actor.organizationId, orderId: order.id, sourceId: source.id } }, create: { organizationId: actor.organizationId, orderId: order.id, sourceId: source.id }, update: {} });
    await tx.supplySource.update({ where: { id: source.id }, data: { extractionStatus: 'COMPLETE', extractionError: source.extractionError && /incomplete|unsupported/i.test(source.extractionError) ? source.extractionError : null, nextExtractionAt: null } });
    await audit(tx, actor, 'SOURCE_MANUALLY_ATTACHED', { sourceId: source.id, rawReferencePreserved: true }, order.id); return { id: source.id, orderId: order.id };
  });
}

const optionalFact = z.string().trim().max(300).nullable().optional();
const factQuantity = z.number().finite().nonnegative().max(1e10).nullable().optional();
const arrivalFact = z.object({ source: z.enum(['SUPPLIER_PROMISE', 'CARRIER', 'PREDICTION', 'APPOINTMENT', 'MANUAL']), precision: z.enum(['DATE', 'DATE_RANGE', 'TIME_WINDOW', 'APPOINTMENT']), startDate: z.string().date(), endDate: z.string().date().nullable().optional(), timeStart: optionalFact, timeEnd: optionalFact, timezone: z.string().max(100).default('America/New_York') });
export const supplyEvidenceInput = z.object({
  source: z.object({ mailboxConnectionId: optionalFact, provider: z.string().min(1).max(50), messageId: z.string().min(1).max(500), attachmentKey: z.string().max(500).default(''), messageDate: z.string().datetime({ offset: true }), contentHash: z.string().min(1).max(128), filename: optionalFact, mimeType: optionalFact, subject: optionalFact, historical: z.boolean().default(false), extractionStatus: z.enum(['COMPLETE', 'ERROR', 'UNSUPPORTED', 'REVIEW']), extractionError: z.string().max(1000).optional() }),
  evidence: z.object({ kind: z.enum(['ORDER', 'SHIPMENT', 'WARNING', 'QUOTE', 'OTHER']), orderStatus: z.enum(['ORDERED','CANCELLED']).nullish(), orderDeliveryComplete: z.boolean().nullish(), orderDeliveredDate: z.string().date().nullish(), warningSource: z.enum(['DISTILLX5_EMAIL','OTHER_EMAIL']).nullish(), supplier: optionalFact, orderReference: optionalFact, orderedAt: z.string().date().nullable().optional(), invoiceDate: z.string().date().nullable().optional(), paymentDate: z.string().date().nullable().optional(), estimatedShipDate: z.string().date().nullable().optional(), destination: optionalFact, lines: z.array(z.object({ description: z.string().trim().min(1).max(300), sku: optionalFact, quantity: factQuantity, unit: optionalFact, packSize: factQuantity, department: z.enum(['PRODUCTION', 'BAR', 'SHARED', 'OTHER', 'NEEDS_REVIEW']).optional(), catalogItemId: optionalFact, backorderedQuantity: factQuantity })).max(100).default([]), shipments: z.array(z.object({ referenceType: z.enum(['PARCEL', 'FREIGHT_PRO', 'BILL_OF_LADING', 'SUPPLIER_ORDER']), reference: z.string().min(1).max(300), carrier: optionalFact, status: z.enum(['UNKNOWN', 'LABEL_CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'PICKUP_REQUIRED', 'DELAYED', 'CANCELLED', 'RETURNED']).optional(), eta: arrivalFact.nullable().optional() })).max(30).default([]), warning: z.object({ material: z.string().trim().min(1).max(300), materialId: optionalFact, location: z.string().trim().min(1).max(300), quantity: factQuantity, threshold: factQuantity, unit: optionalFact }).nullable().optional() }).optional(),
});
export type SupplyEvidenceInput = z.input<typeof supplyEvidenceInput>;

/** Trusted caller supplies an identity; email/attachment text is validated data only. */
export async function ingestEvidence(actor: SupplyActor, raw: unknown, db: PrismaClient = prisma, options: { reconcile?: boolean } = {}): Promise<{ sourceId: string; orderId?: string; needId?: string; review: boolean; newWatchedMaterial?: boolean }> {
  const input = supplyEvidenceInput.parse(raw);
  const result = await db.$transaction(async tx => {
    const context = await assertSupplyActor(tx, actor, false);
    const manager = hasSupplyAccess(context.user, readSupplySettings(context.organization.crmPreferences), true);
    if (input.source.mailboxConnectionId) {
      const mailbox = await tx.mailboxConnection.findFirst({ where: { id: input.source.mailboxConnectionId, organizationId: actor.organizationId, userId: actor.userId, enabled: true } });
      if (!mailbox || !productionMemberIds(context.organization.crmPreferences).includes(actor.userId) || !canReadSupplyMailbox(mailbox)) throw new SupplyError('An authorized Production mailbox with message-reading permission is required.');
    } else if (!manager) throw new SupplyError('Manual evidence import requires management permission.');
    await lock(tx, actor.organizationId);
    const sourceData = { ...input.source, organizationId: actor.organizationId, userId: actor.userId, messageDate: new Date(input.source.messageDate), extractedFacts: input.evidence ? json(input.evidence) : Prisma.JsonNull };
    const previousSource = await tx.supplySource.findFirst({ where: { organizationId: actor.organizationId, mailboxConnectionId: input.source.mailboxConnectionId || null, messageId: input.source.messageId, attachmentKey: input.source.attachmentKey } });
    const source = previousSource ? await tx.supplySource.update({ where: { id: previousSource.id }, data: sourceData }) : await tx.supplySource.create({ data: sourceData });
    if (!input.evidence || input.source.extractionStatus !== 'COMPLETE') return { sourceId: source.id, review: input.source.extractionStatus !== 'UNSUPPORTED' || Boolean(input.evidence) };
    // Keep the original validated source facts above; only scoped facts become operations.
    const evidence = (await scopeSupplyEvidence(actor.organizationId, input.evidence, tx)).evidence;
    if (!evidence) return { sourceId: source.id, review: false };
    const observedAt = source.messageDate;
    if (evidence.kind === 'WARNING') {
      const warning = evidence.warning;
      if (!warning) { await tx.supplySource.update({ where: { id: source.id }, data: { extractionStatus: 'REVIEW', extractionError: 'Low-stock warning material or location could not be extracted.' } }); return { sourceId: source.id, review: true }; }
      const items = await tx.supplyCatalogItem.findMany({ where: { organizationId: actor.organizationId }, include: { aliases: true } });
      const matches = items.filter(item => normalize(item.name) === normalize(warning.material) || item.aliases.some(alias => !alias.supplier && !alias.sku && normalize(alias.alias) === normalize(warning.material)));
      const item = matches.length === 1 ? matches[0] : null;
      const activeKey = fingerprint(item?.id || normalize(warning.materialId || warning.material), normalizeSupplyLocation(warning.location));
      const warningKey = fingerprint(input.source.contentHash, warning.material, warning.location, observedAt.toISOString());
      const occurrence = await tx.supplyWarningOccurrence.findUnique({ where: { organizationId_warningKey: { organizationId: actor.organizationId, warningKey } } });
      if (occurrence) {const priorFacts=previousSource?.extractedFacts as {kind?:string;warningSource?:string}|null;return { sourceId: source.id, needId: occurrence.needId, review: false, newWatchedMaterial:priorFacts?.kind!=='WARNING' || priorFacts.warningSource!=='DISTILLX5_EMAIL' };}
      let need = await tx.supplyNeed.findUnique({ where: { organizationId_activeKey: { organizationId: actor.organizationId, activeKey } } });
      const identities:Prisma.SupplyNeedWhereInput[]=[{description:{equals:warning.material,mode:'insensitive'}},...(warning.materialId?[{description:{equals:warning.materialId,mode:Prisma.QueryMode.insensitive}}]:[]),...(item?[{catalogItemId:item.id}]:[])];
      if(!need){const candidates=await tx.supplyNeed.findMany({where:{organizationId:actor.organizationId,resolvedAt:null,OR:identities},orderBy:[{createdAt:'asc'},{id:'asc'}],take:100});need=candidates.find(candidate=>normalizeSupplyLocation(candidate.location)===normalizeSupplyLocation(warning.location)) || null;}
      if (!need) {
        // Replayed warnings older than a resolution remain historical evidence.
        const resolved=await tx.supplyNeed.findMany({ where: { organizationId: actor.organizationId,OR:identities,resolvedAt: { gte: observedAt } }, orderBy: { resolvedAt: 'asc' },take:100 });
        need=resolved.find(candidate=>normalizeSupplyLocation(candidate.location)===normalizeSupplyLocation(warning.location)) || null;
      }
      const wasWatched=need ? Boolean(await tx.supplyWarningOccurrence.count({where:{organizationId:actor.organizationId,needId:need.id,sourceId:{not:source.id},source:{AND:[{extractedFacts:{path:['kind'],equals:'WARNING'}},{extractedFacts:{path:['warningSource'],equals:'DISTILLX5_EMAIL'}}]}}})) : false;
      if (!need) need = await tx.supplyNeed.create({ data: { organizationId: actor.organizationId, dedupeKey: `warning:${warningKey}`, activeKey, description: warning.material, catalogItemId: item?.id, location: warning.location, unit: warning.unit, source: evidence.warningSource || 'OTHER_EMAIL', latestWarningAt: observedAt, reportedQuantity: warning.quantity, reportedThreshold: warning.threshold, reviewRequired: !item, ownerUserId: actor.userId } });
      else if (!need.latestWarningAt || observedAt > need.latestWarningAt) need = await tx.supplyNeed.update({ where: { organizationId_id: { organizationId: actor.organizationId, id: need.id } }, data: { latestWarningAt: observedAt, unit:warning.unit || null, reportedQuantity: warning.quantity, reportedThreshold: warning.threshold,source:'DISTILLX5_EMAIL' } });
      await tx.supplyWarningOccurrence.create({ data: { organizationId: actor.organizationId, needId: need.id, sourceId: source.id, warningKey, warningAt: observedAt, reportedQuantity: warning.quantity, reportedThreshold: warning.threshold } });
      if (item && !need.resolvedAt) {
        const lines = await tx.supplyOrderLine.findMany({ where: { organizationId: actor.organizationId, catalogItemId: item.id, ignored: false, department: { in: ['PRODUCTION', 'SHARED'] }, order: { ignored: false, status: { notIn: ['CANCELLED', 'RECEIVED'] }, destination: warning.location } }, take: 30 });
        for (const line of lines) await tx.supplyNeedAllocation.upsert({ where: { organizationId_needId_lineId: { organizationId: actor.organizationId, needId: need.id, lineId: line.id } }, create: { organizationId: actor.organizationId, needId: need.id, lineId: line.id, explanation: 'Catalog material and destination match. Replenishment quantity has not been confirmed.' }, update: {} });
      }
      await audit(tx, actor, 'WARNING_OBSERVED', { sourceId: source.id, warningAt: observedAt.toISOString(), historical: input.source.historical }, undefined, need.id);
      return { sourceId: source.id, needId: need.id, review: need.reviewRequired,newWatchedMaterial:!wasWatched };
    }
    const supplier = evidence.supplier?.trim(), normalizedSupplier = normalize(supplier), reference = evidence.orderReference?.trim();
    let order = reference ? await tx.supplyOrder.findMany({ where: { organizationId: actor.organizationId, orderReference: reference, ...(supplier ? { normalizedSupplier } : {}) }, take: 5 }).then(candidates => {
      const matches = candidates.filter(candidate => evidence.orderedAt && candidate.orderedAt ? candidate.orderedAt.toISOString().slice(0, 10) === evidence.orderedAt : Math.abs(observedAt.getTime() - candidate.createdAt.getTime()) < 180 * 86400000);
      return matches.length === 1 ? matches[0] : null;
    }) : null;
    // Cross-mailbox duplicates without an order reference need identical source evidence.
    if (!order) { const same = await tx.supplyOrderSource.findFirst({ where: { organizationId: actor.organizationId, source: { contentHash: source.contentHash, messageDate: observedAt } }, include: { order: true } }); order = same?.order ?? null; }
    if (!order && evidence.shipments.length) {
      const mapped = await tx.supplyShipment.findMany({ where: { organizationId: actor.organizationId, OR: evidence.shipments.map(s => ({ referenceType: s.referenceType, reference: s.reference, ...(s.carrier ? { carrier: s.carrier } : {}) })) }, include: { order: true }, take: 10 });
      const orderIds = [...new Set(mapped.map(s => s.orderId))]; if (orderIds.length === 1) order = mapped[0].order;
    }
    if (!order && (!supplier || evidence.kind === 'SHIPMENT' || evidence.orderStatus === 'CANCELLED')) { await tx.supplySource.update({ where: { id: source.id }, data: { extractionStatus: 'REVIEW', extractionError: 'This notice could not be reliably matched to an order.' } }); return { sourceId: source.id, review: true }; }
    if (normalizeSupplyLocation(order?.destination) && normalizeSupplyLocation(evidence.destination) && normalizeSupplyLocation(order?.destination) !== normalizeSupplyLocation(evidence.destination)) { await tx.supplySource.update({ where: { id: source.id }, data: { extractionStatus: 'REVIEW', extractionError: 'Order reference matches but destinations conflict. Review the relationship.' } }); return { sourceId: source.id, review: true }; }
    if (!order && reference) {
      const ambiguous = await tx.supplyOrder.count({ where: { organizationId: actor.organizationId, normalizedSupplier, orderReference: reference } });
      if (ambiguous) { await tx.supplySource.update({ where: { id: source.id }, data: { extractionStatus: 'REVIEW', extractionError: 'Multiple or conflicting order references require review.' } }); return { sourceId: source.id, review: true }; }
    }
    if (!order) order = await tx.supplyOrder.create({ data: { organizationId: actor.organizationId, dedupeKey: reference ? fingerprint(normalizedSupplier, reference, evidence.orderedAt || '') : `evidence:${fingerprint(source.contentHash, observedAt.toISOString())}`, supplier: supplier!, normalizedSupplier, orderReference: reference || null, destination: evidence.destination, ownerUserId: actor.userId, orderedAt: evidence.orderedAt ? new Date(evidence.orderedAt) : null, invoiceDate: evidence.invoiceDate ? new Date(evidence.invoiceDate) : null, paymentDate: evidence.paymentDate ? new Date(evidence.paymentDate) : null, estimatedShipDate: evidence.estimatedShipDate ? new Date(evidence.estimatedShipDate) : null, lastEvidenceAt: observedAt, historicalOutcomeUnknown: input.source.historical && observedAt.getTime() < Date.now() - 30 * 86400000 } });
    else if (!order.lastEvidenceAt || observedAt >= order.lastEvidenceAt) {
      const data: Prisma.SupplyOrderUpdateInput = { lastEvidenceAt: observedAt };
      if (evidence.orderStatus && !order.manualFields.includes('status')) data.status = evidence.orderStatus;
      if (!order.manualFields.includes('destination') && evidence.destination) data.destination = evidence.destination;
      for (const key of ['orderedAt', 'invoiceDate', 'paymentDate', 'estimatedShipDate'] as const) if (!order.manualFields.includes(key) && evidence[key]) data[key] = new Date(evidence[key]!);
      order = await tx.supplyOrder.update({ where: { organizationId_id: { organizationId: actor.organizationId, id: order.id } }, data });
    }
    await tx.supplyOrderSource.upsert({ where: { organizationId_orderId_sourceId: { organizationId: actor.organizationId, orderId: order.id, sourceId: source.id } }, create: { organizationId: actor.organizationId, orderId: order.id, sourceId: source.id }, update: {} });
    let review = (await reconcileOrderLineEvidence(tx, actor, order, evidence.lines, observedAt)).review;
    for (const shipping of evidence.shipments) {
      let shipment = await tx.supplyShipment.findFirst({ where: { organizationId: actor.organizationId, referenceType: shipping.referenceType, reference: shipping.reference, carrier: shipping.carrier || null } });
      if (shipment && shipment.orderId !== order.id) { review = true; continue; }
      if (!shipment) shipment = await tx.supplyShipment.create({ data: { organizationId: actor.organizationId, orderId: order.id, referenceType: shipping.referenceType, reference: shipping.reference, carrier: shipping.carrier || null, destination: order.destination, status: shipping.status || 'UNKNOWN', statusEventAt: observedAt, nextCheckAt: new Date() } });
      else if ((!shipment.statusEventAt || observedAt > shipment.statusEventAt) && shipping.status && !shipment.lastSuccessfulCheckAt) await tx.supplyShipment.update({ where: { organizationId_id: { organizationId: actor.organizationId, id: shipment.id } }, data: { status: shipping.status, statusEventAt: observedAt } });
      if (shipping.eta) {
        const current = await tx.supplyArrivalEstimate.findFirst({ where: { organizationId: actor.organizationId, shipmentId: shipment.id, source: shipping.eta.source, current: true }, orderBy: { sourceEventAt: 'desc' } });
        if (!current || observedAt > current.sourceEventAt) {
          await tx.supplyArrivalEstimate.updateMany({ where: { organizationId: actor.organizationId, shipmentId: shipment.id, source: shipping.eta.source, current: true }, data: { current: false } });
          await tx.supplyArrivalEstimate.create({ data: { ...shipping.eta, organizationId: actor.organizationId, shipmentId: shipment.id, sourceEventAt: observedAt, sourceId: source.id } });
        }
      }
    }
    const reviewCount = await tx.supplyOrderLine.count({ where: { organizationId: actor.organizationId, orderId: order.id, department: 'NEEDS_REVIEW', ignored: false } });
    await tx.supplyOrder.update({ where: { organizationId_id: { organizationId: actor.organizationId, id: order.id } }, data: { reviewRequired: Boolean(reviewCount) || review } });
    await audit(tx, actor, 'EVIDENCE_RECONCILED', { sourceId: source.id, historical: source.historical }, order.id);
    return { sourceId: source.id, orderId: order.id, review: Boolean(reviewCount) || review };
  }, { timeout: 45000 });
  if (options.reconcile !== false) {
    // Reconciliation cannot turn a committed source into a failed mailbox extraction.
    try {
      if (result.newWatchedMaterial) await replayWatchedSupplyEvidence(actor.organizationId, db, ingestEvidence);
      else if (result.orderId && input.evidence?.kind === 'ORDER') await reconcileUnmatchedSupplyEvidence(actor.organizationId, db);
    } catch { /* Retained source facts remain available for later bounded reconciliation. */ }
  }
  return result;
}
/** Newest-first backfill can discover a shipping notice before its confirmation. */
export async function reconcileUnmatchedSupplyEvidence(organizationId: string, db: PrismaClient = prisma) {
  return replayWatchedSupplyEvidence(organizationId, db, ingestEvidence, { force: true });
}

export async function reconcileWatchedSupplyEvidence(organizationId: string, db: PrismaClient = prisma, options: ReplayOptions = {}) {
  return replayWatchedSupplyEvidence(organizationId, db, ingestEvidence, options);
}
