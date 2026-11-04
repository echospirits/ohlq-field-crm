import { getCurrentAgencyInventory } from '../../lib/ohlqAgencyInventory';
import type { TenantConfig } from '../../lib/tenantConfig';
import { AgencyCurrentInventoryView } from './AgencyCurrentInventoryView';
import './agency-current-inventory.css';

export async function AgencyCurrentInventory({
  agencyNumber,
  config,
  organizationId,
}: {
  agencyNumber: string;
  config: TenantConfig;
  organizationId: string;
}) {
  try {
    const products = await getCurrentAgencyInventory({ agencyNumber, config, organizationId });
    return <AgencyCurrentInventoryView products={products} />;
  } catch {
    return <AgencyCurrentInventoryView products={[]} unavailable />;
  }
}
