import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from './prisma';
import {
  lockWholesaleOrderLifecycle,
  wholesaleOrderSnapshotSchema,
} from './wholesaleOrders';

export const WHOLESALE_ORDER_RECONCILIATION_WINDOW_DAYS = 7;
export type WholesaleOrderReconciliationLine = {
  itemCode: string;
  quantityBottles: number;
  vendor: string;
};

export type WholesaleOrderReconciliationOrder = {
  customerIdentity: string;
  customerPermitNumber: string;
  filedSource: 'AUTO_MATCH' | 'MANUAL' | null;
  id: string;
  lines: WholesaleOrderReconciliationLine[];
  organizationId: string;
  saleDate: Date;
  sellerStoreNumber: string;
  status: 'PDF_GENERATED' | 'SENT' | 'FILED';
};

export type WholesaleOrderReconciliationRow = {
  agencyId: string;
  itemCode: string;
  permitNumber: string;
  reportDate: Date;
  vendor: string;
  wholesaleBottlesSold: number;
};

export type WholesaleOrderEvidence = {
  automaticMatchKey: string;
  lines: WholesaleOrderReconciliationLine[];
  normalizedPermitNumber: string;
  reportDate: Date;
  sellerStoreNumber: string;
};

export type WholesaleOrderReconciliationMatch = {
  evidence: WholesaleOrderEvidence;
  orderId: string;
  organizationId: string;
};

export type WholesaleOrderReconciliationPlan = {
  ambiguousEvidenceKeys: string[];
  ambiguousOrderIds: string[];
  matches: WholesaleOrderReconciliationMatch[];
};

export type WholesaleOrderReconciliationResult = WholesaleOrderReconciliationPlan & {
  checkedOrders: number;
  filedOrders: number;
  stillOutstandingOrders: number;
};

const dateOnlyIso = (value: Date) => value.toISOString().slice(0, 10);

const addUtcDays = (value: Date, days: number) =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() + days));

const normalizeExactCode = (value: string) => value.trim().toUpperCase();

export function normalizeWholesalePermitNumber(value: string) {
  return normalizeExactCode(value)
    .split('-')
    .map((segment) => (/^\d+$/.test(segment) ? segment.replace(/^0+(?=\d)/, '') : segment))
    .join('-');
}

export function getWholesaleOrderAutomaticMatchKey({
  agencyId,
  permitNumber,
  reportDate,
}: Pick<WholesaleOrderReconciliationRow, 'agencyId' | 'permitNumber' | 'reportDate'>) {
  const identity = [
    'ohlq-wholesale-order-evidence-v1',
    dateOnlyIso(reportDate),
    normalizeExactCode(agencyId),
    normalizeWholesalePermitNumber(permitNumber),
  ].join(':');

  // The identity intentionally excludes the organization and quantities. A replay that
  // changes report contents still refers to the same physical customer/store/day evidence.
  return `${identity}:${createHash('sha256').update(identity).digest('hex').slice(0, 20)}`;
}

const lineKey = (line: Pick<WholesaleOrderReconciliationLine, 'itemCode' | 'vendor'>) =>
  `${normalizeExactCode(line.vendor)}\u0000${normalizeExactCode(line.itemCode)}`;

const canonicalEvidenceLines = (lines: WholesaleOrderReconciliationLine[]) =>
  lines
    .map((line) => ({
      itemCode: normalizeExactCode(line.itemCode),
      quantityBottles: line.quantityBottles,
      vendor: normalizeExactCode(line.vendor),
    }))
    .sort((left, right) => lineKey(left).localeCompare(lineKey(right)));

const hasUniquePositiveEvidenceLines = (lines: WholesaleOrderReconciliationLine[]) => {
  const keys = lines.map(lineKey);
  return lines.length > 0 &&
    lines.every((line) => Number.isInteger(line.quantityBottles) && line.quantityBottles > 0) &&
    new Set(keys).size === keys.length;
};

const canonicalOrderLines = (lines: WholesaleOrderReconciliationLine[]) => {
  const quantities = new Map<string, WholesaleOrderReconciliationLine>();
  for (const line of lines) {
    if (!Number.isInteger(line.quantityBottles) || line.quantityBottles <= 0) return [];
    const normalized = {
      itemCode: normalizeExactCode(line.itemCode),
      quantityBottles: line.quantityBottles,
      vendor: normalizeExactCode(line.vendor),
    };
    if (!normalized.itemCode || !normalized.vendor) return [];
    const key = lineKey(normalized);
    const prior = quantities.get(key);
    quantities.set(key, { ...normalized, quantityBottles: (prior?.quantityBottles ?? 0) + normalized.quantityBottles });
  }
  return Array.from(quantities.values()).sort((left, right) => lineKey(left).localeCompare(lineKey(right)));
};

