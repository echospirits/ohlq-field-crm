export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { OrganizationAuditAction, UserRole } from '@prisma/client';
import { redirect } from 'next/navigation';
import { buildPageMetadata } from '../../../../lib/appBrand';
import { requirePlatformAdmin } from '../../../../lib/auth';
import { getPackageFeatureKeys } from '../../../../lib/featureRegistry';
import { assertFeatureDependencies } from '../../../../lib/organizations';
import { prisma } from '../../../../lib/prisma';
import { createProvisioningRun, runProvisioning } from '../../../../lib/tenantProvisioning';
import { PageHeader } from '../../../components/PageChrome';

export const metadata = buildPageMetadata('New Organization');

const clean = (value: FormDataEntryValue | null) => String(value ?? '').trim();
const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

async function provisionOrganization(formData: FormData) {
  'use server';
  const actor = await requirePlatformAdmin();
  const name = clean(formData.get('name'));
  const displayName = clean(formData.get('displayName')) || name;
  const slug = slugify(clean(formData.get('slug')) || name);
  const primaryState = clean(formData.get('primaryState')).toUpperCase() || 'OH';
  const timezone = clean(formData.get('timezone')) || 'America/New_York';
  const adminFirstName = clean(formData.get('adminFirstName'));
  const adminLastName = clean(formData.get('adminLastName'));
  const adminEmail = clean(formData.get('adminEmail')).toLowerCase();
  const vendorIds = [...new Set(clean(formData.get('vendorIds')).split(/[\s,;]+/).map((value) => value.toUpperCase()).filter(Boolean))];
  const intelligenceEnabled = formData.get('intelligence') === 'on';
  const features = assertFeatureDependencies(getPackageFeatureKeys(intelligenceEnabled));
  if (!name || !slug || !adminFirstName || !adminLastName || !adminEmail || primaryState !== 'OH' || vendorIds.some((value) => !/^[A-Z0-9-]{3,32}$/.test(value))) redirect('/platform/organizations/new?status=invalid');
  const existing = await prisma.user.findUnique({ where: { email: adminEmail }, select: { id: true } });
  if (existing) redirect('/platform/organizations/new?status=email-in-use');
  const result = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({ data: {
      name, displayName, slug, primaryState, timezone, active: true, accountStatus: 'TRIAL', onboardingStatus: 'PROVISIONING',
      appName: clean(formData.get('appName')) || 'Neat',
      digestName: clean(formData.get('digestName')) || 'Neat',
      productLabel: clean(formData.get('productLabel')) || 'product',
      productPluralLabel: clean(formData.get('productPluralLabel')) || 'products',
      brandPrimaryColor: clean(formData.get('brandPrimaryColor')) || '#2458ff',
      brandAccentColor: clean(formData.get('brandAccentColor')) || '#6d28d9',
      contactName: clean(formData.get('contactName')) || `${adminFirstName} ${adminLastName}`,
      contactEmail: clean(formData.get('contactEmail')).toLowerCase() || adminEmail,
      contactPhone: clean(formData.get('contactPhone')) || null,
      supportEmail: clean(formData.get('supportEmail')).toLowerCase() || adminEmail,
      website: clean(formData.get('website')) || null,
      settings: { locale: clean(formData.get('locale')) || 'en-US', weekStartsOn: Number(clean(formData.get('weekStartsOn')) || 0) },
      onboardingData: { identity: true, admin: true, ohioMarket: vendorIds.length > 0, features: features.length > 0, productsConfirmed: false, firstLogin: false },
    } });
    await tx.organizationVendorIdentifier.createMany({ data: vendorIds.map((vendorId) => ({ organizationId: organization.id, market: primaryState, vendorId })) });
    await tx.organizationFeature.createMany({ data: features.map((featureKey) => ({ organizationId: organization.id, featureKey, enabled: true, source: 'provisioning' })) });
    const candidates = vendorIds.length ? await tx.ohlqAgencyInventoryCurrent.findMany({ where: { vendorId: { in: vendorIds } }, distinct: ['itemCode'], orderBy: { itemCode: 'asc' }, select: { itemCode: true, itemName: true } }) : [];
    await tx.organizationProduct.createMany({ skipDuplicates: true, data: candidates.map((candidate) => ({ organizationId: organization.id, market: primaryState, externalItemCode: candidate.itemCode, displayName: candidate.itemName, status: 'PENDING_REVIEW', active: true })) });
    const user = await tx.user.create({ data: { organizationId: organization.id, email: adminEmail, firstName: adminFirstName, lastName: adminLastName, name: `${adminFirstName} ${adminLastName}`, role: UserRole.ADMIN, isActive: false } });
    await tx.organization.update({ where: { id: organization.id }, data: { onboardingStatus: 'PROVISIONING', onboardingData: { identity: true, admin: true, ohioMarket: vendorIds.length > 0, productsDiscovered: candidates.length, productsConfirmed: false, features: true, firstLogin: false } } });
    await tx.organizationAuditEvent.createMany({ data: [{ organizationId: organization.id, actorUserId: actor.id, action: OrganizationAuditAction.ORGANIZATION_CREATED }, { organizationId: organization.id, actorUserId: actor.id, action: OrganizationAuditAction.INITIAL_ADMIN_CREATED, metadata: { userId: user.id } }] });
    return { organization };
  }).catch((error) => { if (String(error).includes('Unique constraint')) redirect('/platform/organizations/new?status=duplicate'); throw error; });
  const run = await createProvisioningRun({ actorUserId: actor.id, organizationId: result.organization.id, configuration: { source: 'platform-admin' } });
  await runProvisioning(run.id);
  redirect(`/platform/organizations/${result.organization.id}?status=configuration-created`);
}

