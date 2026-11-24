import type { Prisma } from '@prisma/client';
import { isDistilleryOnlyInventoryDetail, isInactiveOhlqInventoryListingStatus } from './ohlqAgencyInventory';
import { getDistilleryOnlyItemCodes } from './ohlqProductEligibility';
import { normalizeOhlqId } from './ohlqWholesaleMatching';
import { prisma } from './prisma';

type CatalogStatus = { itemCode: string; solItemStatusCode: string | null };
type RestrictionDb = Pick<Prisma.TransactionClient, 'ohlqAgencyInventoryCurrent' | 'ohlqBrandMasterItem' | 'ohlqTenantInventoryImportStatus'>;
const DELISTED_STATUS_CODE = '30';

export function isRestaurantProductRestricted(itemCode: string | null | undefined, restrictions: ReadonlySet<string>): boolean {
  const code = normalizeOhlqId(itemCode);
  return code !== null && restrictions.has(code);
}

export async function loadRestaurantProductRestrictions(
  organizationId: string,
  db: RestrictionDb = prisma,
  catalog?: readonly CatalogStatus[],
): Promise<Set<string>> {
  const [products, lastCompletedInventory, listings] = await Promise.all([
    catalog ?? db.ohlqBrandMasterItem.findMany({
      // Read only possible matches while allowing padded codes from older records.
      where: { solItemStatusCode: { contains: DELISTED_STATUS_CODE } },
      select: { itemCode: true, solItemStatusCode: true },
    }),
    db.ohlqTenantInventoryImportStatus.findFirst({
      where: { organizationId, status: 'COMPLETED' },
      orderBy: [{ reportDate: 'desc' }, { updatedAt: 'desc' }],
      select: { diagnostics: true },
    }),
    db.ohlqAgencyInventoryCurrent.groupBy({
      where: { organizationId },
      by: ['itemCode', 'detailCodeDescription', 'status'],
    }),
  ]);

  const restricted = new Set<string>();
  for (const itemCode of getDistilleryOnlyItemCodes(lastCompletedInventory?.diagnostics)) {
    const code = normalizeOhlqId(itemCode);
    if (code) restricted.add(code);
  }
  for (const product of products) {
    const code = normalizeOhlqId(product.itemCode);
    if (code && product.solItemStatusCode?.trim() === DELISTED_STATUS_CODE) restricted.add(code);
  }

  // Inventory imported before the short A3A DIST label was recognized can
  // still contain distillery rows. Keep products with a separate store route.
  const distilleryListings = new Set<string>();
  const storeListings = new Set<string>();
  for (const listing of listings) {
    const code = normalizeOhlqId(listing.itemCode);
    if (!code) continue;
    if (isDistilleryOnlyInventoryDetail(listing.detailCodeDescription)) distilleryListings.add(code);
    else if (!isInactiveOhlqInventoryListingStatus(listing.status)) storeListings.add(code);
  }
  for (const code of distilleryListings) {
    if (!storeListings.has(code)) restricted.add(code);
  }
  return restricted;
}