const exactLinesEqual = (
  orderLines: WholesaleOrderReconciliationLine[],
  evidenceLines: WholesaleOrderReconciliationLine[],
) => {
  if (orderLines.length === 0 || !hasUniquePositiveEvidenceLines(evidenceLines)) return false;
  const left = canonicalOrderLines(orderLines);
  const right = canonicalEvidenceLines(evidenceLines);
  return left.length === right.length && left.every((line, index) =>
    line.vendor === right[index].vendor &&
    line.itemCode === right[index].itemCode &&
    line.quantityBottles === right[index].quantityBottles);
};

type EvidenceGroup = WholesaleOrderEvidence & { rows: WholesaleOrderReconciliationRow[] };

const groupEvidence = (rows: WholesaleOrderReconciliationRow[]) => {
  const groups = new Map<string, EvidenceGroup>();
  for (const row of rows) {
    const automaticMatchKey = getWholesaleOrderAutomaticMatchKey(row);
    const existing = groups.get(automaticMatchKey) ?? {
      automaticMatchKey,
      lines: [],
      normalizedPermitNumber: normalizeWholesalePermitNumber(row.permitNumber),
      reportDate: row.reportDate,
      rows: [],
      sellerStoreNumber: normalizeExactCode(row.agencyId),
    };
    existing.rows.push(row);
    groups.set(automaticMatchKey, existing);
  }
  return Array.from(groups.values());
};

const evidenceLinesForOrder = (group: EvidenceGroup, order: WholesaleOrderReconciliationOrder) => {
  const orderVendors = new Set(order.lines.map((line) => normalizeExactCode(line.vendor)));
  return group.rows
    .filter((row) => orderVendors.has(normalizeExactCode(row.vendor)))
    .map((row) => ({
      itemCode: row.itemCode,
      quantityBottles: row.wholesaleBottlesSold,
      vendor: row.vendor,
    }));
};

const canMatch = (order: WholesaleOrderReconciliationOrder, group: EvidenceGroup) => {
  const latestDate = addUtcDays(order.saleDate, WHOLESALE_ORDER_RECONCILIATION_WINDOW_DAYS);
  return normalizeWholesalePermitNumber(order.customerPermitNumber) === group.normalizedPermitNumber &&
    normalizeExactCode(order.sellerStoreNumber) === group.sellerStoreNumber &&
    group.reportDate >= order.saleDate &&
    group.reportDate <= latestDate &&
    exactLinesEqual(order.lines, evidenceLinesForOrder(group, order));
};

