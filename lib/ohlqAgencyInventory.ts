import { Prisma, type PrismaClient } from '@prisma/client';
import { normalizeOhlqId } from './ohlqWholesaleMatching';
import { prisma } from './prisma';
import {
  getTenantConfig,
  matchesTenantProduct,
  type TenantConfig,
} from './tenantConfig';

export const OHLQ_DISTILLERY_ONLY_DETAIL = 'A3A DISTILLERY ONLY';

export type AgencyInventoryDateRange = {
  from?: Date | string;
  to?: Date | string;
};

const toDateOnlyUtc = (value: Date | string) => {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid OHLQ inventory snapshot date: ${value}`);
  }
  return new Date(`${value}T00:00:00.000Z`);
};

export const isDistilleryOnlyInventoryDetail = (value: string | null | undefined) =>
  String(value ?? '').trim().toUpperCase() === OHLQ_DISTILLERY_ONLY_DETAIL;

export function isTenantAgencyInventoryItem({
  config = getTenantConfig(),
  detailCodeDescription,
  itemCode,
  vendorId,
}: {
  config?: TenantConfig;
  detailCodeDescription: string | null | undefined;
  itemCode: string | null | undefined;
  vendorId: string | null | undefined;
}) {
  return (
    matchesTenantProduct({ config, itemCode, vendor: vendorId }) &&
    !isDistilleryOnlyInventoryDetail(detailCodeDescription)
  );
}

export function getTenantAgencyInventoryWhere(
  config: TenantConfig = getTenantConfig(),
) {
  const productWhere =
    config.productFilter.mode === 'item-list'
      ? { itemCode: { in: config.productFilter.itemCodes } }
      : {
          itemCode:
            config.productFilter.excludedItemCodes.length > 0
              ? { notIn: config.productFilter.excludedItemCodes }
              : undefined,
          vendorId: { in: config.productFilter.vendorIds },
        };

  return {
    AND: [
      productWhere,
      {
        OR: [
          { detailCodeDescription: null },
          {
            detailCodeDescription: {
              mode: Prisma.QueryMode.insensitive,
              not: OHLQ_DISTILLERY_ONLY_DETAIL,
            },
          },
        ],
      },
    ],
  };
}

const agencyRelation = {
  select: {
    agencyId: true,
    id: true,
    name: true,
  },
} satisfies Prisma.AgencyDefaultArgs;

/** Query by the normalized OHLQ agency number (Agency.agencyId), which is also the sales join key. */
export async function getCurrentAgencyInventory({
  agencyNumber,
  db = prisma,
}: {
  agencyNumber: string;
  db?: PrismaClient;
}) {
  const normalizedAgencyNumber = normalizeOhlqId(agencyNumber);
  if (!normalizedAgencyNumber) return [];

  return db.ohlqAgencyInventoryCurrent.findMany({
    where: {
      agencyNumber: normalizedAgencyNumber,
      ...getTenantAgencyInventoryWhere(),
    },
    include: { agency: agencyRelation },
    orderBy: [{ itemName: 'asc' }, { itemCode: 'asc' }],
  });
}

export async function getCurrentAgencyItemInventory({
  agencyNumber,
  db = prisma,
  itemCode,
}: {
  agencyNumber: string;
  db?: PrismaClient;
  itemCode: string;
}) {
  const normalizedAgencyNumber = normalizeOhlqId(agencyNumber);
  const normalizedItemCode = normalizeOhlqId(itemCode);
  if (!normalizedAgencyNumber || !normalizedItemCode) return null;

  return db.ohlqAgencyInventoryCurrent.findFirst({
    where: {
      agencyNumber: normalizedAgencyNumber,
      itemCode: normalizedItemCode,
      ...getTenantAgencyInventoryWhere(),
    },
    include: { agency: agencyRelation },
  });
}

export async function getAgencyInventoryHistory({
  agencyNumber,
  db = prisma,
  itemCode,
  range,
}: {
  agencyNumber: string;
  db?: PrismaClient;
  itemCode: string;
  range?: AgencyInventoryDateRange;
}) {
  const normalizedAgencyNumber = normalizeOhlqId(agencyNumber);
  const normalizedItemCode = normalizeOhlqId(itemCode);
  if (!normalizedAgencyNumber || !normalizedItemCode) return [];

  const snapshotDate = range
    ? {
        ...(range.from ? { gte: toDateOnlyUtc(range.from) } : {}),
        ...(range.to ? { lte: toDateOnlyUtc(range.to) } : {}),
      }
    : undefined;

  return db.ohlqAgencyInventorySnapshot.findMany({
    where: {
      agencyNumber: normalizedAgencyNumber,
      itemCode: normalizedItemCode,
      snapshotDate,
      ...getTenantAgencyInventoryWhere(),
    },
    include: { agency: agencyRelation },
    orderBy: { snapshotDate: 'asc' },
  });
}

export async function getAgenciesWithCurrentItem({
  db = prisma,
  itemCode,
}: {
  db?: PrismaClient;
  itemCode: string;
}) {
  const normalizedItemCode = normalizeOhlqId(itemCode);
  if (!normalizedItemCode) return [];

  return db.ohlqAgencyInventoryCurrent.findMany({
    where: {
      itemCode: normalizedItemCode,
      ...getTenantAgencyInventoryWhere(),
    },
    include: { agency: agencyRelation },
    orderBy: [{ agencyName: 'asc' }, { agencyNumber: 'asc' }],
  });
}

export async function getLatestInventorySnapshotDate({ db = prisma }: { db?: PrismaClient } = {}) {
  const latest = await db.ohlqAgencyInventoryCurrent.findFirst({
    where: getTenantAgencyInventoryWhere(),
    orderBy: { snapshotDate: 'desc' },
    select: { snapshotDate: true },
  });
  return latest?.snapshotDate ?? null;
}

export async function getAgencyInventorySnapshot({
  agencyNumber,
  db = prisma,
  snapshotDate,
}: {
  agencyNumber: string;
  db?: PrismaClient;
  snapshotDate: Date | string;
}) {
  const normalizedAgencyNumber = normalizeOhlqId(agencyNumber);
  if (!normalizedAgencyNumber) return [];

  return db.ohlqAgencyInventorySnapshot.findMany({
    where: {
      agencyNumber: normalizedAgencyNumber,
      snapshotDate: toDateOnlyUtc(snapshotDate),
      ...getTenantAgencyInventoryWhere(),
    },
    include: { agency: agencyRelation },
    orderBy: [{ itemName: 'asc' }, { itemCode: 'asc' }],
  });
}
