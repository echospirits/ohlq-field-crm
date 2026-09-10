import { createHash } from 'node:crypto';
import { Prisma, WholesaleOrderFiledSource, WholesaleOrderStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from './prisma';

export const MAX_WHOLESALE_ORDER_TOTAL_CENTS = 2_147_483_647;
const WHOLESALE_ORDER_LIFECYCLE_LOCK = BigInt('6844526341739411205');

export const wholesaleOrderSnapshotSchema = z.object({
  version: z.literal(1),
  a3aSignature: z.string(),
  customerSignature: z.string(),
  saleDate: z.string().refine((value) => parseWholesaleOrderDate(value) !== null),
  customer: z.object({
    address: z.string(), city: z.string(), dba: z.string(), f2Permit: z.boolean(), name: z.string(),
    permitNumber: z.string(), phone: z.string(), postalCode: z.string(), state: z.string(),
  }),
  seller: z.object({
    addressLine1: z.string(), city: z.string(), email: z.string(), name: z.string(), phone: z.string(),
    postalCode: z.string(), state: z.string(), storeId: z.string(),
  }),
  lines: z.array(z.object({
    itemCode: z.string(), itemName: z.string(), quantityBottles: z.number().int().positive(),
    unitPriceCents: z.number().int().nonnegative(), wholesalePrice: z.number().nonnegative(), vendor: z.string(),
  })),
  totals: z.object({ subtotalCents: z.number().int().nonnegative(), sinTaxCents: z.number().int().nonnegative(), totalCents: z.number().int().nonnegative() }).superRefine((totals, context) => {
    if (totals.subtotalCents + totals.sinTaxCents !== totals.totalCents || totals.totalCents > MAX_WHOLESALE_ORDER_TOTAL_CENTS) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Snapshot totals are inconsistent or outside the supported range.' });
    }
  }),
});

export type WholesaleOrderSnapshot = z.infer<typeof wholesaleOrderSnapshotSchema>;
export type WholesaleOrderDb = Prisma.TransactionClient | typeof prisma;

export class WholesaleOrderLifecycleError extends Error {
  constructor(public readonly code: 'IDEMPOTENCY_CONFLICT' | 'INVALID_TRANSITION' | 'NOT_FOUND', message: string) {
    super(message);
    this.name = 'WholesaleOrderLifecycleError';
  }
}

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

export const hashWholesaleOrderRequest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');

export function parseWholesaleOrderDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

export function assertWholesaleOrderTotals(subtotalCents: number, sinTaxCents: number) {
  const totalCents = subtotalCents + sinTaxCents;
  if (![subtotalCents, sinTaxCents, totalCents].every(Number.isSafeInteger) || subtotalCents < 0 || sinTaxCents < 0 || totalCents > MAX_WHOLESALE_ORDER_TOTAL_CENTS) {
    throw new WholesaleOrderLifecycleError('INVALID_TRANSITION', 'The invoice total is outside the supported range.');
  }
  return totalCents;
}