export function planWholesaleOrderReconciliation({
  claimedEvidenceKeys = [],
  orders,
  rows,
}: {
  claimedEvidenceKeys?: string[];
  orders: WholesaleOrderReconciliationOrder[];
  rows: WholesaleOrderReconciliationRow[];
}): WholesaleOrderReconciliationPlan {
  const claimed = new Set(claimedEvidenceKeys);
  const evidenceGroups = groupEvidence(rows).filter((group) => !claimed.has(group.automaticMatchKey));
  const openOrders = orders.filter((order) => order.status !== 'FILED');
  const manualOrders = orders.filter((order) => order.status === 'FILED' && order.filedSource === 'MANUAL');
  const relevantOrders = [...openOrders, ...manualOrders];
  const collidingOrderIds = new Set<string>();
  for (let leftIndex = 0; leftIndex < relevantOrders.length; leftIndex += 1) {
    const left = relevantOrders[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < relevantOrders.length; rightIndex += 1) {
      const right = relevantOrders[rightIndex];
      if (left.customerIdentity === right.customerIdentity ||
        normalizeWholesalePermitNumber(left.customerPermitNumber) !== normalizeWholesalePermitNumber(right.customerPermitNumber) ||
        normalizeExactCode(left.sellerStoreNumber) !== normalizeExactCode(right.sellerStoreNumber)) continue;
      const leftEnd = addUtcDays(left.saleDate, WHOLESALE_ORDER_RECONCILIATION_WINDOW_DAYS);
      const rightEnd = addUtcDays(right.saleDate, WHOLESALE_ORDER_RECONCILIATION_WINDOW_DAYS);
      if (left.saleDate <= rightEnd && right.saleDate <= leftEnd) {
        collidingOrderIds.add(left.id);
        collidingOrderIds.add(right.id);
      }
    }
  }
  const candidatesByOrder = new Map<string, EvidenceGroup[]>();
  const candidatesByEvidence = new Map<string, WholesaleOrderReconciliationOrder[]>();

  for (const order of relevantOrders) {
    if (collidingOrderIds.has(order.id)) continue;
    for (const group of evidenceGroups) {
      if (!canMatch(order, group)) continue;
      const orderCandidates = candidatesByOrder.get(order.id) ?? [];
      orderCandidates.push(group);
      candidatesByOrder.set(order.id, orderCandidates);
      const evidenceCandidates = candidatesByEvidence.get(group.automaticMatchKey) ?? [];
      evidenceCandidates.push(order);
      candidatesByEvidence.set(group.automaticMatchKey, evidenceCandidates);
    }
  }

  const openOrderIds = new Set(openOrders.map((order) => order.id));
  const ambiguousOrderIds = new Set(Array.from(collidingOrderIds).filter((id) => openOrderIds.has(id)));
  const ambiguousEvidenceKeys = new Set<string>();
  const matches: WholesaleOrderReconciliationMatch[] = [];

  for (const order of openOrders) {
    const orderCandidates = candidatesByOrder.get(order.id) ?? [];
    if (orderCandidates.length !== 1) {
      if (orderCandidates.length > 1) ambiguousOrderIds.add(order.id);
      continue;
    }

    const group = orderCandidates[0];
    const evidenceCandidates = candidatesByEvidence.get(group.automaticMatchKey) ?? [];
    if (evidenceCandidates.length !== 1) {
      ambiguousOrderIds.add(order.id);
      ambiguousEvidenceKeys.add(group.automaticMatchKey);
      continue;
    }

    const lines = canonicalEvidenceLines(evidenceLinesForOrder(group, order));
    matches.push({
      evidence: {
        automaticMatchKey: group.automaticMatchKey,
        lines,
        normalizedPermitNumber: group.normalizedPermitNumber,
        reportDate: group.reportDate,
        sellerStoreNumber: group.sellerStoreNumber,
      },
      orderId: order.id,
      organizationId: order.organizationId,
    });
  }

  for (const [key, candidates] of candidatesByEvidence) {
    if (candidates.length > 1) ambiguousEvidenceKeys.add(key);
  }

  return {
    ambiguousEvidenceKeys: Array.from(ambiguousEvidenceKeys).sort(),
    ambiguousOrderIds: Array.from(ambiguousOrderIds).sort(),
    matches,
  };
}

type WholesaleOrderSnapshot = {
  customerPermitNumber: string;
  filedSource: 'AUTO_MATCH' | 'MANUAL' | null;
  id: string;
  inputSnapshot: Prisma.JsonValue;
  organizationId: string;
  saleDate: Date;
  sellerStoreNumber: string;
  status: 'PDF_GENERATED' | 'SENT' | 'FILED';
  wholesaleAccountId: string;
};

const readLines = (snapshot: Prisma.JsonValue): WholesaleOrderReconciliationLine[] => {
  const parsed = wholesaleOrderSnapshotSchema.safeParse(snapshot);
  return parsed.success
    ? parsed.data.lines.map(({ itemCode, quantityBottles, vendor }) => ({ itemCode, quantityBottles, vendor }))
    : [];
};

const incomingRowKey = (row: WholesaleOrderReconciliationRow) => [
  dateOnlyIso(row.reportDate),
  row.agencyId.trim(),
  row.vendor.trim(),
  row.itemCode.trim(),
  row.permitNumber.trim(),
].join('\u0000');

