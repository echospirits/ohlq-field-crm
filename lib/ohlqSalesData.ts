import type { Prisma, PrismaClient } from '@prisma/client';
import { formatOhlqDate } from './ohlqDataStatus';
import {
  buildPermitNumberSearchConditions,
  normalizeOhlqId,
  resolveOhlqWholesaleSalesLookup,
  salesPermitMatchesLookup,
  type OhlqWholesaleLookupAccount,
} from './ohlqWholesaleMatching';
import { prisma } from './prisma';
import {
  DEFAULT_TENANT_EXCLUDED_ITEM_CODES,
  DEFAULT_TENANT_OHLQ_VENDOR_IDS,
  getTenantConfig,
  matchesTenantProduct,
  type TenantConfig,
} from './tenantConfig';

export const ECHO_VENDOR_ID = DEFAULT_TENANT_OHLQ_VENDOR_IDS[0];
export const EXCLUDED_ECHO_ITEM_CODES = DEFAULT_TENANT_EXCLUDED_ITEM_CODES;

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

export type WholesalePurchaseSummaryItem = {
  agencyCount: number;
  itemCode: string;
  itemName: string;
  purchaseLineCount: number;
  totalBottlesSold: number;
  vendorCount: number;
};

export type WholesalePurchaseList = {
  count: number;
  items: WholesalePurchaseSummaryItem[];
  purchaseLineCount: number;
  totalBottlesSold: number;
};

export type WholesaleRecentPurchases = {
  all: WholesalePurchaseList;
  echo: WholesalePurchaseList;
  endDate: string | null;
  licenseeId: string | null;
  productLabel: string;
  productPluralLabel: string;
  startDate: string | null;
  tracked: WholesalePurchaseList;
};

const addUtcDays = (date: Date, days: number) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));

export { normalizeOhlqId };

export const isConfiguredTenantItem = (
  vendor: string | null | undefined,
  itemCode: string | null | undefined,
  config: TenantConfig = getTenantConfig(),
) => matchesTenantProduct({ config, itemCode, vendor });

export const isEchoItem = isConfiguredTenantItem;

const getTenantSalesWhere = (config: TenantConfig): Prisma.OhlqAnnualSalesRowWhereInput => {
  if (config.productFilter.mode === 'item-list') {
    return {
      brand: { in: config.productFilter.itemCodes },
    };
  }

  return {
    vendor: { in: config.productFilter.vendorIds },
    ...(config.productFilter.excludedItemCodes.length > 0
      ? { brand: { notIn: config.productFilter.excludedItemCodes } }
      : {}),
  };
};

export const getOhlqWindowStartDate = (endDate: Date, days: number) => addUtcDays(endDate, -(days - 1));

const formatDateOnly = (date: Date | null | undefined) => (date ? formatOhlqDate(date) : null);

const sum = (value: number | null | undefined) => value ?? 0;

