import {
  WorklistCategory,
  WorklistSource,
  WorklistStatus,
  type PrismaClient,
} from '@prisma/client';
import {
  ECHO_VENDOR_ID,
  EXCLUDED_ECHO_ITEM_CODES,
  isEchoItem,
} from './ohlqSalesData';
import { formatOhlqDate } from './ohlqDataStatus';
import { getOhlqLicenseeMatchKeys, normalizeOhlqId } from './ohlqWholesaleMatching';
import { prisma } from './prisma';

export const OHLQ_WHOLESALE_REACTIVATION_SOURCE = WorklistSource.OHLQ_WHOLESALE_REACTIVATION;
export const OHLQ_WHOLESALE_REACTIVATION_TITLE = 'Follow up: no Echo purchase in 30 days';
export const OHLQ_WHOLESALE_REACTIVATION_TIME_ZONE = 'America/New_York';
export const OHLQ_WHOLESALE_REACTIVATION_LOOKBACK_DAYS = 90;
export const OHLQ_WHOLESALE_REACTIVATION_RECENT_DAYS = 30;
export const OHLQ_WHOLESALE_REACTIVATION_DUE_DAYS = 7;

const inactiveWorklistStatuses: WorklistStatus[] = [WorklistStatus.COMPLETED, WorklistStatus.CANCELLED];
const dayMs = 24 * 60 * 60 * 1000;

type DateParts = {
  day: number;
  month: number;
  year: number;
};

export type WholesaleReactivationPurchaseRow = {
  brand: string;
  permitNumber: string;
  reportDate: Date;
  vendor: string;
  wholesaleBottlesSold: number;
};

export type WholesaleReactivationAccount = {
  id: string;
  licenseeId: string;
  name: string;
};

export type WholesaleReactivationItem = {
  itemCode: string;
  itemName: string;
  mostRecentPurchaseDate: Date;
  wholesaleBottlesSold: number;
};

export type WholesaleReactivationCandidate = {
  accountName: string;
  daysSinceLastEchoPurchase: number;
  items: WholesaleReactivationItem[];
  licenseeId: string;
  mostRecentPurchaseDate: Date;
  totalWholesaleBottlesSold: number;
  wholesaleAccountId: string;
};

export type WholesaleReactivationAnalysis = {
  candidates: WholesaleReactivationCandidate[];
  recentBuyerLicenseeIds: Set<string>;
  unmatchedLicenseeIds: string[];
  windows: WholesaleReactivationWindows;
};

export type WholesaleReactivationWindows = {
  dueDate: Date;
  recentStartDate: Date;
  runDate: Date;
  ninetyDayStartDate: Date;
};

export type ReactivationWorklistSnapshot = {
  cancelledAt: Date | null;
  completedAt: Date | null;
  id: string;
  licenseeId: string | null;
  status: WorklistStatus;
  updatedAt: Date;
  wholesaleAccountId: string | null;
};

export type WholesaleReactivationWorklistPlan = {
  cancelItems: ReactivationWorklistSnapshot[];
  createCandidates: WholesaleReactivationCandidate[];
  skippedCandidates: WholesaleReactivationCandidate[];
  updateItems: Array<{
    candidate: WholesaleReactivationCandidate;
    item: ReactivationWorklistSnapshot;
  }>;
};

const getDateParts = (date: Date, timeZone: string): DateParts => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      month: '2-digit',
      timeZone,
      year: 'numeric',
    })
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    day: parts.day,
    month: parts.month,
    year: parts.year,
  };
};

const addUtcDays = (date: Date, days: number) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));

const toDateOnlyUtcForZone = (date: Date, timeZone: string) => {
  const parts = getDateParts(date, timeZone);

  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
};