export async function reconcileWholesaleOrdersAfterOhlqImport({
  db = prisma,
  incomingReportDate,
  incomingRows = [],
}: {
  db?: PrismaClient;
  incomingReportDate?: Date;
  incomingRows?: WholesaleOrderReconciliationRow[];
}): Promise<WholesaleOrderReconciliationResult> {
  return db.$transaction(async (tx) => {
    await lockWholesaleOrderLifecycle(tx);

    const pendingSnapshots = await tx.wholesaleOrder.findMany({
      select: {
        customerPermitNumber: true,
        filedSource: true,
        id: true,
        inputSnapshot: true,
        organizationId: true,
        saleDate: true,
        sellerStoreNumber: true,
        status: true,
        wholesaleAccountId: true,
      },
      where: { status: { in: ['PDF_GENERATED', 'SENT'] } },
    });
    if (pendingSnapshots.length === 0) {
      return {
        ambiguousEvidenceKeys: [], ambiguousOrderIds: [], checkedOrders: 0,
        filedOrders: 0, matches: [], stillOutstandingOrders: 0,
      };
    }

    const earliestPending = pendingSnapshots.reduce(
      (value, order) => order.saleDate < value ? order.saleDate : value,
      pendingSnapshots[0].saleDate,
    );
    const latestPending = pendingSnapshots.reduce((value, order) => {
      const end = addUtcDays(order.saleDate, WHOLESALE_ORDER_RECONCILIATION_WINDOW_DAYS);
      return end > value ? end : value;
    }, addUtcDays(pendingSnapshots[0].saleDate, WHOLESALE_ORDER_RECONCILIATION_WINDOW_DAYS));
    const pendingStores = Array.from(new Set(pendingSnapshots.map((order) => order.sellerStoreNumber)));
    const manualSnapshots = await tx.wholesaleOrder.findMany({
      select: {
        customerPermitNumber: true,
        filedSource: true,
        id: true,
        inputSnapshot: true,
        organizationId: true,
        saleDate: true,
        sellerStoreNumber: true,
        status: true,
        wholesaleAccountId: true,
      },
      where: {
        filedSource: 'MANUAL',
        saleDate: {
          gte: addUtcDays(earliestPending, -WHOLESALE_ORDER_RECONCILIATION_WINDOW_DAYS),
          lte: latestPending,
        },
        sellerStoreNumber: { in: pendingStores },
        status: 'FILED',
      },
    });
    const snapshots: WholesaleOrderSnapshot[] = [...pendingSnapshots, ...manualSnapshots];
    const orders = snapshots.map((order) => ({
      ...order,
      customerIdentity: order.wholesaleAccountId,
      lines: readLines(order.inputSnapshot),
    }));
    const retained = await tx.ohlqAnnualSalesByWholesaleRow.findMany({
      select: {
        agencyId: true,
        brand: true,
        permitNumber: true,
        reportDate: true,
        vendor: true,
        wholesaleBottlesSold: true,
      },
      where: {
        agencyId: { in: pendingStores },
        reportDate: { gte: earliestPending, lte: latestPending },
      },
    });
    const rowsByKey = new Map<string, WholesaleOrderReconciliationRow>();
    const excludedDates = new Set(incomingReportDate ? [dateOnlyIso(incomingReportDate)] : []);
    const retainedRows = retained
      .map((value) => ({ ...value, itemCode: value.brand }))
      .filter((row) => !excludedDates.has(dateOnlyIso(row.reportDate)));
    for (const row of [...retainedRows, ...incomingRows]) {
      rowsByKey.set(incomingRowKey(row), row);
    }

    const claimedOrders = await tx.wholesaleOrder.findMany({
      select: { automaticMatchKey: true },
      where: { automaticMatchKey: { not: null } },
    });
    const plan = planWholesaleOrderReconciliation({
      claimedEvidenceKeys: claimedOrders.flatMap((order) => order.automaticMatchKey ? [order.automaticMatchKey] : []),
      orders,
      rows: Array.from(rowsByKey.values()),
    });

    let filedOrders = 0;
    const checkedAt = new Date();
    const ambiguousOrderIds = new Set(plan.ambiguousOrderIds);
    for (const pending of pendingSnapshots) {
      if (plan.matches.some((match) => match.orderId === pending.id)) continue;
      await tx.wholesaleOrder.updateMany({
        data: {
          reconciliationEvidence: ambiguousOrderIds.has(pending.id)
            ? { checkedAt: checkedAt.toISOString(), reason: 'More than one possible match', reviewRequired: true }
            : Prisma.DbNull,
        },
        where: {
          id: pending.id,
          organizationId: pending.organizationId,
          status: { in: ['PDF_GENERATED', 'SENT'] },
        },
      });
    }
    for (const match of plan.matches) {
      const updated = await tx.wholesaleOrder.updateMany({
        data: {
          automaticMatchKey: match.evidence.automaticMatchKey,
          filedAt: new Date(),
          filedSource: 'AUTO_MATCH',
          matchedReportDate: match.evidence.reportDate,
          reconciliationEvidence: {
            ...match.evidence,
            reportDate: dateOnlyIso(match.evidence.reportDate),
          },
          status: 'FILED',
        },
        where: {
          automaticMatchKey: null,
          id: match.orderId,
          organizationId: match.organizationId,
          status: { in: ['PDF_GENERATED', 'SENT'] },
        },
      });
      filedOrders += updated.count;
    }

    if (filedOrders !== plan.matches.length) {
      throw new Error(
        `Wholesale order reconciliation was not atomic: expected to file ${plan.matches.length} order(s), filed ${filedOrders}. Retry the import reconciliation.`,
      );
    }

    return {
      ...plan,
      checkedOrders: pendingSnapshots.length,
      filedOrders,
      stillOutstandingOrders: pendingSnapshots.length - filedOrders,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 10_000,
    timeout: 120_000,
  });
}