const getSkuLookup = async (db: PrismaClient, itemCodes: string[]) => {
  if (itemCodes.length === 0) return new Map<string, string>();

  const skus = await db.ohlqBrandMasterItem.findMany({
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
  const tenantConfig = getTenantConfig();
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
          ...getTenantSalesWhere(tenantConfig),
          reportDate: { gte: startDate, lte: endDate },
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

const toPurchaseSummaryItems = (
  records: Array<{
    agencyId: string;
    brand: string;
    vendor: string;
    wholesaleBottlesSold: number;
  }>,
  skuLookup: SkuLookup,
) => {
  const itemsByCode = new Map<
    string,
    {
      agencies: Set<string>;
      itemCode: string;
      itemName: string;
      purchaseLineCount: number;
      totalBottlesSold: number;
      vendors: Set<string>;
    }
  >();

  records.forEach((record) => {
    const item =
      itemsByCode.get(record.brand) ??
      {
        agencies: new Set<string>(),
        itemCode: record.brand,
        itemName: getItemName(skuLookup, record.brand),
        purchaseLineCount: 0,
        totalBottlesSold: 0,
        vendors: new Set<string>(),
      };

    item.agencies.add(record.agencyId);
    item.purchaseLineCount += 1;
    item.totalBottlesSold += record.wholesaleBottlesSold;
    item.vendors.add(record.vendor);
    itemsByCode.set(record.brand, item);
  });

  return Array.from(itemsByCode.values()).map((item) => ({
    agencyCount: item.agencies.size,
    itemCode: item.itemCode,
    itemName: item.itemName,
    purchaseLineCount: item.purchaseLineCount,
    totalBottlesSold: item.totalBottlesSold,
    vendorCount: item.vendors.size,
  }));
};

const sortPurchaseItemsByName = (left: WholesalePurchaseSummaryItem, right: WholesalePurchaseSummaryItem) =>
  left.itemName.localeCompare(right.itemName) ||
  left.itemCode.localeCompare(right.itemCode) ||
  right.totalBottlesSold - left.totalBottlesSold;

export async function getWholesaleRecentPurchases({
  account,
  db = prisma,
  days = 30,
  licenseeId,
  takeAll = 50,
  takeEcho = 50,
}: {
  account?: OhlqWholesaleLookupAccount;
  db?: PrismaClient;
  days?: number;
  licenseeId?: string | null | undefined;
  takeAll?: number;
  takeEcho?: number;
}) {
  const tenantConfig = getTenantConfig();
  const lookupAccount = account ?? { licenseeId };
  const lookup = await resolveOhlqWholesaleSalesLookup({ account: lookupAccount, db });
  const linkedLicenseeId = lookup.primaryLicenseeId ?? Array.from(lookup.permitNumbers)[0] ?? null;
  const permitNumberSearchConditions = buildPermitNumberSearchConditions(lookup);

  if (!linkedLicenseeId || permitNumberSearchConditions.length === 0) {
    return {
      all: { count: 0, items: [], purchaseLineCount: 0, totalBottlesSold: 0 },
      echo: { count: 0, items: [], purchaseLineCount: 0, totalBottlesSold: 0 },
      endDate: null,
      licenseeId: null,
      productLabel: tenantConfig.productLabel,
      productPluralLabel: tenantConfig.productPluralLabel,
      startDate: null,
      tracked: { count: 0, items: [], purchaseLineCount: 0, totalBottlesSold: 0 },
    } satisfies WholesaleRecentPurchases;
  }

  const latest = await db.ohlqAnnualSalesByWholesaleRow.findFirst({
    orderBy: { reportDate: 'desc' },
    select: { reportDate: true },
  });

  if (!latest) {
    return {
      all: { count: 0, items: [], purchaseLineCount: 0, totalBottlesSold: 0 },
      echo: { count: 0, items: [], purchaseLineCount: 0, totalBottlesSold: 0 },
      endDate: null,
      licenseeId: linkedLicenseeId,
      productLabel: tenantConfig.productLabel,
      productPluralLabel: tenantConfig.productPluralLabel,
      startDate: null,
      tracked: { count: 0, items: [], purchaseLineCount: 0, totalBottlesSold: 0 },
    } satisfies WholesaleRecentPurchases;
  }

  const endDate = latest.reportDate;
  const startDate = getOhlqWindowStartDate(endDate, days);
  const baseWhere = {
    OR: permitNumberSearchConditions,
    reportDate: { gte: startDate, lte: endDate },
  };
  const candidateRows = (
    await db.ohlqAnnualSalesByWholesaleRow.findMany({
      where: baseWhere,
      orderBy: [{ reportDate: 'desc' }, { brand: 'asc' }, { agencyId: 'asc' }],
    })
  ).filter((row) => salesPermitMatchesLookup(row.permitNumber, lookup));
  const trackedRows = candidateRows.filter((row) => isConfiguredTenantItem(row.vendor, row.brand, tenantConfig));
  const itemCodes = candidateRows.map((record) => record.brand);
  const skuLookup = await getSkuLookup(db, itemCodes);
  const trackedItems = toPurchaseSummaryItems(trackedRows, skuLookup).sort(sortPurchaseItemsByName);
  const allItems = toPurchaseSummaryItems(candidateRows, skuLookup).sort(sortPurchaseItemsByName);
  const tracked = {
    count: trackedItems.length,
    items: trackedItems.slice(0, takeEcho),
    purchaseLineCount: trackedRows.length,
    totalBottlesSold: trackedRows.reduce((total, row) => total + row.wholesaleBottlesSold, 0),
  };

  return {
    all: {
      count: allItems.length,
      items: allItems.slice(0, takeAll),
      purchaseLineCount: candidateRows.length,
      totalBottlesSold: candidateRows.reduce((total, row) => total + row.wholesaleBottlesSold, 0),
    },
    echo: tracked,
    endDate: formatDateOnly(endDate),
    licenseeId: linkedLicenseeId,
    productLabel: tenantConfig.productLabel,
    productPluralLabel: tenantConfig.productPluralLabel,
    startDate: formatDateOnly(startDate),
    tracked,
  } satisfies WholesaleRecentPurchases;
}
