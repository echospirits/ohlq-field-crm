export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { OrganizationAuditAction } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { buildPageMetadata } from '../../../lib/appBrand';
import { requireAdmin } from '../../../lib/auth';
import {
  normalizeOrganizationIdentifierList,
  replaceOrganizationA3aStoreIds,
  saveOrganizationProductSelection,
} from '../../../lib/organizationConfiguration';
import { discoverOrganizationProducts } from '../../../lib/organizationProductDiscovery';
import { requireOrganizationContext, writeOrganizationAudit } from '../../../lib/organizations';
import { prisma } from '../../../lib/prisma';
import { PageHeader } from '../../components/PageChrome';
import { ProductSelectionEditor } from '../../platform/organizations/[id]/ProductSelectionEditor';

export const metadata = buildPageMetadata('Organization Setup');

const clean = (value: FormDataEntryValue | null) => String(value ?? '').trim();

async function getAdminOrganization() {
  const actor = await requireAdmin();
  const context = await requireOrganizationContext(actor);
  return { actor, organizationId: context.organizationId };
}

async function saveA3aStoreIds(formData: FormData) {
  'use server';
  const { actor, organizationId } = await getAdminOrganization();
  try {
    const storeIds = await replaceOrganizationA3aStoreIds({
      organizationId,
      storeIds: normalizeOrganizationIdentifierList(clean(formData.get('a3aStoreIds'))),
    });
    await writeOrganizationAudit(actor.id, organizationId, OrganizationAuditAction.A3A_STORE_CONFIGURATION_CHANGED, { storeIds });
  } catch {
    redirect('/admin/organization?status=invalid-a3a-store-ids');
  }
  revalidatePath('/admin/organization');
  redirect('/admin/organization?status=a3a-store-ids-saved');
}

async function refreshProductCandidates() {
  'use server';
  const { actor, organizationId } = await getAdminOrganization();
  const discovery = await discoverOrganizationProducts({ organizationId });
  await writeOrganizationAudit(actor.id, organizationId, OrganizationAuditAction.PRODUCT_CONFIGURATION_CHANGED, {
    catalogRefresh: true,
    discoveredProducts: discovery.created,
    inferredVendorNames: discovery.inferredVendorNames,
  });
  revalidatePath('/admin/organization');
  redirect(`/admin/organization?status=${discovery.created ? `products-discovered-${discovery.created}` : 'no-new-products'}`);
}

async function saveProductSelection(formData: FormData) {
  'use server';
  const { actor, organizationId } = await getAdminOrganization();
  const includedProductIds = [...new Set(formData.getAll('includedProductIds').map(clean).filter(Boolean))];
  try {
    const counts = await saveOrganizationProductSelection({ includedProductIds, organizationId });
    await writeOrganizationAudit(actor.id, organizationId, OrganizationAuditAction.PRODUCT_CONFIGURATION_CHANGED, counts);
  } catch {
    redirect('/admin/organization?status=invalid-product-selection');
  }
  revalidatePath('/admin/organization');
  redirect('/admin/organization?status=product-selection-saved');
}

export default async function OrganizationSetupPage({ searchParams }: { searchParams?: Promise<{ status?: string }> }) {
  const { organizationId } = await getAdminOrganization();
  const status = (await searchParams)?.status;
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: {
      a3aStoreIdentifiers: { where: { active: true }, orderBy: { storeId: 'asc' } },
      products: { orderBy: [{ status: 'asc' }, { externalItemCode: 'asc' }], take: 1000 },
      vendorIdentifiers: { where: { active: true }, orderBy: { vendorId: 'asc' } },
    },
  });
  if (!organization) redirect('/');

  return <>
    <PageHeader eyebrow="Administration" title="Organization setup" description="Maintain the location and product lists that belong to your organization." />
    {status ? <p className="notice" role="status">{status.replaceAll('-', ' ')}</p> : null}
    <section className="platform-grid">
      <form action={saveA3aStoreIds} className="card">
        <div className="section-heading"><div><span className="page-eyebrow">Organization locations</span><h2>A3A Store IDs</h2><p className="muted">Enter the A3A store numbers located in your organization's locations.</p></div><button className="compact-btn" type="submit">Save store IDs</button></div>
        <label>A3A Store IDs<textarea defaultValue={organization.a3aStoreIdentifiers.map((item) => item.storeId).join('\n')} name="a3aStoreIds" placeholder="One store number per line" rows={7} /></label>
      </form>
      <article className="card">
        <span className="page-eyebrow">Product discovery</span><h2>Vendor IDs</h2>
        <p className="muted">These identifiers determine which products can be discovered. Only the Platform Admin can change them.</p>
        <div className="platform-list">{organization.vendorIdentifiers.map((vendor) => <div key={vendor.id}><strong>{vendor.vendorId}</strong><span className="pill">Managed by platform</span></div>)}</div>
      </article>
    </section>
    <article className="card product-selection-card">
      <div className="section-heading"><div><span className="page-eyebrow">Catalog configuration</span><h2>Product selection</h2><p className="muted">Choose which discovered item codes your organization includes. Brand Master imports remain Platform Admin-only.</p></div><form action={refreshProductCandidates}><button className="compact-btn secondary" type="submit">Check for new products</button></form></div>
      <ProductSelectionEditor action={saveProductSelection} organizationId={organizationId} products={organization.products.map((product) => ({ id: product.id, itemCode: product.externalItemCode, name: product.displayName, status: product.status }))} />
    </article>
  </>;
}