export function getWholesaleReactivationWindows({
  runAt = new Date(),
  timeZone = OHLQ_WHOLESALE_REACTIVATION_TIME_ZONE,
}: {
  runAt?: Date;
  timeZone?: string;
} = {}): WholesaleReactivationWindows {
  const runDate = toDateOnlyUtcForZone(runAt, timeZone);

  return {
    dueDate: addUtcDays(runDate, OHLQ_WHOLESALE_REACTIVATION_DUE_DAYS),
    recentStartDate: addUtcDays(runDate, -OHLQ_WHOLESALE_REACTIVATION_RECENT_DAYS),
    runDate,
    ninetyDayStartDate: addUtcDays(runDate, -OHLQ_WHOLESALE_REACTIVATION_LOOKBACK_DAYS),
  };
}

const sortItems = (items: WholesaleReactivationItem[]) =>
  items.sort(
    (a, b) =>
      b.mostRecentPurchaseDate.getTime() - a.mostRecentPurchaseDate.getTime() ||
      b.wholesaleBottlesSold - a.wholesaleBottlesSold ||
      a.itemCode.localeCompare(b.itemCode),
  );

export function buildWholesaleReactivationAnalysis({
  accounts,
  itemNames = new Map<string, string>(),
  rows,
  runAt = new Date(),
  timeZone = OHLQ_WHOLESALE_REACTIVATION_TIME_ZONE,
}: {
  accounts: WholesaleReactivationAccount[];
  itemNames?: Map<string, string>;
  rows: WholesaleReactivationPurchaseRow[];
  runAt?: Date;
  timeZone?: string;
}): WholesaleReactivationAnalysis {
  const windows = getWholesaleReactivationWindows({ runAt, timeZone });
  const accountByLicenseeKey = new Map<string, WholesaleReactivationAccount>();
  accounts.forEach((account) => {
    getOhlqLicenseeMatchKeys(account.licenseeId).forEach((key) => {
      if (!accountByLicenseeKey.has(key)) {
        accountByLicenseeKey.set(key, account);
      }
    });
  });
  const groups = new Map<
    string,
    {
      account: WholesaleReactivationAccount | null;
      hasRecentPurchase: boolean;
      items: Map<string, WholesaleReactivationItem>;
      licenseeId: string;
      mostRecentPurchaseDate: Date;
      totalWholesaleBottlesSold: number;
    }
  >();
  const recentBuyerLicenseeIds = new Set<string>();

  for (const row of rows) {
    if (!isEchoItem(row.vendor, row.brand)) continue;

    const licenseeId = normalizeOhlqId(row.permitNumber);
    const licenseeKeys = getOhlqLicenseeMatchKeys(row.permitNumber);
    if (!licenseeId || licenseeKeys.length === 0) continue;

    const account = licenseeKeys.map((key) => accountByLicenseeKey.get(key)).find(Boolean) ?? null;
    const groupKey = account?.id ?? licenseeKeys[0];

    const reportTime = row.reportDate.getTime();
    if (reportTime < windows.ninetyDayStartDate.getTime() || reportTime > windows.runDate.getTime()) continue;

    const hasRecentPurchase = reportTime >= windows.recentStartDate.getTime();
    if (hasRecentPurchase) {
      licenseeKeys.forEach((key) => recentBuyerLicenseeIds.add(key));
      if (account) {
        getOhlqLicenseeMatchKeys(account.licenseeId).forEach((key) => recentBuyerLicenseeIds.add(key));
      }
    }

    const group =
      groups.get(groupKey) ??
      {
        account,
        hasRecentPurchase: false,
        items: new Map<string, WholesaleReactivationItem>(),
        licenseeId: account?.licenseeId ?? licenseeId,
        mostRecentPurchaseDate: row.reportDate,
        totalWholesaleBottlesSold: 0,
      };
    const item =
      group.items.get(row.brand) ??
      {
        itemCode: row.brand,
        itemName: itemNames.get(row.brand) ?? 'Name pending',
        mostRecentPurchaseDate: row.reportDate,
        wholesaleBottlesSold: 0,
      };

    item.wholesaleBottlesSold += row.wholesaleBottlesSold;
    if (reportTime > item.mostRecentPurchaseDate.getTime()) item.mostRecentPurchaseDate = row.reportDate;
    group.totalWholesaleBottlesSold += row.wholesaleBottlesSold;
    if (hasRecentPurchase) group.hasRecentPurchase = true;
    if (!group.account && account) group.account = account;
    if (reportTime > group.mostRecentPurchaseDate.getTime()) group.mostRecentPurchaseDate = row.reportDate;
    group.items.set(row.brand, item);
    groups.set(groupKey, group);
  }

  const candidates: WholesaleReactivationCandidate[] = [];
  const unmatchedLicenseeIds: string[] = [];

  for (const group of groups.values()) {
    if (group.hasRecentPurchase) continue;

    const account = group.account;
    if (!account) {
      unmatchedLicenseeIds.push(group.licenseeId);
      continue;
    }

    candidates.push({
      accountName: account.name,
      daysSinceLastEchoPurchase: Math.max(
        0,
        Math.floor((windows.runDate.getTime() - group.mostRecentPurchaseDate.getTime()) / dayMs),
      ),
      items: sortItems(Array.from(group.items.values())),
      licenseeId: account.licenseeId,
      mostRecentPurchaseDate: group.mostRecentPurchaseDate,
      totalWholesaleBottlesSold: group.totalWholesaleBottlesSold,
      wholesaleAccountId: account.id,
    });
  }

  return {
    candidates: candidates.sort(
      (a, b) =>
        b.mostRecentPurchaseDate.getTime() - a.mostRecentPurchaseDate.getTime() ||
        b.totalWholesaleBottlesSold - a.totalWholesaleBottlesSold ||
        a.accountName.localeCompare(b.accountName),
    ),
    recentBuyerLicenseeIds,
    unmatchedLicenseeIds: unmatchedLicenseeIds.sort(),
    windows,
  };
}

