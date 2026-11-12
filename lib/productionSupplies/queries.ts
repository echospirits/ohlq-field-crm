import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';
import { formatDateInputValue } from '../dateTime';
import { productionMemberIds } from './config';
import { knownNumber, needCoverage, relevantDepartment, selectArrival } from './domain';

export type Serialized<T> = T extends Prisma.Decimal ? number : T extends Date ? string : T extends Array<infer U> ? Serialized<U>[] : T extends object ? { [K in keyof T]: Serialized<T[K]> } : T;
export function serializeSupply<T>(value: T): Serialized<T> {
  if (value instanceof Date) return value.toISOString() as Serialized<T>;
  if (Prisma.Decimal.isDecimal(value)) return Number(value) as Serialized<T>;
  if (Array.isArray(value)) return value.map(serializeSupply) as Serialized<T>;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serializeSupply(entry)])) as Serialized<T>;
  return value as Serialized<T>;
}
const usersSelect = { id: true, name: true, firstName: true, lastName: true, email: true } satisfies Prisma.UserSelect;
async function entitled(db: PrismaClient, organizationId: string) {
  const organization = await db.organization.findFirst({ where: { id: organizationId, active: true, accountStatus: { notIn: ['SUSPENDED', 'CANCELLED'] }, features: { some: { featureKey: 'PRODUCTION_SUPPLIES', enabled: true } } }, select: { timezone: true, crmPreferences: true } });
  if (!organization) throw new Error('Production Supplies is unavailable.'); return organization;
}
export async function getSupplyOptions(organizationId: string, db: PrismaClient = prisma) {
  await entitled(db, organizationId);
  const [users, catalog, needs, rules, orders] = await Promise.all([
    db.user.findMany({ where: { organizationId, isActive: true }, select: usersSelect, orderBy: { name: 'asc' } }),
    db.supplyCatalogItem.findMany({ where: { organizationId }, include: { aliases: true }, orderBy: { name: 'asc' }, take: 1000 }),
    db.supplyNeed.findMany({ where: { organizationId, resolvedAt: null }, orderBy: { updatedAt: 'desc' }, take: 300 }),
    db.supplyClassificationRule.findMany({ where: { organizationId }, orderBy: [{ supplier: 'asc' }, { sku: 'asc' }], take: 1000 }),
    db.supplyOrder.findMany({ where: { organizationId }, select: { id: true, supplier: true, orderReference: true, destination: true }, orderBy: { updatedAt: 'desc' }, take: 1000 }),
  ]);
  return serializeSupply({ users, catalog, needs, rules, orders });
}
export type SupplyFilters = { q?: string; material?: string; supplier?: string; owner?: string; location?: string; status?: string; department?: string; view?: string; sourceUserId?: string };
export async function getSupplyDashboard(organizationId: string, filters: SupplyFilters = {}, db: PrismaClient = prisma) {
  const organization = await entitled(db, organizationId);
  const view = ['incoming', 'ordering', 'attention', 'review', 'history'].includes(filters.view || '') ? filters.view! : 'incoming';
  const query = (filters.q || filters.material || '').trim().slice(0, 200);
  const where: Prisma.SupplyOrderWhereInput = { organizationId,
    ...(filters.supplier ? { supplier: { contains: filters.supplier, mode: 'insensitive' } } : {}),
    ...(filters.owner ? { ownerUserId: filters.owner === 'unassigned' ? null : filters.owner } : {}),
    ...(filters.location ? { destination: { contains: filters.location, mode: 'insensitive' } } : {}),
    ...(query ? { OR: [{ supplier: { contains: query, mode: 'insensitive' } }, { orderReference: { contains: query, mode: 'insensitive' } }, { lines: { some: { description: { contains: query, mode: 'insensitive' } } } }] } : {}),
  };
  const [orders, needs, syncs, users, catalog, notifications, reviewSources] = await Promise.all([
    db.supplyOrder.findMany({ where, include: { lines: { include: { catalogItem: true, receiptLines: true, allocations: { include: { need: true } } } }, shipments: { include: { arrivalEstimates: { orderBy: { observedAt: 'desc' } }, lines: true, receipts: { include: { lines: true } } }, orderBy: { createdAt: 'asc' } } }, orderBy: { updatedAt: 'desc' }, take: 300 }),
    db.supplyNeed.findMany({ where: { organizationId, ...(filters.owner ? { ownerUserId: filters.owner === 'unassigned' ? null : filters.owner } : {}), ...(filters.location ? { location: { contains: filters.location, mode: 'insensitive' } } : {}), ...(query ? { description: { contains: query, mode: 'insensitive' } } : {}) }, include: { catalogItem: true, allocations: { include: { line: { include: { receiptLines: true, allocations: { orderBy: { createdAt: 'asc' } }, order: { include: { shipments: { include: { arrivalEstimates: true, lines: true } } } } } } } }, warnings: { select: { id: true, warningAt: true, reportedQuantity: true, reportedThreshold: true }, orderBy: { warningAt: 'desc' }, take: 3 } }, orderBy: [{ resolvedAt: 'asc' }, { updatedAt: 'desc' }], take: 300 }),
    db.supplyMailboxSync.findMany({ where: { organizationId }, select: { id: true, userId: true, connectionId: true, status: true, backfillStartedAt: true, backfillCompletedAt: true, lastSuccessfulSyncAt: true, nextSyncAt: true, errorCode: true, errorMessage: true, processedCount: true } }),
    db.user.findMany({ where: { organizationId, isActive: true }, select: usersSelect, orderBy: { name: 'asc' } }),
    db.supplyCatalogItem.findMany({ where: { organizationId }, orderBy: { name: 'asc' }, take: 1000 }),
    db.supplyNotification.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take: 30 }),
    filters.sourceUserId ? db.supplySource.findMany({ where: { organizationId, userId: filters.sourceUserId, extractionStatus: { in: ['REVIEW', 'ERROR', 'UNSUPPORTED'] } }, select: { id: true, provider: true, messageId: true, messageDate: true, filename: true, extractionStatus: true, extractionError: true, userId: true }, orderBy: { messageDate: 'desc' }, take: 100 }) : Promise.resolve([]),
  ]);
  const today = formatDateInputValue(new Date(), organization.timezone);
  const byUser = new Map(users.map(u => [u.id, u]));
  const allOrders = orders.map(order => {
    const visibleLines = order.lines.filter(line => !line.ignored && (filters.department === 'ALL' ? true : filters.department ? line.department === filters.department : view === 'review' ? line.department === 'NEEDS_REVIEW' : relevantDepartment(line.department)));
    const shipments = order.shipments.map(shipment => ({ ...shipment, currentArrival: selectArrival(shipment.arrivalEstimates), stale: Boolean(shipment.checkError) || !shipment.lastSuccessfulCheckAt || Date.now() - shipment.lastSuccessfulCheckAt.getTime() > 12 * 3600000 }));
    const attention = !order.ignored && (order.historicalOutcomeUnknown || !shipments.length || shipments.some(s => s.stale || ['DELAYED', 'RETURNED', 'PICKUP_REQUIRED', 'DELIVERED'].includes(s.status)) || visibleLines.some(l => Number(l.backorderedQuantity ?? 0) > 0));
    return { ...order, lines: visibleLines, allLineCount: order.lines.length, owner: byUser.get(order.ownerUserId || '') ?? null, shipments, attention,
      outstandingQuantity: visibleLines.every(l => l.quantity !== null) && new Set(visibleLines.map(l => l.unit)).size === 1 ? visibleLines.reduce((sum, line) => sum + Math.max(0, Number(line.quantity) - line.receiptLines.reduce((q, r) => q + Number(r.quantity), 0)), 0) : null,
    };
  });
  const allNeeds = needs.map(need => ({ ...need, owner: byUser.get(need.ownerUserId || '') ?? null, coverage: needCoverage(need), warningAgeDays: need.latestWarningAt ? Math.max(0, Math.floor((Date.now() - need.latestWarningAt.getTime()) / 86400000)) : null }));
  const counts = { incoming: allOrders.filter(o => !o.ignored && !['RECEIVED', 'CANCELLED'].includes(o.status) && o.lines.length > 0).length, ordering: allNeeds.filter(n => !n.resolvedAt && n.coverage.coverage !== 'ADEQUATE').length, attention: allOrders.filter(o => o.attention && o.status !== 'RECEIVED' && o.lines.length > 0).length, review: orders.filter(o => o.reviewRequired && !o.ignored).length + reviewSources.length, history: allOrders.filter(o => o.ignored || ['RECEIVED', 'CANCELLED'].includes(o.status)).length + allNeeds.filter(n => n.resolvedAt).length };
  const filteredOrders = allOrders.filter(order => {
    if (filters.status && order.status !== filters.status && !order.shipments.some(s => s.status === filters.status)) return false;
    if (view === 'history') return order.ignored || ['RECEIVED', 'CANCELLED'].includes(order.status);
    if (order.ignored || ['RECEIVED', 'CANCELLED'].includes(order.status)) return false;
    if (view === 'review') return order.reviewRequired || order.lines.some(l => l.department === 'NEEDS_REVIEW');
    if (view === 'attention') return order.attention && order.lines.length > 0;
    return order.lines.length > 0;
  });
  const filteredNeeds = allNeeds.filter(need => view === 'history' ? Boolean(need.resolvedAt) : !need.resolvedAt && (view !== 'ordering' || need.coverage.coverage !== 'ADEQUATE'));
  const memberIds = productionMemberIds(organization.crmPreferences);
  const mailboxes = users.filter(u => memberIds.includes(u.id)).map(user => ({ ...syncs.find(s => s.userId === user.id), userId: user.id, user, status: syncs.find(s => s.userId === user.id)?.status || 'CONNECTION_REQUIRED' }));
  return serializeSupply({ orders: filteredOrders, needs: filteredNeeds, mailboxes, users, catalog, notifications, reviewSources, counts, today, timezone: organization.timezone, view, limited: orders.length === 300 || needs.length === 300 });
}
export async function getSupplyOrderDetail(organizationId: string, orderId: string, db: PrismaClient = prisma) {
  await entitled(db, organizationId);
  const order = await db.supplyOrder.findFirst({ where: { id: orderId, organizationId }, include: {
    lines: { include: { catalogItem: true, allocations: { include: { need: true } }, receiptLines: { include: { receipt: { select: { receivedAt: true, receivedByUserId: true, notes: true } } } } } },
    shipments: { include: { arrivalEstimates: { orderBy: { observedAt: 'desc' } }, observations: { select: { id: true, provider: true, providerEventAt: true, observedAt: true, status: true, summary: true }, orderBy: { providerEventAt: 'desc' }, take: 50 }, lines: true }, orderBy: { createdAt: 'asc' } },
    sources: { include: { source: { select: { id: true, userId: true, provider: true, messageId: true, messageDate: true, filename: true, mimeType: true, extractionStatus: true, extractionError: true, historical: true } } } },
    receipts: { include: { lines: true }, orderBy: { receivedAt: 'desc' } },
    audits: { orderBy: { createdAt: 'desc' }, take: 100 },
  } });
  if (!order) return null;
  const users = await db.user.findMany({ where: { organizationId, isActive: true }, select: usersSelect });
  return serializeSupply({ ...order, owner: users.find(u => u.id === order.ownerUserId) ?? null, lines: order.lines.map(line => ({ ...line, receivedQuantity: line.receiptLines.reduce((sum, r) => sum + Number(r.quantity), 0), outstandingQuantity: line.quantity === null ? null : Math.max(0, Number(line.quantity) - line.receiptLines.reduce((sum, r) => sum + Number(r.quantity), 0)) })), shipments: order.shipments.map(s => ({ ...s, currentArrival: selectArrival(s.arrivalEstimates), stale: Boolean(s.checkError) || !s.lastSuccessfulCheckAt || Date.now() - s.lastSuccessfulCheckAt.getTime() > 12 * 3600000 })) });
}
export const getSupplyOrder = getSupplyOrderDetail;
