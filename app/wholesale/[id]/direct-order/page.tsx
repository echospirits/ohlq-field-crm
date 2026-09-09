export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { OrganizationProductStatus } from '@prisma/client';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buildPageMetadata } from '../../../../lib/appBrand';
import { getUserDisplayName, requireUser } from '../../../../lib/auth';
import { formatEasternDateInputValue } from '../../../../lib/dateTime';
import { requireFeatureForUser } from '../../../../lib/organizations';
import { prisma } from '../../../../lib/prisma';
import { getWholesaleLicenseeIdValues } from '../../../../lib/wholesaleAccounts';
import { PageHeader } from '../../../components/PageChrome';
import { DirectWholesaleOrderForm } from './DirectWholesaleOrderForm';

export const metadata = buildPageMetadata('Create Direct Wholesale Order');

export default async function DirectWholesaleOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { organizationId } = await requireFeatureForUser(user, 'OHIO_DIRECT_WHOLESALE_ORDERS');
  const { id } = await params;
  const [account, locations, organizationProducts] = await Promise.all([
    prisma.wholesaleAccount.findFirst({
      where: { id, isActive: true, mergedIntoId: null },
      include: { licenseeIds: { orderBy: [{ isPrimary: 'desc' }, { licenseeId: 'asc' }] } },
    }),
    prisma.organizationA3aStoreIdentifier.findMany({
      where: { organizationId, market: 'OH', active: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }, { storeId: 'asc' }],
    }),
    prisma.organizationProduct.findMany({
      where: { organizationId, market: 'OH', active: true, discontinued: false, status: { in: [OrganizationProductStatus.OWNED, OrganizationProductStatus.REPRESENTED] } },
      orderBy: [{ displayName: 'asc' }, { externalItemCode: 'asc' }],
    }),
  ]);
  if (!account || (account.state && account.state.toUpperCase() !== 'OH')) notFound();
  const readyLocations = locations.filter((location) => location.name && location.addressLine1 && location.city && location.postalCode);
  const brandItems = organizationProducts.length ? await prisma.ohlqBrandMasterItem.findMany({
    where: { itemCode: { in: organizationProducts.map((product) => product.externalItemCode) } },
    select: { itemCode: true, name: true, wholesalePrice: true },
  }) : [];
  const brandByCode = new Map(brandItems.map((item) => [item.itemCode.toUpperCase(), item]));
  const licenseeIds = getWholesaleLicenseeIdValues(account);

  return <>
    <PageHeader eyebrow="Ohio wholesale" title="Create Direct Wholesale Order" description={`Prepare an A-3a PDF for ${account.name}. Nothing is emailed or transmitted.`} actions={<Link className="btn secondary" href={`/wholesale/${account.id}`}>Back to account</Link>} />
    {readyLocations.length === 0 ? <article className="card empty-state"><h2>A-3a location setup required</h2><p>Add the seller name and address for an active A-3a location before creating a wholesale PDF.</p><Link className="btn" href="/admin/organization">Configure organization</Link></article> : organizationProducts.length === 0 ? <article className="card empty-state"><h2>No organization products are available</h2><p>Confirm the organization's Ohio product selection before creating an order.</p><Link className="btn" href="/admin/organization">Configure products</Link></article> : <DirectWholesaleOrderForm
      account={{
        address: account.address || '', city: account.city || '', dba: account.name,
        id: account.id,
        name: account.ownership || account.name, permitNumber: licenseeIds[0] || account.licenseeId,
        phone: account.phone || '', postalCode: account.zip || '', state: 'OH',
      }}
      locations={readyLocations.map((location) => ({ id: location.id, label: location.dba || location.name!, storeId: location.storeId }))}
      products={organizationProducts.map((product) => {
        const brand = brandByCode.get(product.externalItemCode.toUpperCase());
        return { itemCode: product.externalItemCode, itemName: brand?.name || product.displayName || product.externalItemCode, wholesalePrice: brand?.wholesalePrice == null ? null : Number(brand.wholesalePrice) };
      })}
      saleDate={formatEasternDateInputValue()}
      submitterName={getUserDisplayName(user)}
    />}
  </>;
}
