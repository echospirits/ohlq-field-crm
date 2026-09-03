import { OrganizationProductStatus, Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from './prisma';

type ProductDiscoveryDb = Pick<
  PrismaClient,
  | 'ohlqAgencyInventoryCurrent'
  | 'ohlqAnnualSalesByWholesaleRow'
  | 'ohlqAnnualSalesRow'
  | 'ohlqBrandMasterItem'
  | 'organization'
  | 'organizationProduct'
>;

const unique = (values: Array<string | null | undefined>) => [
  ...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))),
];

const asObject = (value: Prisma.JsonValue | null | undefined) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export async function discoverOrganizationProducts({
  db = prisma,
  organizationId,
}: {
  db?: ProductDiscoveryDb;
  organizationId: string;
}) {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      onboardingData: true,
      primaryState: true,
      vendorIdentifiers: {
        where: { active: true },
        select: { label: true, vendorId: true },
      },
    },
  });
  if (!organization) throw new Error('Organization no longer exists.');

  const vendorIds = unique(organization.vendorIdentifiers.map((vendor) => vendor.vendorId));
  if (!vendorIds.length) return { candidates: 0, created: 0, inferredVendorNames: [] as string[] };

  const [annualItems, wholesaleItems, inventoryItems] = await Promise.all([
    db.ohlqAnnualSalesRow.findMany({
      where: { vendor: { in: vendorIds } },
      distinct: ['brand'],
      select: { brand: true },
    }),
    db.ohlqAnnualSalesByWholesaleRow.findMany({
      where: { vendor: { in: vendorIds } },
      distinct: ['brand'],
      select: { brand: true },
    }),
    db.ohlqAgencyInventoryCurrent.findMany({
      where: { vendorId: { in: vendorIds } },
      distinct: ['itemCode'],
      select: { itemCode: true, itemName: true },
    }),
  ]);
  const observedItemCodes = unique([
    ...annualItems.map((item) => item.brand),
    ...wholesaleItems.map((item) => item.brand),
    ...inventoryItems.map((item) => item.itemCode),
  ]);
  const mappedCatalogItems = observedItemCodes.length
    ? await db.ohlqBrandMasterItem.findMany({
        where: { itemCode: { in: observedItemCodes } },
        select: { vendor: true },
      })
    : [];
  const inferredVendorNames = unique(mappedCatalogItems.map((item) => item.vendor));
  const configuredVendorNames = unique(organization.vendorIdentifiers.map((vendor) => vendor.label));
  const catalogFilters: Prisma.OhlqBrandMasterItemWhereInput[] = [];
  if (observedItemCodes.length) catalogFilters.push({ itemCode: { in: observedItemCodes } });
  if (inferredVendorNames.length) catalogFilters.push({ vendor: { in: inferredVendorNames } });
  for (const vendorName of configuredVendorNames) {
    catalogFilters.push({ vendor: { contains: vendorName, mode: 'insensitive' } });
  }
  const catalogItems = catalogFilters.length
    ? await db.ohlqBrandMasterItem.findMany({
        where: { OR: catalogFilters },
        orderBy: { itemCode: 'asc' },
        select: { category: true, itemCode: true, name: true },
      })
    : [];

  const candidates = new Map<string, { category: string | null; itemCode: string; name: string }>();
  for (const item of inventoryItems) candidates.set(item.itemCode, { category: null, itemCode: item.itemCode, name: item.itemName });
  for (const item of catalogItems) candidates.set(item.itemCode, item);

  const created = await db.organizationProduct.createMany({
    skipDuplicates: true,
    data: [...candidates.values()].map((candidate) => ({
      active: true,
      category: candidate.category,
      displayName: candidate.name,
      externalItemCode: candidate.itemCode,
      market: organization.primaryState,
      organizationId,
      status: OrganizationProductStatus.PENDING_REVIEW,
    })),
  });

  if (created.count > 0) {
    const totalProducts = await db.organizationProduct.count({ where: { organizationId, active: true } });
    await db.organization.update({
      where: { id: organizationId },
      data: {
        onboardingData: {
          ...asObject(organization.onboardingData),
          productsConfirmed: false,
          productsDiscovered: totalProducts,
        },
      },
    });
  }

  return { candidates: candidates.size, created: created.count, inferredVendorNames };
}

export async function discoverProductsForOrganizations({ db = prisma }: { db?: ProductDiscoveryDb } = {}) {
  const organizations = await db.organization.findMany({
    where: { vendorIdentifiers: { some: { active: true } } },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  let productsDiscovered = 0;
  for (const organization of organizations) {
    const result = await discoverOrganizationProducts({ db, organizationId: organization.id });
    productsDiscovered += result.created;
  }
  return { organizationsScanned: organizations.length, productsDiscovered };
}