export async function lockWholesaleOrderLifecycle(db: WholesaleOrderDb) {
  await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${WHOLESALE_ORDER_LIFECYCLE_LOCK})`);
}

type PersistGeneratedWholesaleOrderInput = {
  organizationId: string;
  wholesaleAccountId: string;
  directSaleLocationId: string;
  createdByUserId: string;
  clientRequestId: string;
  requestHash: string;
  snapshot: WholesaleOrderSnapshot;
  pdfBytes: Uint8Array;
  pdfFilename: string;
};

const ensureMatchingRetry = <T extends { requestHash: string }>(order: T, requestHash: string) => {
  if (order.requestHash !== requestHash) {
    throw new WholesaleOrderLifecycleError('IDEMPOTENCY_CONFLICT', 'This submission identifier was already used for different order details.');
  }
  return order;
};

export async function findWholesaleOrderRetry(organizationId: string, clientRequestId: string, requestHash: string, db: WholesaleOrderDb = prisma) {
  const existing = await db.wholesaleOrder.findUnique({
    where: { organizationId_clientRequestId: { organizationId, clientRequestId } },
  });
  return existing ? ensureMatchingRetry(existing, requestHash) : null;
}

export async function persistGeneratedWholesaleOrder(input: PersistGeneratedWholesaleOrderInput, db: typeof prisma = prisma) {
  const snapshot = wholesaleOrderSnapshotSchema.parse(input.snapshot);
  assertWholesaleOrderTotals(snapshot.totals.subtotalCents, snapshot.totals.sinTaxCents);
  const create = async () => db.$transaction(async (tx) => {
    await lockWholesaleOrderLifecycle(tx);
    const existing = await tx.wholesaleOrder.findUnique({
      where: { organizationId_clientRequestId: { organizationId: input.organizationId, clientRequestId: input.clientRequestId } },
    });
    if (existing) return { created: false, order: ensureMatchingRetry(existing, input.requestHash) };

    const order = await tx.wholesaleOrder.create({
      data: {
        organizationId: input.organizationId,
        wholesaleAccountId: input.wholesaleAccountId,
        directSaleLocationId: input.directSaleLocationId,
        createdByUserId: input.createdByUserId,
        clientRequestId: input.clientRequestId,
        requestHash: input.requestHash,
        saleDate: parseWholesaleOrderDate(snapshot.saleDate)!,
        customerName: snapshot.customer.name,
        customerDba: snapshot.customer.dba || null,
        customerPermitNumber: snapshot.customer.permitNumber,
        sellerName: snapshot.seller.name,
        sellerStoreNumber: snapshot.seller.storeId,
        subtotalCents: snapshot.totals.subtotalCents,
        sinTaxCents: snapshot.totals.sinTaxCents,
        totalCents: snapshot.totals.totalCents,
        inputSnapshot: snapshot,
        pdfBytes: Uint8Array.from(input.pdfBytes),
        pdfFilename: input.pdfFilename,
      },
    });
    return { created: true, order };
  }, { maxWait: 10_000, timeout: 30_000 });

  try {
    return await create();
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    const existing = await db.wholesaleOrder.findUnique({
      where: { organizationId_clientRequestId: { organizationId: input.organizationId, clientRequestId: input.clientRequestId } },
    });
    if (!existing) throw error;
    return { created: false, order: ensureMatchingRetry(existing, input.requestHash) };
  }
}

const orderActorSelect = { id: true, email: true, firstName: true, lastName: true, name: true } as const;
const orderViewSelect = {
  id: true,
  organizationId: true,
  wholesaleAccountId: true,
  status: true,
  saleDate: true,
  createdAt: true,
  inputSnapshot: true,
  subtotalCents: true,
  sinTaxCents: true,
  totalCents: true,
  pdfFilename: true,
  sentAt: true,
  filedAt: true,
  filedSource: true,
  matchedReportDate: true,
  reconciliationEvidence: true,
  createdByUser: { select: orderActorSelect },
  sentByUser: { select: orderActorSelect },
  filedByUser: { select: orderActorSelect },
} satisfies Prisma.WholesaleOrderSelect;

type OrderWithActors = Prisma.WholesaleOrderGetPayload<{ select: typeof orderViewSelect }>;

const actorName = (actor: OrderWithActors['createdByUser'] | null) => actor
  ? [actor.firstName, actor.lastName].filter(Boolean).join(' ').trim() || actor.name || actor.email
  : null;

export const toWholesaleOrderView = (order: OrderWithActors) => {
  const snapshot = wholesaleOrderSnapshotSchema.parse(order.inputSnapshot);
  return {
    id: order.id,
    organizationId: order.organizationId,
    wholesaleAccountId: order.wholesaleAccountId,
    status: order.status,
    saleDate: order.saleDate,
    createdAt: order.createdAt,
    customer: snapshot.customer,
    seller: snapshot.seller,
    lines: snapshot.lines,
    subtotalCents: order.subtotalCents,
    sinTaxCents: order.sinTaxCents,
    totalCents: order.totalCents,
    pdfFilename: order.pdfFilename,
    createdBy: { ...order.createdByUser, displayName: actorName(order.createdByUser) },
    sentAt: order.sentAt,
    sentBy: order.sentByUser ? { ...order.sentByUser, displayName: actorName(order.sentByUser) } : null,
    filedAt: order.filedAt,
    filedBy: order.filedByUser ? { ...order.filedByUser, displayName: actorName(order.filedByUser) } : null,
    filedSource: order.filedSource,
    matchedReportDate: order.matchedReportDate,
    reconciliationEvidence: order.reconciliationEvidence,
  };
};

export async function listWholesaleOrders({ organizationId, wholesaleAccountId, wholesaleAccountIds, status, page = 1, pageSize = 50 }: {
  organizationId: string;
  wholesaleAccountId?: string;
  wholesaleAccountIds?: string[];
  status?: WholesaleOrderStatus;
  page?: number;
  pageSize?: number;
}) {
  const accountIds = [...new Set([...(wholesaleAccountIds ?? []), ...(wholesaleAccountId ? [wholesaleAccountId] : [])])];
  const safePage = Math.max(1, Math.trunc(page));
  const safePageSize = Math.min(200, Math.max(1, Math.trunc(pageSize)));
  const where: Prisma.WholesaleOrderWhereInput = { organizationId, ...(accountIds.length ? { wholesaleAccountId: { in: accountIds } } : {}), ...(status ? { status } : {}) };
  const [orders, totalCount] = await Promise.all([
    prisma.wholesaleOrder.findMany({
      where,
      select: orderViewSelect,
      orderBy: [{ saleDate: 'desc' }, { createdAt: 'desc' }],
      skip: (safePage - 1) * safePageSize,
      take: safePageSize,
    }),
    prisma.wholesaleOrder.count({ where }),
  ]);
  return { orders: orders.map(toWholesaleOrderView), totalCount, page: safePage, pageSize: safePageSize };
}

export async function getWholesaleOrder({ id, organizationId }: { id: string; organizationId: string }) {
  const order = await prisma.wholesaleOrder.findFirst({ where: { id, organizationId }, select: orderViewSelect });
  return order ? toWholesaleOrderView(order) : null;
}

export async function getWholesaleOrderForDownload({ id, organizationId }: { id: string; organizationId: string }) {
  return prisma.wholesaleOrder.findFirst({
    where: { id, organizationId },
    select: { id: true, pdfBytes: true, pdfFilename: true },
  });
}

export async function markWholesaleOrderSent({ id, organizationId, actorUserId }: { id: string; organizationId: string; actorUserId: string }, db: typeof prisma = prisma) {
  return db.$transaction(async (tx) => {
    await lockWholesaleOrderLifecycle(tx);
    const order = await tx.wholesaleOrder.findFirst({ where: { id, organizationId }, select: { id: true, status: true, sentAt: true, sentByUserId: true } });
    if (!order) throw new WholesaleOrderLifecycleError('NOT_FOUND', 'Wholesale order not found.');
    if (order.status === WholesaleOrderStatus.SENT) return order;
    if (order.status !== WholesaleOrderStatus.PDF_GENERATED) throw new WholesaleOrderLifecycleError('INVALID_TRANSITION', 'Only a generated PDF can be marked Sent.');
    return tx.wholesaleOrder.update({ where: { id }, data: { status: WholesaleOrderStatus.SENT, sentAt: new Date(), sentByUserId: actorUserId }, select: { id: true, status: true, sentAt: true, sentByUserId: true } });
  }, { maxWait: 10_000, timeout: 30_000 });
}

export async function markWholesaleOrderFiledManually({ id, organizationId, actorUserId }: { id: string; organizationId: string; actorUserId: string }, db: typeof prisma = prisma) {
  return db.$transaction(async (tx) => {
    await lockWholesaleOrderLifecycle(tx);
    const order = await tx.wholesaleOrder.findFirst({ where: { id, organizationId }, select: { id: true, status: true, filedAt: true, filedByUserId: true, filedSource: true } });
    if (!order) throw new WholesaleOrderLifecycleError('NOT_FOUND', 'Wholesale order not found.');
    if (order.status === WholesaleOrderStatus.FILED) return order;
    return tx.wholesaleOrder.update({
      where: { id },
      data: { status: WholesaleOrderStatus.FILED, filedAt: new Date(), filedByUserId: actorUserId, filedSource: WholesaleOrderFiledSource.MANUAL },
      select: { id: true, status: true, filedAt: true, filedByUserId: true, filedSource: true },
    });
  }, { maxWait: 10_000, timeout: 30_000 });
}