const isOpenWorklistStatus = (status: WorklistStatus) => !inactiveWorklistStatuses.includes(status);

const getClosedAt = (item: ReactivationWorklistSnapshot) =>
  item.completedAt ?? item.cancelledAt ?? item.updatedAt ?? null;

export function planWholesaleReactivationWorklistSync({
  candidates,
  existingItems,
  recentBuyerLicenseeIds,
}: {
  candidates: WholesaleReactivationCandidate[];
  existingItems: ReactivationWorklistSnapshot[];
  recentBuyerLicenseeIds: Set<string>;
}): WholesaleReactivationWorklistPlan {
  const openItemByAccountId = new Map<string, ReactivationWorklistSnapshot>();
  const closedItemsByAccountId = new Map<string, ReactivationWorklistSnapshot[]>();

  for (const item of existingItems) {
    if (!item.wholesaleAccountId) continue;

    if (isOpenWorklistStatus(item.status)) {
      if (!openItemByAccountId.has(item.wholesaleAccountId)) {
        openItemByAccountId.set(item.wholesaleAccountId, item);
      }
      continue;
    }

    const items = closedItemsByAccountId.get(item.wholesaleAccountId) ?? [];
    items.push(item);
    closedItemsByAccountId.set(item.wholesaleAccountId, items);
  }

  const createCandidates: WholesaleReactivationCandidate[] = [];
  const skippedCandidates: WholesaleReactivationCandidate[] = [];
  const updateItems: WholesaleReactivationWorklistPlan['updateItems'] = [];
  const candidateAccountIds = new Set(candidates.map((candidate) => candidate.wholesaleAccountId));

  for (const candidate of candidates) {
    const openItem = openItemByAccountId.get(candidate.wholesaleAccountId);

    if (openItem) {
      updateItems.push({ candidate, item: openItem });
      continue;
    }

    const closedItems = closedItemsByAccountId.get(candidate.wholesaleAccountId) ?? [];
    const alreadyHandled = closedItems.some((item) => {
      const closedAt = getClosedAt(item);
      return Boolean(closedAt && closedAt.getTime() >= candidate.mostRecentPurchaseDate.getTime());
    });

    if (alreadyHandled) {
      skippedCandidates.push(candidate);
    } else {
      createCandidates.push(candidate);
    }
  }

  return {
    cancelItems: existingItems.filter(
      (item) =>
        item.wholesaleAccountId &&
        isOpenWorklistStatus(item.status) &&
        !candidateAccountIds.has(item.wholesaleAccountId) &&
        Boolean(item.licenseeId && getOhlqLicenseeMatchKeys(item.licenseeId).some((key) => recentBuyerLicenseeIds.has(key))),
    ),
    createCandidates,
    skippedCandidates,
    updateItems,
  };
}

