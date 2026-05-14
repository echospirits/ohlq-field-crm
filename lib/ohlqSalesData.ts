import type { PrismaClient } from '@prisma/client';
import { formatOhlqDate } from './ohlqDataStatus';
import { prisma } from './prisma';

export const ECHO_VENDOR_ID = 'Z90399001';
export const EXCLUDED_ECHO_ITEM_CODES = ['3150B'] as const;

const excludedEchoItemCodes = new Set<string>(EXCLUDED_ECHO_ITEM_CODES);

type AgencySalesGroup = {
  brand: string;
  _max: { reportDate: Date | null };
  _sum: {
    retailBottlesSold: number | null;
    wholesaleBottlesSold: number | null;
  };
};

type SkuLookup = Map<string, string>;

export type AgencySalesWindow = {
  days: number;
  endDate: string | null;
  items: AgencySalesSummaryItem[];
  startDate: string | null;
};

export type AgencySalesSummaryItem = {
  itemCode: string;
  itemName: string;
  mostRecentSaleDate: string | null;
  retailBottlesSold: number;
  totalBottlesSold: number;
  wholesaleBottlesSold: number;
};

export type WholesalePurchaseRecord = {
  agencyId: string;
  itemCode: string;
  itemName: string;
  reportDate: string;
  vendor: string;
  wholesaleBottlesSold: number;
};

export type WholesalePurchaseList = {
  count: number;
  records: WholesalePurchaseRecord[];
  totalBottlesSold: number;
};

export type WholesaleRecentPurchases = {
  all: WholesalePurchaseList;
  echo: WholesalePurchaseList;
  endDate: string | null;
  licenseeId: string | null;
  startDate: string | null;
};

const addUtcDays = (date: Date, days: number) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));

export const normalizeOhlqId = (value: string | null | undefined) => {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized || null;
};

export const isEchoItem = (vendor: string | null | undefined, itemCode: string | null | undefined) =>
  normalizeOhlqId(vendor) === ECHO_VENDOR_ID && !excludedEchoItemCodes.has(normalizeOhlqId(itemCode) ?? '');

export const getOhlqWindowStartDate = (endDate: Date, days: number) => addUtcDays(endDate, -(days - 1));

const formatDateOnly = (date: Date | null | undefined) => (date ? formatOhlqDate(date) : null);

const sum = (value: number | null | undefined) => value ?? 0;

const getSkuLookup = async (db: PrismaClient, itemCodes: string[]) => {
  if (itemCodes.length === 0) return new Map<string, string>();

  const skus = await db.sku.findMany({
    where: { itemCode: { in: Array.from(new Set(itemCodes)) } },
    select: { itemCode: true, name: true },
  });

  return new Map(skus.map((sku) => [sku.itemCode, sku.name]));
};

export const getItemName = (skuLookup: SkuLookup, itemCode: string) => skuLookup.get(itemCode) ?? 'Name pending';

export function toAgencySalesSummaryItems(groups: AgencySalesGroup[], skuLookup: SkuLookup) {
  return groups
    .map((group) => {
      const retailBottlesSold = sum(group._sum.retailBottlesSold);
      const wholesaleBottlesSold = sum(group._sum.wholesaleBottlesSold);

      return {
        itemCode: group.brand,
        itemName: getItemName(skuLookup, group.brand),
        mostRecentSaleDate: formatDateOnly(group._max.reportDate),
        retailBottlesSold,
        totalBottlesSold: retailBottlesSold + wholesaleBottlesSold,
        wholesaleBottlesSold,
      };
    })
    .filter((item) => item.totalBottlesSold > 0)
    .sort(
      (a, b) =>
        b.totalBottlesSold - a.totalBottlesSold ||
        (b.mostRecentSaleDate ?? '').localeCompare(a.mostRecentSaleDate ?? '') ||
        a.itemCode.localeCompare(b.itemCode),
    );
}

export async function getAgencyRecentItemSales({
  agencyId,
  db = prisma,
  windows = [7, 30],
}: {
  agencyId: string;
  db?: PrismaClient;
  windows?: number[];
}) {
  const latest = await db.ohlqAnnualSalesRow.findFirst({
    orderBy: { reportDate: 'desc' },
    select: { reportDate: true },
  });

  if (!latest) {
    return windows.map((days) => ({
      days,
      endDate: null,
      items: [],
      startDate: null,
    })) satisfies AgencySalesWindow[];
  }

  const endDate = latest.reportDate;
  const groupedByWindow = await Promise.all(
    windows.map(async (days) => {
      const startDate = getOhlqWindowStartDate(endDate, days);
      const groups = await db.ohlqAnnualSalesRow.groupBy({
        by: ['brand'],
        where: {
          agencyId,
          brand: { notIn: [...EXCLUDED_ECHO_ITEM_CODES] },
          reportDate: { gte: startDate, lte: endDate },
          vendor: ECHO_VENDOR_ID,
        },
        _max: { reportDate: true },
        _sum: {
          retailBottlesSold: true,
          wholesaleBottlesSold: true,
        },
      });

      return { days, groups, startDate };
    }),
  );
  const itemCodes = groupedByWindow.flatMap((window) => window.groups.map((group) => group.brand));
  const skuLookup = await getSkuLookup(db, itemCodes);

  return groupedByWindow.map((window) => ({
    days: window.days,
    endDate: formatDateOnly(endDate),
    items: toAgencySalesSummaryItems(window.groups, skuLookup),
    startDate: formatDateOnly(window.startDate),
  })) satisfies AgencySalesWindow[];
}

