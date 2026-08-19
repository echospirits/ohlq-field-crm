import type { PrismaClient } from '@prisma/client';
import { prisma } from './prisma';

export type AgencyVisitInventoryItem = {
  inventoryStatus: string | null;
  itemCode: string;
  itemName: string;
  lastSaleDate: string | null;
  minimum: number | null;
  onHand: number | null;
  retailSales7: number;
  retailSales30: number;
};

export type AgencyVisitContext = {
  asOfDate: string | null;
  inventory: AgencyVisitInventoryItem[];
};

const toIso = (value: Date | null | undefined) => value?.toISOString() ?? null;

export async function getAgencyVisitContext({
  agencyId,
  db = prisma,
}: {
  agencyId: string;
  db?: PrismaClient;
}): Promise<AgencyVisitContext | null> {
  const agency = await db.agency.findUnique({
    where: { id: agencyId },
    select: { id: true },
  });
  if (!agency) return null;

  const products = await db.agencyProductIntelligence.findMany({
    where: {
      agencyId: agency.id,
      inventorySnapshotDate: { not: null },
    },
    orderBy: [{ retailSales30: 'desc' }, { onHand: 'desc' }, { itemName: 'asc' }],
    select: {
      asOfDate: true,
      inventoryStatus: true,
      itemCode: true,
      itemName: true,
      lastSaleDate: true,
      minimum: true,
      onHand: true,
      retailSales7: true,
      retailSales30: true,
    },
  });

  return {
    asOfDate: toIso(products[0]?.asOfDate),
    inventory: products.map((product) => ({
      inventoryStatus: product.inventoryStatus,
      itemCode: product.itemCode,
      itemName: product.itemName,
      lastSaleDate: toIso(product.lastSaleDate),
      minimum: product.minimum,
      onHand: product.onHand,
      retailSales7: product.retailSales7,
      retailSales30: product.retailSales30,
    })),
  };
}