const getItemNameLookup = async (db: PrismaClient, itemCodes: string[]) => {
  if (itemCodes.length === 0) return new Map<string, string>();

  const skus = await db.ohlqBrandMasterItem.findMany({
    where: { itemCode: { in: Array.from(new Set(itemCodes)) } },
    select: { itemCode: true, name: true },
  });

  return new Map(skus.map((sku) => [sku.itemCode, sku.name]));
};

const findActiveWholesaleAccounts = async (db: PrismaClient, licenseeIds: string[]) => {
  const uniqueLicenseeIds = Array.from(new Set(licenseeIds.map(normalizeOhlqId).filter(Boolean) as string[]));
  const targetKeys = new Set(uniqueLicenseeIds.flatMap(getOhlqLicenseeMatchKeys));
  const accounts = new Map<string, WholesaleReactivationAccount>();
  const chunkSize = 100;

  for (let index = 0; index < uniqueLicenseeIds.length; index += chunkSize) {
    const chunk = uniqueLicenseeIds.slice(index, index + chunkSize);
    const chunkKeys = Array.from(new Set(chunk.flatMap(getOhlqLicenseeMatchKeys)));
    const chunkAccounts = await db.wholesaleAccount.findMany({
      where: {
        isActive: true,
        OR: [
          ...chunk.map((licenseeId) => ({
            licenseeId: { equals: licenseeId, mode: 'insensitive' as const },
          })),
          ...chunkKeys
            .filter((key) => key.length >= 4)
            .map((key) => ({
              licenseeId: { contains: key, mode: 'insensitive' as const },
            })),
        ],
      },
      select: { id: true, licenseeId: true, name: true },
    });
    chunkAccounts
      .filter((account) => getOhlqLicenseeMatchKeys(account.licenseeId).some((key) => targetKeys.has(key)))
      .forEach((account) => accounts.set(account.id, account));
  }

  return Array.from(accounts.values());
};

