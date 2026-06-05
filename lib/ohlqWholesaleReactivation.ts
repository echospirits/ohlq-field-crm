import {
  WorklistCategory,
  WorklistSource,
  WorklistStatus,
  type PrismaClient,
} from '@prisma/client';
import { isConfiguredTenantItem } from './ohlqSalesData';
import { formatOhlqDate } from './ohlqDataStatus';
import { getOhlqLicenseeMatchKeys, normalizeOhlqId } from './ohlqWholesaleMatching';
import { prisma } from './prisma';
import { getTenantConfig } from './tenantConfig';

export const OHLQ_WHOLESALE_REACTIVATION_SOURCE = WorklistSource.OHLQ_WHOLESALE_REACTIVATION;
export const getOhlqWholesaleReactivationTitle = () =>
  `Follow up: no ${getTenantConfig().productLabel} purchase in 30 days`;
export const OHLQ_WHOLESALE_REACTIVATION_TITLE = getOhlqWholesaleReactivationTitle();
export const OHLQ_WHOLESALE_REACTIVATION_TIME_ZONE = 'America/New_York';
export const OHLQ_WHOLESALE_REACTIVATION_LOOKBACK_DAYS = 90;
export const OHLQ_WHOLESALE_REACTIVATION_RECENT_DAYS = 30;
export const OHLQ_WHOLESALE_REACTIVATION_DUE_DAYS = 7;
export const REACTIVATION_PURCHASED_AGAIN_DETAIL_PREFIX = 'Account purchased again on ';

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
  licenseeIds?: Array<string | { licenseeId: string | null } | null> | null;
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
  recentBuyerPurchaseDatesByLicenseeId: Map<string, Date>;
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
  licenseeIds?: string[];
  status: WorklistStatus;
  updatedAt: Date;
  wholesaleAccountId: string | null;
};

