import { createHash } from 'crypto';
import { getOhlqLicenseeMatchKeys } from './ohlqWholesaleMatching';
import { matchesTenantProduct, type TenantConfig } from './tenantConfig';
import { normalizeOpportunityCategory } from './opportunityConfig';

type DailyRow = { reportDate: Date; permitNumber: string; agencyId: string; vendor: string; brand: string; wholesaleBottlesSold: number };
type Identity = { id: string; licenseeId: string | null; licenseeIds: { licenseeId: string }[] };
type Catalog = { itemCode: string; name: string; category: string | null };
export function buildDailyPurchaseEvents(rows: DailyRow[], accounts: Identity[], catalog: Catalog[], config: TenantConfig) {
  const identities = new Map<string, Set<string>>();
  accounts.forEach(a => [a.licenseeId, ...a.licenseeIds.map(x => x.licenseeId)].forEach(id => getOhlqLicenseeMatchKeys(id).forEach(key => identities.set(key, new Set([...(identities.get(key) ?? []), a.id])))));
  const masters = new Map(catalog.map(c => [c.itemCode,c]));
  return rows.flatMap(row => {
    const ids = new Set(getOhlqLicenseeMatchKeys(row.permitNumber).flatMap(key => [...(identities.get(key) ?? [])]));
    if (ids.size !== 1 || row.wholesaleBottlesSold <= 0) return [];
    const wholesaleAccountId = [...ids][0]; const master = masters.get(row.brand);
    const key = `${config.id}|${wholesaleAccountId}|${row.reportDate.toISOString().slice(0,10)}|${row.permitNumber}|${row.agencyId}|${row.vendor}|${row.brand}`;
    return [{ organizationId: config.id, wholesaleAccountId, reportDate: row.reportDate, agencyId: row.agencyId, vendor: row.vendor, itemCode: row.brand,
      itemName: master?.name ?? 'Name pending', category: normalizeOpportunityCategory(master?.category, master?.name), bottles: row.wholesaleBottlesSold,
      annualBottlesAfter: row.wholesaleBottlesSold, isTenantProduct: matchesTenantProduct({ config, vendor: row.vendor, itemCode: row.brand }),
      sourceKey: `DAILY_V3:${createHash('sha256').update(key).digest('hex')}` }];
  });
}
