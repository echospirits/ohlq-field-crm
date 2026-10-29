import {PipelineStageSettings} from './PipelineStageSettings';
import { AccountConfigurationSettings } from './AccountConfigurationSettings';
import { VisitGuideSettings } from './VisitGuideSettings';
import { EventbriteSettings } from './EventbriteSettings';
import { PlaybookSettings } from './PlaybookSettings';
import { RelationshipSettings } from './RelationshipSettings';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { SubmitButton } from '../../components/SubmitButton';
import { OrganizationAuditAction, UserRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { buildPageMetadata } from '../../../lib/appBrand';
import { requireAdmin } from '../../../lib/auth';
import {
  saveOrganizationA3aLocation,
  saveOrganizationProductSelection,
} from '../../../lib/organizationConfiguration';
import { discoverOrganizationProducts } from '../../../lib/organizationProductDiscovery';
import { requireOrganizationContext, writeOrganizationAudit } from '../../../lib/organizations';
import { saveOrganizationOhlqCredentials } from '../../../lib/ohlqTenantCredentials';
import { prisma } from '../../../lib/prisma';
import { PageHeader } from '../../components/PageChrome';
import { A3aLocationForm } from '../../components/A3aLocationForm';
import { ProductSelectionEditor } from './ProductSelectionEditor';
import { OpportunityStrategy } from './OpportunityStrategy';
import { EchoDataSettings } from './EchoDataSettings';
import { saveEchoStates, addEchoVendor } from './data-actions';

export const metadata = buildPageMetadata('Echo Settings');

const clean = (value: FormDataEntryValue | null) => String(value ?? '').trim();

async function getAdminOrganization() {
  const actor = await requireAdmin();
  const context = await requireOrganizationContext(actor);
  return { actor, organizationId: context.organizationId };
}

async function saveA3aLocation(formData: FormData) {
  'use server';
  const { actor, organizationId } = await getAdminOrganization();
  try {
    const location = await saveOrganizationA3aLocation({
      organizationId,
      input: {
        active: formData.get('active') === 'on',
        addressLine1: clean(formData.get('addressLine1')),
        addressLine2: clean(formData.get('addressLine2')),
        city: clean(formData.get('city')),
        dba: clean(formData.get('dba')),
        email: clean(formData.get('email')),
        isDefault: formData.get('isDefault') === 'on',
        locationId: clean(formData.get('locationId')) || undefined,
        name: clean(formData.get('name')),
        permitNumber: clean(formData.get('permitNumber')),
        phone: clean(formData.get('phone')),
        postalCode: clean(formData.get('postalCode')),
        state: clean(formData.get('state')),
        storeId: clean(formData.get('storeId')),
      },
    });
    await writeOrganizationAudit(actor.id, organizationId, OrganizationAuditAction.A3A_STORE_CONFIGURATION_CHANGED, { locationId: location.id, storeId: location.storeId });
  } catch {
    redirect('/admin/organization?status=invalid-a3a-location');
  }
  revalidatePath('/admin/organization');
  redirect('/admin/organization?status=a3a-location-saved');
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

async function saveOhlqCredentials(formData: FormData) {
  'use server';
  const { actor, organizationId } = await getAdminOrganization();
  try {
    await saveOrganizationOhlqCredentials({ organizationId, password: clean(formData.get('password')), updatedByUserId: actor.id, username: clean(formData.get('username')) });
    await writeOrganizationAudit(actor.id, organizationId, OrganizationAuditAction.OHLQ_INVENTORY_CREDENTIALS_CHANGED, { configured: true });
  } catch {
    redirect('/admin/organization?status=invalid-ohlq-credentials');
  }
  revalidatePath('/admin/organization');
  redirect('/admin/organization?status=ohlq-credentials-saved');
}

async function removeOhlqCredentials() {
  'use server';
  const { actor, organizationId } = await getAdminOrganization();
  if (actor.role === UserRole.PLATFORM_ADMIN) redirect('/admin/organization?status=tenant-admin-required');
  await prisma.organizationOhlqCredentials.deleteMany({ where: { organizationId } });
  await writeOrganizationAudit(actor.id, organizationId, OrganizationAuditAction.OHLQ_INVENTORY_CREDENTIALS_CHANGED, { configured: false });
  revalidatePath('/admin/organization');
  redirect('/admin/organization?status=ohlq-credentials-removed');
}

export default async function OrganizationSetupPage({ searchParams }: { searchParams?: Promise<{ status?: string }> }) {
  const { actor, organizationId } = await getAdminOrganization();
  const status = (await searchParams)?.status;
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: {
      a3aStoreIdentifiers: { orderBy: [{ active: 'desc' }, { isDefault: 'desc' }, { storeId: 'asc' }] },
      products: { orderBy: [{ status: 'asc' }, { externalItemCode: 'asc' }], take: 1000 },
      vendorIdentifiers: { where: { active: true }, orderBy: { vendorId: 'asc' } },
      ohlqCredentials: { select: { configuredAt: true, usernameHint: true } },
    },
  });
  if (!organization) redirect('/');

  return <>
    <PageHeader eyebrow="Administration" title="Echo Settings" description="Maintain Echo's selling locations, products, data connections, and team workflows." />
    {status ? <p className="notice" role="status">{status.replaceAll('-', ' ')}</p> : null}
    <EchoDataSettings enabledStates={organization.enabledStates} vendors={organization.vendorIdentifiers} saveStates={saveEchoStates} addVendor={addEchoVendor} />
    <section className="platform-grid">
      <article className="card a3a-location-settings">
        <div className="section-heading"><div><h2>A-3a selling locations</h2><p className="muted">This information fills the seller section of downloaded wholesale-order PDFs.</p></div></div>
        {organization.a3aStoreIdentifiers.map((location) => <A3aLocationForm action={saveA3aLocation} key={location.id} location={location} />)}
        <A3aLocationForm action={saveA3aLocation} />
      </article>
    </section>
    <section className="platform-grid">
      <form action={saveOhlqCredentials} className="card">
        <div className="section-heading"><div><h2>OHLQ inventory login</h2><p className="muted">Used only for this organization's inventory download. Credentials are encrypted and never displayed after saving.</p></div><span className="pill">{organization.ohlqCredentials ? 'Configured' : 'Not configured'}</span></div>
        {organization.ohlqCredentials ? <p className="muted">Current login: {organization.ohlqCredentials.usernameHint}</p> : null}
        <div className="form-grid"><label>OHLQ username<input autoComplete="username" name="username" required /></label><label>OHLQ password<input autoComplete="new-password" name="password" type="password" required /></label></div>
        <SubmitButton type="submit">{organization.ohlqCredentials ? 'Replace credentials' : 'Save credentials'}</SubmitButton>
      </form>
      <article className="card"><h2>Inventory isolation</h2><p className="muted">The daily runner stores this tenant's current inventory and history separately. Missing credentials skip this tenant without using another organization's login.</p>{actor.role !== UserRole.PLATFORM_ADMIN && organization.ohlqCredentials ? <form action={removeOhlqCredentials}><SubmitButton className="danger" type="submit">Remove inventory login</SubmitButton></form> : null}</article>
    </section>
    <OpportunityStrategy organizationId={organizationId} />
    <RelationshipSettings organizationId={organizationId} />
    <PlaybookSettings organizationId={organizationId} />
    <VisitGuideSettings organizationId={organizationId} />
    <AccountConfigurationSettings organizationId={organizationId} />
    <PipelineStageSettings organizationId={organizationId} />
    <EventbriteSettings organizationId={organizationId} />
    <article className="card product-selection-card">
      <div className="section-heading"><div><h2>Product selection</h2><p className="muted">Choose which discovered item codes Echo includes. Echo administrators can maintain Brand Master imports.</p></div><form action={refreshProductCandidates}><SubmitButton className="compact-btn secondary" type="submit">Check for new products</SubmitButton></form></div>
      <ProductSelectionEditor action={saveProductSelection} organizationId={organizationId} products={organization.products.map((product) => ({ id: product.id, itemCode: product.externalItemCode, name: product.displayName, status: product.status }))} />
    </article>
  </>;
}