export async function findOhlqWholesaleReactivationCandidates({
  db = prisma,
  runAt = new Date(),
}: {
  db?: PrismaClient;
  runAt?: Date;
} = {}) {
  const windows = getWholesaleReactivationWindows({ runAt });
  const [lapsedAccounts, recentBuyerAccounts] = await Promise.all([
    db.wholesaleAccount.findMany({
      where: {
        isActive: true,
        ohlqLastEchoPurchaseDate: {
          gte: windows.ninetyDayStartDate,
          lt: windows.recentStartDate,
        },
      },
      orderBy: [
        { ohlqLastEchoPurchaseDate: 'desc' },
        { ohlqLastEchoPurchaseBottles: 'desc' },
        { name: 'asc' },
      ],
      select: {
        id: true,
        licenseeId: true,
        name: true,
        ohlqLastEchoPurchaseBottles: true,
        ohlqLastEchoPurchaseDate: true,
        ohlqLastEchoPurchaseItemCode: true,
        ohlqLastEchoPurchaseItemName: true,
      },
    }),
    db.wholesaleAccount.findMany({
      where: {
        isActive: true,
        ohlqLastEchoPurchaseDate: {
          gte: windows.recentStartDate,
          lte: windows.runDate,
        },
      },
      select: { licenseeId: true },
    }),
  ]);
  const recentBuyerLicenseeIds = new Set<string>();
  recentBuyerAccounts.forEach((account) => {
    getOhlqLicenseeMatchKeys(account.licenseeId).forEach((key) => recentBuyerLicenseeIds.add(key));
  });
  const candidates = lapsedAccounts
    .filter((account) => account.ohlqLastEchoPurchaseDate)
    .map((account) => {
      const purchaseDate = account.ohlqLastEchoPurchaseDate!;
      const item =
        account.ohlqLastEchoPurchaseItemCode || account.ohlqLastEchoPurchaseItemName
          ? [
              {
                itemCode: account.ohlqLastEchoPurchaseItemCode ?? 'Echo item',
                itemName: account.ohlqLastEchoPurchaseItemName ?? 'Name pending',
                mostRecentPurchaseDate: purchaseDate,
                wholesaleBottlesSold: account.ohlqLastEchoPurchaseBottles,
              },
            ]
          : [];

      return {
        accountName: account.name,
        daysSinceLastEchoPurchase: Math.max(
          0,
          Math.floor((windows.runDate.getTime() - purchaseDate.getTime()) / dayMs),
        ),
        items: item,
        licenseeId: account.licenseeId,
        mostRecentPurchaseDate: purchaseDate,
        totalWholesaleBottlesSold: account.ohlqLastEchoPurchaseBottles,
        wholesaleAccountId: account.id,
      } satisfies WholesaleReactivationCandidate;
    });

  return {
    candidates,
    recentBuyerLicenseeIds,
    unmatchedLicenseeIds: [],
    windows,
  } satisfies WholesaleReactivationAnalysis;
}

export const buildWholesaleReactivationDetail = (candidate: WholesaleReactivationCandidate) => {
  const itemLines = candidate.items.slice(0, 8).map(
    (item) =>
      `- ${item.itemCode} - ${item.itemName}: ${item.wholesaleBottlesSold.toLocaleString(
        'en-US',
      )} bottle(s), last ${formatOhlqDate(item.mostRecentPurchaseDate)}`,
  );
  const hiddenItemCount = candidate.items.length - itemLines.length;

  return [
    `${candidate.accountName} (${candidate.licenseeId}) bought Echo items in the last 90 days, but not in the last 30 days.`,
    `Most recent Echo purchase: ${formatOhlqDate(candidate.mostRecentPurchaseDate)} (${candidate.daysSinceLastEchoPurchase} day(s) ago).`,
    `Latest Echo purchase bottles captured: ${candidate.totalWholesaleBottlesSold.toLocaleString('en-US')}.`,
    itemLines.length > 0 ? 'Most recent Echo item captured:' : 'Most recent Echo item details were not captured.',
    itemLines.length > 0 ? itemLines.join('\n') : null,
    hiddenItemCount > 0 ? `- ${hiddenItemCount} more item(s)` : null,
  ]
    .filter(Boolean)
    .join('\n');
};

const appendCancellationNote = (detail: string | null, runAt: Date) =>
  [
    detail,
    `Resolved automatically on ${formatOhlqDate(runAt)} because this account purchased Echo items again in the last 30 days.`,
  ]
    .filter(Boolean)
    .join('\n\n');

