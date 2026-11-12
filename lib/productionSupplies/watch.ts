import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';
import { normalize } from './domain';
import { getWatchedSupplyMaterials } from './status';
import { matchWatchedSupplyLine, normalizeSupplyLocation, supplyMaterialSearchTerms, type WatchedSupplyMaterial } from './statusDomain';

type WatchDb = PrismaClient | Prisma.TransactionClient;
type WatchableLine = { description: string; sku?: string | null; catalogItemId?: string | null; unit?: string | null };
export type WatchableSupplyEvidence = {
  kind: string; supplier?: string | null; orderReference?: string | null; destination?: string | null;
  warningSource?: string | null; lines?: WatchableLine[];
  shipments?: Array<{ referenceType: string; reference: string; carrier?: string | null }>;
};
type WatchedOrder = { supplier: string; destination?: string | null; ignored: boolean; lines: Array<WatchableLine & { ignored: boolean; allocations: Array<{ needId: string }> }> };

/** Candidate query only: the shared exact matcher remains the final authority. */
export function watchedSupplyOrderWhere(organizationId: string, materials: WatchedSupplyMaterial[]): Prisma.SupplyOrderWhereInput {
  const needIds = [...new Set(materials.flatMap(material => material.needIds))];
  const catalogIds = [...new Set(materials.flatMap(material => material.catalogItemId ? [material.catalogItemId] : []))];
  const names = [...new Set(materials.flatMap(material => [material.material, ...material.aliases]).flatMap(supplyMaterialSearchTerms))];
  const vendorRefs = materials.flatMap(material => material.vendorRefs);
  return { organizationId, ignored: false, lines: { some: { organizationId, ignored: false, OR: [
    { allocations: { some: { organizationId, needId: { in: needIds } } } },
    { catalogItemId: { in: catalogIds } },
    ...names.map(description => ({ description: { contains: description, mode: Prisma.QueryMode.insensitive } })),
    ...vendorRefs.filter(reference => reference.supplier && reference.sku).map(reference => ({ sku: { equals: reference.sku, mode: Prisma.QueryMode.insensitive }, order: { normalizedSupplier: normalize(reference.supplier) } })),
  ] } } };
}

export async function getWatchedSupplyOrderScope(organizationId: string, db: WatchDb = prisma) {
  const materials = await getWatchedSupplyMaterials(organizationId, db);
  return { materials, orderWhere: watchedSupplyOrderWhere(organizationId, materials) };
}

export function isWatchedSupplyOrderRecord(order: WatchedOrder, materials: WatchedSupplyMaterial[]) {
  if (order.ignored) return false;
  const destination = normalizeSupplyLocation(order.destination);
  return order.lines.some(line => !line.ignored && materials.some(material => {
    const location = normalizeSupplyLocation(material.location);
    if (location && destination && location !== destination) return false;
    return line.allocations.some(allocation => material.needIds.includes(allocation.needId))
      || matchWatchedSupplyLine(material, { ...line, supplier: order.supplier, destination: order.destination }).matched;
  }));
}

export async function isWatchedSupplyOrder(organizationId: string, orderId: string, db: WatchDb = prisma, materials?: WatchedSupplyMaterial[]) {
  const watched = materials ?? await getWatchedSupplyMaterials(organizationId, db);
  if (!watched.length) return false;
  const order = await db.supplyOrder.findFirst({ where: { organizationId, id: orderId, ignored: false }, include: { lines: { where: { organizationId, ignored: false }, include: { allocations: { where: { organizationId }, select: { needId: true } } } } } });
  return Boolean(order && isWatchedSupplyOrderRecord(order, watched));
}

/** Keep only operational facts for Dx5-alerted materials; callers retain source evidence separately. */
export async function scopeSupplyEvidence<T extends WatchableSupplyEvidence>(organizationId: string, evidence: T, db: WatchDb = prisma): Promise<{ evidence: T | null; materialKeys: string[]; reason: string }> {
  if (evidence.kind === 'WARNING') return { evidence: evidence.warningSource === 'DISTILLX5_EMAIL' ? evidence : null, materialKeys: [], reason: 'Only Dx5 warnings open a watched material cycle.' };
  if (!['ORDER', 'SHIPMENT'].includes(evidence.kind)) return { evidence: null, materialKeys: [], reason: 'No operational supply update.' };
  const materials = await getWatchedSupplyMaterials(organizationId, db);
  if (!materials.length) return { evidence: null, materialKeys: [], reason: 'No Dx5-alerted materials are watched.' };
  const materialKeys = new Set<string>();
  const lines = (evidence.lines ?? []).flatMap(line => {
    const matches = materials.filter(material => matchWatchedSupplyLine(material, { ...line, supplier: evidence.supplier, destination: evidence.destination }).matched);
    // Ambiguous catalog identities cannot be chosen by a guessed description or SKU.
    const identities = new Set(matches.map(material => material.catalogItemId || normalize(material.material)));
    if (!matches.length || identities.size !== 1) return [];
    for (const match of matches) materialKeys.add(match.key);
    return [{ ...line, ...(matches[0].catalogItemId ? { catalogItemId: matches[0].catalogItemId } : {}) }];
  });
  if (lines.length) return { evidence: { ...evidence, lines }, materialKeys: [...materialKeys], reason: 'Matched a watched Dx5 material.' };
  const references: Prisma.SupplyOrderWhereInput[] = [];
  if (evidence.orderReference?.trim()) references.push({ orderReference: evidence.orderReference.trim(), ...(evidence.supplier ? { normalizedSupplier: normalize(evidence.supplier) } : {}) });
  if (evidence.shipments?.length) references.push({ shipments: { some: { organizationId, OR: evidence.shipments.map(shipment => ({ referenceType: shipment.referenceType, reference: shipment.reference, ...(shipment.carrier ? { carrier: shipment.carrier } : {}) })) } } });
  if (!references.length) return { evidence: null, materialKeys: [], reason: 'No watched material or retained order relationship.' };
  const orders = await db.supplyOrder.findMany({ where: { organizationId, ignored: false, OR: references }, take: 6, include: { lines: { where: { organizationId, ignored: false }, include: { allocations: { where: { organizationId }, select: { needId: true } } } } } });
  if (orders.length !== 1) return { evidence: null, materialKeys: [], reason: 'Order relationship is absent or ambiguous.' };
  const order = orders[0];
  const destination = normalizeSupplyLocation(evidence.destination), retainedDestination = normalizeSupplyLocation(order.destination);
  if (evidence.supplier && normalize(order.supplier) !== normalize(evidence.supplier) || destination && retainedDestination && destination !== retainedDestination) return { evidence: null, materialKeys: [], reason: 'Supplier or destination conflicts with the retained order.' };
  if (!isWatchedSupplyOrderRecord(order, materials)) return { evidence: null, materialKeys: [], reason: 'The retained order has no watched material.' };
  return { evidence: { ...evidence, lines: [] }, materialKeys: [], reason: 'Exact update for a retained watched-material order.' };
}