export default async function NewOrganizationPage({ searchParams }: { searchParams?: Promise<{ status?: string }> }) {
  await requirePlatformAdmin();
  const status = (await searchParams)?.status;
  return <>
    <PageHeader eyebrow="Provisioning" title="New organization" description="Create the company, discover its Ohio products, enable modules, and invite its first administrator." />
    {status ? <p className="notice danger">Provisioning could not continue: {status.replaceAll('-', ' ')}.</p> : null}
    <form action={provisionOrganization} className="platform-provisioning">
      <fieldset className="card"><legend>1. Organization identity</legend><div className="form-grid"><label>Company name<input name="name" required /></label><label>Display name<input name="displayName" /></label><label>Slug<input name="slug" placeholder="auto-generated when blank" /></label><label>Market<select name="primaryState" defaultValue="OH"><option value="OH">Ohio</option></select></label><label>Timezone<input name="timezone" defaultValue="America/New_York" required /></label><label>Website<input name="website" type="url" /></label></div></fieldset>
      <fieldset className="card"><legend>2. Initial organization admin</legend><div className="form-grid"><label>First name<input name="adminFirstName" required /></label><label>Last name<input name="adminLastName" required /></label><label>Email<input name="adminEmail" type="email" required /></label></div><p className="muted">Neat uses the existing secure, single-use invitation flow; no password is handled here.</p></fieldset>
      <fieldset className="card"><legend>3–4. Ohio data and product discovery</legend><label>Ohio Vendor IDs<textarea name="vendorIds" placeholder="One or more IDs, separated by commas or new lines" rows={3} /></label><p className="muted">Matching item codes will be discovered from shared OHLQ data. Choose which products to include on the organization page.</p></fieldset>
      <fieldset className="card"><legend>Customer-facing configuration</legend><div className="form-grid"><label>Application name<input defaultValue="Neat" name="appName" required /></label><label>Digest name<input defaultValue="Neat" name="digestName" required /></label><label>Product label<input defaultValue="product" name="productLabel" required /></label><label>Product plural label<input defaultValue="products" name="productPluralLabel" required /></label><label>Primary color<input defaultValue="#2458ff" name="brandPrimaryColor" pattern="#[0-9A-Fa-f]{6}" /></label><label>Accent color<input defaultValue="#6d28d9" name="brandAccentColor" pattern="#[0-9A-Fa-f]{6}" /></label><label>Customer contact<input name="contactName" /></label><label>Contact email<input name="contactEmail" type="email" /></label><label>Contact phone<input name="contactPhone" type="tel" /></label><label>Support email<input name="supportEmail" type="email" /></label><label>Locale<input defaultValue="en-US" name="locale" /></label><label>Week starts on<select defaultValue="0" name="weekStartsOn"><option value="0">Sunday</option><option value="1">Monday</option></select></label></div></fieldset>
      <fieldset className="card"><legend>5. Plan</legend><p className="muted">Core CRM is always included. Select the Intelligence add-on only when the organization needs the complete intelligence toolkit.</p><div className="package-entitlement-grid"><article className="package-entitlement"><span><strong>Core CRM</strong><small>Accounts, visits, worklists, users, Ohio data, integrations, and standard reporting.</small></span><span className="pill">Included</span></article><label className="package-entitlement selectable"><input name="intelligence" type="checkbox" /><span><strong>Intelligence</strong><small>Agency Intelligence, Wholesale Opportunities, and Advanced Intelligence.</small></span><span className="pill">Add-on</span></label></div></fieldset>
      <section className="card provisioning-review"><div><span className="page-eyebrow">6. Discover and review</span><h2>Create configuration</h2><p className="muted">This creates an isolated tenant configuration and discovers product candidates. Review ownership on the next screen, then run the persisted provisioning workflow.</p></div><button type="submit">Create and discover products</button></section>
    </form>
  </>;
}