export async function syncOhlqWholesaleReactivationWorklist({
  db = prisma,
  runAt = new Date(),
}: {
  db?: PrismaClient;
  runAt?: Date;
} = {}) {
  const analysis = await findOhlqWholesaleReactivationCandidates({ db, runAt });
  const sourceItems = await db.worklistItem.findMany({
    where: {
      category: WorklistCategory.WHOLESALE,
      source: OHLQ_WHOLESALE_REACTIVATION_SOURCE,
      wholesaleAccountId: { not: null },
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      cancelledAt: true,
      completedAt: true,
      detail: true,
      id: true,
      status: true,
      updatedAt: true,
      wholesaleAccountId: true,
    },
  });
  const sourceAccountIds = Array.from(
    new Set(sourceItems.map((item) => item.wholesaleAccountId).filter(Boolean) as string[]),
  );
  const sourceAccounts =
    sourceAccountIds.length > 0
      ? await db.wholesaleAccount.findMany({
          where: { id: { in: sourceAccountIds } },
          select: { id: true, licenseeId: true },
        })
      : [];
  const licenseeByAccountId = new Map(sourceAccounts.map((account) => [account.id, account.licenseeId]));
  const plan = planWholesaleReactivationWorklistSync({
    candidates: analysis.candidates,
    existingItems: sourceItems.map((item) => ({
      cancelledAt: item.cancelledAt,
      completedAt: item.completedAt,
      id: item.id,
      licenseeId: item.wholesaleAccountId ? licenseeByAccountId.get(item.wholesaleAccountId) ?? null : null,
      status: item.status,
      updatedAt: item.updatedAt,
      wholesaleAccountId: item.wholesaleAccountId,
    })),
    recentBuyerLicenseeIds: analysis.recentBuyerLicenseeIds,
  });

  for (const candidate of plan.createCandidates) {
    await db.worklistItem.create({
      data: {
        category: WorklistCategory.WHOLESALE,
        createdBy: 'OHLQ sales automation',
        detail: buildWholesaleReactivationDetail(candidate),
        dueDate: analysis.windows.dueDate,
        source: OHLQ_WHOLESALE_REACTIVATION_SOURCE,
        status: WorklistStatus.OPEN,
        title: OHLQ_WHOLESALE_REACTIVATION_TITLE,
        wholesaleAccountId: candidate.wholesaleAccountId,
      },
    });
  }

  for (const { candidate, item } of plan.updateItems) {
    await db.worklistItem.update({
      where: { id: item.id },
      data: {
        category: WorklistCategory.WHOLESALE,
        detail: buildWholesaleReactivationDetail(candidate),
        dueDate: analysis.windows.dueDate,
        source: OHLQ_WHOLESALE_REACTIVATION_SOURCE,
        title: OHLQ_WHOLESALE_REACTIVATION_TITLE,
      },
    });
  }

  for (const item of plan.cancelItems) {
    const existing = sourceItems.find((sourceItem) => sourceItem.id === item.id);
    await db.worklistItem.update({
      where: { id: item.id },
      data: {
        cancelledAt: runAt,
        detail: appendCancellationNote(existing?.detail ?? null, runAt),
        status: WorklistStatus.CANCELLED,
      },
    });
  }

  return {
    cancelledItems: plan.cancelItems.length,
    createdItems: plan.createCandidates.length,
    dueDate: formatOhlqDate(analysis.windows.dueDate),
    matchedAccountsNeedingAction: analysis.candidates.length,
    openItemsAfterSync: analysis.candidates.length - plan.skippedCandidates.length,
    recentStartDate: formatOhlqDate(analysis.windows.recentStartDate),
    skippedRecentlyClosedItems: plan.skippedCandidates.length,
    unmatchedLicenseeIds: analysis.unmatchedLicenseeIds,
    updatedItems: plan.updateItems.length,
    windowStartDate: formatOhlqDate(analysis.windows.ninetyDayStartDate),
  };
}

export async function getOhlqWholesaleReactivationDashboardSummary({
  db = prisma,
  runAt = new Date(),
  take = 5,
}: {
  db?: PrismaClient;
  runAt?: Date;
  take?: number;
} = {}) {
  const [analysis, openWorklistItems] = await Promise.all([
    findOhlqWholesaleReactivationCandidates({ db, runAt }),
    db.worklistItem.count({
      where: {
        source: OHLQ_WHOLESALE_REACTIVATION_SOURCE,
        status: { notIn: inactiveWorklistStatuses },
      },
    }),
  ]);

  return {
    accountCount: analysis.candidates.length,
    openWorklistItems,
    topAccounts: analysis.candidates.slice(0, take),
    unmatchedLicenseeCount: analysis.unmatchedLicenseeIds.length,
  };
}