export type WholesaleReactivationWorklistPlan = {
  createCandidates: WholesaleReactivationCandidate[];
  reviewItems: Array<{
    item: ReactivationWorklistSnapshot;
    purchasedAgainAt: Date;
  }>;
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

const getAccountLicenseeIds = (account: {
  licenseeId?: string | null;
  licenseeIds?: Array<string | { licenseeId: string | null } | null> | null;
}) => {
  const ids = [
    account.licenseeId,
    ...(account.licenseeIds ?? []).map((value) => (typeof value === 'string' ? value : value?.licenseeId)),
  ]
    .map(normalizeOhlqId)
    .filter(Boolean) as string[];

  return Array.from(new Set(ids));
};

const accountHasAnyLicenseeKey = (account: WholesaleReactivationAccount, keys: string[]) =>
  getAccountLicenseeIds(account).some((licenseeId) =>
    getOhlqLicenseeMatchKeys(licenseeId).some((key) => keys.includes(key)),
  );

const setLatestDate = (dates: Map<string, Date>, key: string, date: Date) => {
  const existing = dates.get(key);
  if (!existing || date.getTime() > existing.getTime()) {
    dates.set(key, date);
  }
};

const recordRecentBuyerPurchase = ({
  dates,
  keys,
  purchaseDate,
  recentBuyerLicenseeIds,
}: {
  dates: Map<string, Date>;
  keys: string[];
  purchaseDate: Date;
  recentBuyerLicenseeIds: Set<string>;
}) => {
  keys.forEach((key) => {
    recentBuyerLicenseeIds.add(key);
    setLatestDate(dates, key, purchaseDate);
  });
};

export const getReactivationPurchasedAgainMessage = (purchaseDate: Date) =>
  `${REACTIVATION_PURCHASED_AGAIN_DETAIL_PREFIX}${formatOhlqDate(
    purchaseDate,
  )}. This worklist item can be cancelled if no follow-up is needed.`;

export const splitReactivationPurchasedAgainDetail = (detail: string | null | undefined) => {
  const paragraphs = String(detail ?? '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const purchasedAgainMessage =
    paragraphs.find((paragraph) => paragraph.startsWith(REACTIVATION_PURCHASED_AGAIN_DETAIL_PREFIX)) ?? null;
  const remainingDetail = paragraphs
    .filter((paragraph) => !paragraph.startsWith(REACTIVATION_PURCHASED_AGAIN_DETAIL_PREFIX))
    .join('\n\n');

  return {
    detail: remainingDetail || null,
    purchasedAgainMessage,
  };
};

const upsertPurchasedAgainReviewMessage = (detail: string | null | undefined, purchaseDate: Date) => {
  const existing = splitReactivationPurchasedAgainDetail(detail);
  return [getReactivationPurchasedAgainMessage(purchaseDate), existing.detail].filter(Boolean).join('\n\n');
};

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
    getAccountLicenseeIds(account).forEach((licenseeId) => {
      getOhlqLicenseeMatchKeys(licenseeId).forEach((key) => {
        if (!accountByLicenseeKey.has(key)) {
          accountByLicenseeKey.set(key, account);
        }
      });
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
  const recentBuyerPurchaseDatesByLicenseeId = new Map<string, Date>();

  for (const row of rows) {
    if (!isConfiguredTenantItem(row.vendor, row.brand)) continue;

    const licenseeId = normalizeOhlqId(row.permitNumber);
    const licenseeKeys = getOhlqLicenseeMatchKeys(row.permitNumber);
    if (!licenseeId || licenseeKeys.length === 0) continue;

    const account = licenseeKeys.map((key) => accountByLicenseeKey.get(key)).find(Boolean) ?? null;
    const groupKey = account?.id ?? licenseeKeys[0];

    const reportTime = row.reportDate.getTime();
    if (reportTime < windows.ninetyDayStartDate.getTime() || reportTime > windows.runDate.getTime()) continue;

    const hasRecentPurchase = reportTime >= windows.recentStartDate.getTime();
    if (hasRecentPurchase) {
      recordRecentBuyerPurchase({
        dates: recentBuyerPurchaseDatesByLicenseeId,
        keys: licenseeKeys,
        purchaseDate: row.reportDate,
        recentBuyerLicenseeIds,
      });
      if (account) {
        getAccountLicenseeIds(account).forEach((licenseeId) => {
          recordRecentBuyerPurchase({
            dates: recentBuyerPurchaseDatesByLicenseeId,
            keys: getOhlqLicenseeMatchKeys(licenseeId),
            purchaseDate: row.reportDate,
            recentBuyerLicenseeIds,
          });
        });
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
    recentBuyerPurchaseDatesByLicenseeId,
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
  recentBuyerPurchaseDatesByLicenseeId,
}: {
  candidates: WholesaleReactivationCandidate[];
  existingItems: ReactivationWorklistSnapshot[];
  recentBuyerPurchaseDatesByLicenseeId: Map<string, Date>;
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
  const getRecentPurchaseDateForItem = (item: ReactivationWorklistSnapshot) =>
    [...(item.licenseeIds ?? []), item.licenseeId]
      .filter(Boolean)
      .flatMap((licenseeId) => getOhlqLicenseeMatchKeys(licenseeId))
      .map((key) => recentBuyerPurchaseDatesByLicenseeId.get(key))
      .filter((date): date is Date => Boolean(date))
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

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
    createCandidates,
    reviewItems: existingItems.flatMap((item) => {
      if (
        !item.wholesaleAccountId ||
        !isOpenWorklistStatus(item.status) ||
        candidateAccountIds.has(item.wholesaleAccountId)
      ) {
        return [];
      }

      const purchasedAgainAt = getRecentPurchaseDateForItem(item);
      return purchasedAgainAt ? [{ item, purchasedAgainAt }] : [];
    }),
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
          ...chunk.map((licenseeId) => ({
            licenseeIds: {
              some: { licenseeId: { equals: licenseeId, mode: 'insensitive' as const } },
            },
          })),
          ...chunkKeys
            .filter((key) => key.length >= 4)
            .map((key) => ({
              licenseeId: { contains: key, mode: 'insensitive' as const },
            })),
          ...chunkKeys
            .filter((key) => key.length >= 4)
            .map((key) => ({
              licenseeIds: {
                some: { licenseeId: { contains: key, mode: 'insensitive' as const } },
              },
            })),
        ],
      },
      select: {
        id: true,
        licenseeId: true,
        licenseeIds: { select: { licenseeId: true } },
        name: true,
      },
    });
    chunkAccounts
      .filter((account) => accountHasAnyLicenseeKey(account, Array.from(targetKeys)))
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
  const tenantConfig = getTenantConfig();
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
        licenseeIds: { select: { licenseeId: true } },
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
      select: {
        licenseeId: true,
        licenseeIds: { select: { licenseeId: true } },
        ohlqLastEchoPurchaseDate: true,
      },
    }),
  ]);
  const recentBuyerLicenseeIds = new Set<string>();
  const recentBuyerPurchaseDatesByLicenseeId = new Map<string, Date>();
  recentBuyerAccounts.forEach((account) => {
    const purchaseDate = account.ohlqLastEchoPurchaseDate;
    if (!purchaseDate) return;

    getAccountLicenseeIds(account).forEach((licenseeId) => {
      recordRecentBuyerPurchase({
        dates: recentBuyerPurchaseDatesByLicenseeId,
        keys: getOhlqLicenseeMatchKeys(licenseeId),
        purchaseDate,
        recentBuyerLicenseeIds,
      });
    });
  });
  const candidates = lapsedAccounts
    .filter((account) => account.ohlqLastEchoPurchaseDate)
    .map((account) => {
      const purchaseDate = account.ohlqLastEchoPurchaseDate!;
      const item =
        account.ohlqLastEchoPurchaseItemCode || account.ohlqLastEchoPurchaseItemName
          ? [
              {
                itemCode: account.ohlqLastEchoPurchaseItemCode ?? `${tenantConfig.productLabel} item`,
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
    recentBuyerPurchaseDatesByLicenseeId,
    unmatchedLicenseeIds: [],
    windows,
  } satisfies WholesaleReactivationAnalysis;
}

export const buildWholesaleReactivationDetail = (candidate: WholesaleReactivationCandidate) => {
  const tenantConfig = getTenantConfig();
  const itemLines = candidate.items.slice(0, 8).map(
    (item) =>
      `- ${item.itemCode} - ${item.itemName}: ${item.wholesaleBottlesSold.toLocaleString(
        'en-US',
      )} bottle(s), last ${formatOhlqDate(item.mostRecentPurchaseDate)}`,
  );
  const hiddenItemCount = candidate.items.length - itemLines.length;

  return [
    `${candidate.accountName} (${candidate.licenseeId}) bought ${tenantConfig.productPluralLabel} in the last 90 days, but not in the last 30 days.`,
    `Most recent ${tenantConfig.productLabel} purchase: ${formatOhlqDate(candidate.mostRecentPurchaseDate)} (${candidate.daysSinceLastEchoPurchase} day(s) ago).`,
    `Latest ${tenantConfig.productLabel} purchase bottles captured: ${candidate.totalWholesaleBottlesSold.toLocaleString('en-US')}.`,
    itemLines.length > 0
      ? `Most recent ${tenantConfig.productLabel} item captured:`
      : `Most recent ${tenantConfig.productLabel} item details were not captured.`,
    itemLines.length > 0 ? itemLines.join('\n') : null,
    hiddenItemCount > 0 ? `- ${hiddenItemCount} more item(s)` : null,
  ]
    .filter(Boolean)
    .join('\n');
};

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
          select: {
            id: true,
            licenseeId: true,
            licenseeIds: { select: { licenseeId: true } },
          },
        })
      : [];
  const licenseeByAccountId = new Map(sourceAccounts.map((account) => [account.id, account.licenseeId]));
  const licenseesByAccountId = new Map(sourceAccounts.map((account) => [account.id, getAccountLicenseeIds(account)]));
  const plan = planWholesaleReactivationWorklistSync({
    candidates: analysis.candidates,
    existingItems: sourceItems.map((item) => ({
      cancelledAt: item.cancelledAt,
      completedAt: item.completedAt,
      id: item.id,
      licenseeId: item.wholesaleAccountId ? licenseeByAccountId.get(item.wholesaleAccountId) ?? null : null,
      licenseeIds: item.wholesaleAccountId ? licenseesByAccountId.get(item.wholesaleAccountId) ?? [] : [],
      status: item.status,
      updatedAt: item.updatedAt,
      wholesaleAccountId: item.wholesaleAccountId,
    })),
    recentBuyerPurchaseDatesByLicenseeId: analysis.recentBuyerPurchaseDatesByLicenseeId,
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
        title: getOhlqWholesaleReactivationTitle(),
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
        title: getOhlqWholesaleReactivationTitle(),
      },
    });
  }

  for (const { item, purchasedAgainAt } of plan.reviewItems) {
    const existing = sourceItems.find((sourceItem) => sourceItem.id === item.id);
    await db.worklistItem.update({
      where: { id: item.id },
      data: {
        detail: upsertPurchasedAgainReviewMessage(existing?.detail ?? null, purchasedAgainAt),
      },
    });
  }

  return {
    cancelledItems: 0,
    createdItems: plan.createCandidates.length,
    dueDate: formatOhlqDate(analysis.windows.dueDate),
    flaggedPurchasedAgainItems: plan.reviewItems.length,
    matchedAccountsNeedingAction: analysis.candidates.length,
    openItemsAfterSync:
      plan.createCandidates.length + plan.updateItems.length + plan.reviewItems.length,
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
  const activeSourceWhere = {
    category: WorklistCategory.WHOLESALE,
    source: OHLQ_WHOLESALE_REACTIVATION_SOURCE,
    status: { notIn: inactiveWorklistStatuses },
    wholesaleAccountId: { not: null },
  };
  const [analysis, topWorklistItems, openWorklistItems] = await Promise.all([
    findOhlqWholesaleReactivationCandidates({ db, runAt }),
    db.worklistItem.findMany({
      where: activeSourceWhere,
      take,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      select: {
        detail: true,
        dueDate: true,
        id: true,
        title: true,
        wholesaleAccountId: true,
      },
    }),
    db.worklistItem.count({
      where: activeSourceWhere,
    }),
  ]);
  const accountIds = Array.from(
    new Set(topWorklistItems.map((item) => item.wholesaleAccountId).filter(Boolean) as string[]),
  );
  const accounts =
    accountIds.length > 0
      ? await db.wholesaleAccount.findMany({
          where: { id: { in: accountIds } },
          select: {
            id: true,
            name: true,
            ohlqLastEchoPurchaseDate: true,
            ohlqLastEchoPurchaseItemCode: true,
            ohlqLastEchoPurchaseItemName: true,
          },
        })
      : [];
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  return {
    accountCount: openWorklistItems,
    openWorklistItems,
    topAccounts: topWorklistItems.map((item) => {
      const account = item.wholesaleAccountId ? accountById.get(item.wholesaleAccountId) : null;
      const lastPurchaseDate = account?.ohlqLastEchoPurchaseDate ?? null;
      const purchasedAgainAt =
        lastPurchaseDate &&
        lastPurchaseDate.getTime() >= analysis.windows.recentStartDate.getTime() &&
        lastPurchaseDate.getTime() <= analysis.windows.runDate.getTime()
          ? lastPurchaseDate
          : null;
      const daysSinceLastEchoPurchase = lastPurchaseDate
        ? Math.max(0, Math.floor((analysis.windows.runDate.getTime() - lastPurchaseDate.getTime()) / dayMs))
        : null;

      return {
        accountName: account?.name ?? 'Wholesale account',
        daysSinceLastEchoPurchase,
        detail: item.detail,
        dueDate: item.dueDate,
        lastItemLabel:
          account?.ohlqLastEchoPurchaseItemCode || account?.ohlqLastEchoPurchaseItemName
            ? [account.ohlqLastEchoPurchaseItemCode, account.ohlqLastEchoPurchaseItemName].filter(Boolean).join(' - ')
            : null,
        purchasedAgainAt,
        title: item.title,
        wholesaleAccountId: item.wholesaleAccountId,
        worklistItemId: item.id,
      };
    }),
    unmatchedLicenseeCount: analysis.unmatchedLicenseeIds.length,
  };
}