const toPurchaseRecords = (
  records: Array<{
    agencyId: string;
    brand: string;
    reportDate: Date;
    vendor: string;
    wholesaleBottlesSold: number;
  }>,
  skuLookup: SkuLookup,
) =>
  records.map((record) => ({
    agencyId: record.agencyId,
    itemCode: record.brand,
    itemName: getItemName(skuLookup, record.brand),
    reportDate: formatDateOnly(record.reportDate) ?? '',
    vendor: record.vendor,
    wholesaleBottlesSold: record.wholesaleBottlesSold,
  }));

export async function getWholesaleRecentPurchases({
  db = prisma,
  days = 30,
  licenseeId,
  takeAll = 50,
  takeEcho = 50,
}: {
  db?: PrismaClient;
  days?: number;
  licenseeId: string | null | undefined;
  takeAll?: number;
  takeEcho?: number;
}) {
  const normalizedLicenseeId = normalizeOhlqId(licenseeId);

  if (!normalizedLicenseeId) {
    return {
      all: { count: 0, records: [], totalBottlesSold: 0 },
      echo: { count: 0, records: [], totalBottlesSold: 0 },
      endDate: null,
      licenseeId: null,
      startDate: null,
    } satisfies WholesaleRecentPurchases;
  }

  const latest = await db.ohlqAnnualSalesByWholesaleRow.findFirst({
    orderBy: { reportDate: 'desc' },
    select: { reportDate: true },
  });

  if (!latest) {
    return {
      all: { count: 0, records: [], totalBottlesSold: 0 },
      echo: { count: 0, records: [], totalBottlesSold: 0 },
      endDate: null,
      licenseeId: normalizedLicenseeId,
      startDate: null,
    } satisfies WholesaleRecentPurchases;
  }

  const endDate = latest.reportDate;
  const startDate = getOhlqWindowStartDate(endDate, days);
  const baseWhere = {
    permitNumber: normalizedLicenseeId,
    reportDate: { gte: startDate, lte: endDate },
  };
  const echoWhere = {
    ...baseWhere,
    brand: { notIn: [...EXCLUDED_ECHO_ITEM_CODES] },
    vendor: ECHO_VENDOR_ID,
  };
  const [echoRecords, allRecords, echoCount, allCount, echoTotal, allTotal] = await Promise.all([
    db.ohlqAnnualSalesByWholesaleRow.findMany({
      where: echoWhere,
      orderBy: [{ reportDate: 'desc' }, { brand: 'asc' }, { agencyId: 'asc' }],
      take: takeEcho,
    }),
    db.ohlqAnnualSalesByWholesaleRow.findMany({
      where: baseWhere,
      orderBy: [{ reportDate: 'desc' }, { brand: 'asc' }, { agencyId: 'asc' }],
      take: takeAll,
    }),
    db.ohlqAnnualSalesByWholesaleRow.count({ where: echoWhere }),
    db.ohlqAnnualSalesByWholesaleRow.count({ where: baseWhere }),
    db.ohlqAnnualSalesByWholesaleRow.aggregate({
      where: echoWhere,
      _sum: { wholesaleBottlesSold: true },
    }),
    db.ohlqAnnualSalesByWholesaleRow.aggregate({
      where: baseWhere,
      _sum: { wholesaleBottlesSold: true },
    }),
  ]);
  const itemCodes = [...echoRecords, ...allRecords].map((record) => record.brand);
  const skuLookup = await getSkuLookup(db, itemCodes);

  return {
    all: {
      count: allCount,
      records: toPurchaseRecords(allRecords, skuLookup),
      totalBottlesSold: sum(allTotal._sum.wholesaleBottlesSold),
    },
    echo: {
      count: echoCount,
      records: toPurchaseRecords(echoRecords, skuLookup),
      totalBottlesSold: sum(echoTotal._sum.wholesaleBottlesSold),
    },
    endDate: formatDateOnly(endDate),
    licenseeId: normalizedLicenseeId,
    startDate: formatDateOnly(startDate),
  } satisfies WholesaleRecentPurchases;
}
