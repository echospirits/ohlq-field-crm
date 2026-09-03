export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { OrganizationAuditAction, OrganizationProductStatus, OrganizationStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { buildPageMetadata } from '../../../../lib/appBrand';
import { getUserDisplayName, requirePlatformAdmin } from '../../../../lib/auth';
import { FEATURE_KEYS, FEATURE_REGISTRY } from '../../../../lib/featureRegistry';
import { assertFeatureDependencies, writeOrganizationAudit } from '../../../../lib/organizations';
import { discoverOrganizationProducts } from '../../../../lib/organizationProductDiscovery';
import { prisma } from '../../../../lib/prisma';
import { PageHeader } from '../../../components/PageChrome';
import { InvitationControls } from './InvitationControls';
import { runProvisioningAction, startProvisioningAction } from './actions';

export const metadata = buildPageMetadata('Organization');
const clean = (value: FormDataEntryValue | null) => String(value ?? '').trim();

async function updateOrganization(formData: FormData) {
  'use server';
  const actor = await requirePlatformAdmin();
  const id = clean(formData.get('organizationId'));
  const active = formData.get('active') === 'on';
  const accountStatus = clean(formData.get('accountStatus')) as OrganizationStatus;
  if (!id || !Object.values(OrganizationStatus).includes(accountStatus)) redirect('/platform/organizations');
  await prisma.organization.update({ where: { id }, data: {
    active, accountStatus,
    appName: clean(formData.get('appName')) || 'Neat',
    brandAccentColor: clean(formData.get('brandAccentColor')) || '#6d28d9',
    brandPrimaryColor: clean(formData.get('brandPrimaryColor')) || '#2458ff',
    contactEmail: clean(formData.get('contactEmail')).toLowerCase() || null,
    contactName: clean(formData.get('contactName')) || null,
    contactPhone: clean(formData.get('contactPhone')) || null,
    digestName: clean(formData.get('digestName')) || 'Neat',
    displayName: clean(formData.get('displayName')),
    name: clean(formData.get('name')),
    notes: clean(formData.get('notes')) || null,
    productLabel: clean(formData.get('productLabel')) || 'product',
    productPluralLabel: clean(formData.get('productPluralLabel')) || 'products',
    settings: { locale: clean(formData.get('locale')) || 'en-US', weekStartsOn: Number(clean(formData.get('weekStartsOn')) || 0) },
    supportEmail: clean(formData.get('supportEmail')).toLowerCase() || null,
    timezone: clean(formData.get('timezone')) || 'America/New_York',
    website: clean(formData.get('website')) || null,
  } });
  await writeOrganizationAudit(actor.id, id, active ? OrganizationAuditAction.ORGANIZATION_ENABLED : OrganizationAuditAction.ORGANIZATION_DISABLED, { accountStatus });
  revalidatePath(`/platform/organizations/${id}`);
}

async function saveFeatures(formData: FormData) {
  'use server';
  const actor = await requirePlatformAdmin();
  const id = clean(formData.get('organizationId'));
  let enabled: string[];
  try { enabled = assertFeatureDependencies(formData.getAll('features').map(String)); } catch { redirect(`/platform/organizations/${id}?status=feature-dependency`); }
  await prisma.$transaction(FEATURE_KEYS.map((featureKey) => prisma.organizationFeature.upsert({ where: { organizationId_featureKey: { organizationId: id, featureKey } }, create: { organizationId: id, featureKey, enabled: enabled.includes(featureKey), source: 'platform-admin' }, update: { enabled: enabled.includes(featureKey), source: 'platform-admin' } })));
  await writeOrganizationAudit(actor.id, id, OrganizationAuditAction.FEATURE_CHANGED, { enabled });
  revalidatePath(`/platform/organizations/${id}`);
}

async function addVendor(formData: FormData) {
  'use server';
  const actor = await requirePlatformAdmin();
  const organizationId = clean(formData.get('organizationId'));
  const vendorId = clean(formData.get('vendorId')).toUpperCase();
  if (!/^[A-Z0-9-]{3,32}$/.test(vendorId)) redirect(`/platform/organizations/${organizationId}?status=invalid-vendor`);
  await prisma.organizationVendorIdentifier.upsert({ where: { organizationId_market_vendorId: { organizationId, market: 'OH', vendorId } }, create: { organizationId, market: 'OH', vendorId, label: clean(formData.get('label')) || null }, update: { active: true, label: clean(formData.get('label')) || null } });
  const discovery = await discoverOrganizationProducts({ organizationId });
  await writeOrganizationAudit(actor.id, organizationId, OrganizationAuditAction.VENDOR_IDENTIFIER_ADDED, { discoveredProducts: discovery.created, vendorId });
  revalidatePath(`/platform/organizations/${organizationId}`);
}

async function refreshProductCandidates(formData: FormData) {
  'use server';
  const actor = await requirePlatformAdmin();
  const organizationId = clean(formData.get('organizationId'));
  const discovery = await discoverOrganizationProducts({ organizationId });
  await writeOrganizationAudit(actor.id, organizationId, OrganizationAuditAction.PRODUCT_CONFIGURATION_CHANGED, { catalogRefresh: true, discoveredProducts: discovery.created, inferredVendorNames: discovery.inferredVendorNames });
  revalidatePath(`/platform/organizations/${organizationId}`);
  redirect(`/platform/organizations/${organizationId}?status=${discovery.created ? `products-discovered-${discovery.created}` : 'no-new-products'}`);
}

async function setProductStatus(formData: FormData) {
  'use server';
  const actor = await requirePlatformAdmin();
  const organizationId = clean(formData.get('organizationId'));
  const productId = clean(formData.get('productId'));
  const status = clean(formData.get('status')) as OrganizationProductStatus;
  if (!Object.values(OrganizationProductStatus).includes(status)) redirect(`/platform/organizations/${organizationId}?status=invalid-product-status`);
  const result = await prisma.organizationProduct.updateMany({ where: { id: productId, organizationId }, data: { status } });
  if (result.count !== 1) redirect(`/platform/organizations/${organizationId}?status=product-not-found`);
  const pending = await prisma.organizationProduct.count({ where: { organizationId, status: OrganizationProductStatus.PENDING_REVIEW } });
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { onboardingData: true } });
  const onboarding = organization?.onboardingData && typeof organization.onboardingData === 'object' && !Array.isArray(organization.onboardingData) ? organization.onboardingData as Record<string, unknown> : {};
  await prisma.organization.update({ where: { id: organizationId }, data: { onboardingData: { ...onboarding, productsConfirmed: pending === 0 } } });
  await writeOrganizationAudit(actor.id, organizationId, OrganizationAuditAction.PRODUCT_CONFIGURATION_CHANGED, { productId, status });
  revalidatePath(`/platform/organizations/${organizationId}`);
  redirect(`/platform/organizations/${organizationId}?status=product-${status.toLowerCase()}`);
}

async function setPendingProductStatus(formData: FormData) {
  'use server';
  const actor = await requirePlatformAdmin();
  const organizationId = clean(formData.get('organizationId'));
  const status = clean(formData.get('status')) as OrganizationProductStatus;
  if (status !== OrganizationProductStatus.OWNED && status !== OrganizationProductStatus.EXCLUDED && status !== OrganizationProductStatus.REPRESENTED) redirect(`/platform/organizations/${organizationId}?status=invalid-product-status`);
  const result = await prisma.organizationProduct.updateMany({ where: { organizationId, status: OrganizationProductStatus.PENDING_REVIEW }, data: { status } });
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { onboardingData: true } });
  const onboarding = organization?.onboardingData && typeof organization.onboardingData === 'object' && !Array.isArray(organization.onboardingData) ? organization.onboardingData as Record<string, unknown> : {};
  await prisma.organization.update({ where: { id: organizationId }, data: { onboardingData: { ...onboarding, productsConfirmed: true } } });
  await writeOrganizationAudit(actor.id, organizationId, OrganizationAuditAction.PRODUCT_CONFIGURATION_CHANGED, { bulkStatus: status, count: result.count });
  revalidatePath(`/platform/organizations/${organizationId}`);
  redirect(`/platform/organizations/${organizationId}?status=pending-products-${status.toLowerCase()}-${result.count}`);
}

export default async function OrganizationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ status?: string }> }) {
  await requirePlatformAdmin();
  const { id } = await params;
  const status = (await searchParams)?.status;
  const organization = await prisma.organization.findUnique({ where: { id }, include: { vendorIdentifiers: { orderBy: { vendorId: 'asc' } }, products: { orderBy: [{ status: 'asc' }, { externalItemCode: 'asc' }], take: 1000 }, features: true, auditEvents: { orderBy: { occurredAt: 'desc' }, take: 20 }, provisioningRuns: { orderBy: { createdAt: 'desc' }, take: 1, include: { steps: { orderBy: { sequence: 'asc' } } } } } });
  if (!organization) notFound();
  const users = await prisma.user.findMany({ where: { organizationId: id }, orderBy: [{ role: 'asc' }, { name: 'asc' }] });
  const enabled = new Set(organization.features.filter((feature) => feature.enabled).map((feature) => feature.featureKey));
  const onboarding = organization.onboardingData && typeof organization.onboardingData === 'object' && !Array.isArray(organization.onboardingData) ? organization.onboardingData as Record<string, unknown> : {};
  const checks = [['Organization created', true], ['Initial admin created', users.some((user) => user.role === 'ADMIN' || user.role === 'PLATFORM_ADMIN')], ['Ohio Vendor ID present', organization.vendorIdentifiers.some((vendor) => vendor.active)], ['Products discovered', organization.products.length > 0], ['Product ownership confirmed', Boolean(onboarding.productsConfirmed)], ['Feature entitlements configured', organization.features.length > 0], ['First login completed', Boolean(onboarding.firstLogin)]] as const;
  const progress = Math.round(checks.filter(([, complete]) => complete).length / checks.length * 100);
  const latestRun = organization.provisioningRuns[0];
  const settings = organization.settings && typeof organization.settings === 'object' && !Array.isArray(organization.settings) ? organization.settings as Record<string, unknown> : {};
  return <>
    <PageHeader eyebrow="Platform organization" title={organization.displayName} description={`${organization.primaryState} · ${organization.slug}`} actions={<><form action={`/platform/support-view/${organization.id}`} method="post"><button type="submit">Support view</button></form><Link className="btn secondary" href="/platform/organizations">All organizations</Link></>} />
    {status ? <p className="notice">{status.replaceAll('-', ' ')}</p> : null}
    <section className="platform-grid">
      <form action={updateOrganization} className="card"><input name="organizationId" type="hidden" value={id} /><div className="section-heading"><div><span className="page-eyebrow">Account</span><h2>Organization settings</h2></div></div><div className="form-grid"><label>Legal name<input defaultValue={organization.name} name="name" required /></label><label>Display name<input defaultValue={organization.displayName} name="displayName" required /></label><label>Timezone<input defaultValue={organization.timezone} name="timezone" required /></label><label>Website<input defaultValue={organization.website ?? ''} name="website" type="url" /></label><label>Customer contact<input defaultValue={organization.contactName ?? ''} name="contactName" /></label><label>Contact email<input defaultValue={organization.contactEmail ?? ''} name="contactEmail" type="email" /></label><label>Contact phone<input defaultValue={organization.contactPhone ?? ''} name="contactPhone" type="tel" /></label><label>Support email<input defaultValue={organization.supportEmail ?? ''} name="supportEmail" type="email" /></label><label>Application name<input defaultValue={organization.appName} name="appName" /></label><label>Digest name<input defaultValue={organization.digestName} name="digestName" /></label><label>Product label<input defaultValue={organization.productLabel} name="productLabel" /></label><label>Product plural label<input defaultValue={organization.productPluralLabel} name="productPluralLabel" /></label><label>Primary color<input defaultValue={organization.brandPrimaryColor} name="brandPrimaryColor" pattern="#[0-9A-Fa-f]{6}" /></label><label>Accent color<input defaultValue={organization.brandAccentColor} name="brandAccentColor" pattern="#[0-9A-Fa-f]{6}" /></label><label>Locale<input defaultValue={String(settings.locale ?? 'en-US')} name="locale" /></label><label>Week starts on<select defaultValue={String(settings.weekStartsOn ?? 0)} name="weekStartsOn"><option value="0">Sunday</option><option value="1">Monday</option></select></label><label>Account status<select defaultValue={organization.accountStatus} name="accountStatus">{Object.values(OrganizationStatus).map((value) => <option key={value}>{value}</option>)}</select></label><label className="checkbox-label"><input defaultChecked={organization.active} name="active" type="checkbox" /> Organization enabled</label></div><label>Platform notes<textarea defaultValue={organization.notes ?? ''} name="notes" rows={3} /></label><button type="submit">Save organization</button></form>
      <article className="card"><div className="section-heading"><div><span className="page-eyebrow">Onboarding</span><h2>{progress}% complete</h2></div><span className="pill">{organization.onboardingStatus}</span></div><div className="onboarding-progress"><span style={{ width: `${progress}%` }} /></div><ul className="checklist">{checks.map(([label, complete]) => <li className={complete ? 'complete' : ''} key={label}>{complete ? '✓' : '○'} {label}</li>)}</ul></article>
    </section>
    {latestRun ? <article className="card"><div className="section-heading"><div><span className="page-eyebrow">Provisioning workflow</span><h2>{latestRun.status.replaceAll('_', ' ')}</h2><p className="muted">Persisted, retryable steps make onboarding safe to resume after configuration changes or failures.</p></div><form action={runProvisioningAction}><input name="organizationId" type="hidden" value={id} /><input name="runId" type="hidden" value={latestRun.id} /><button type="submit">Run or resume provisioning</button></form></div>{latestRun.lastError ? <p className="notice danger">{latestRun.lastError}</p> : null}<div className="provisioning-step-grid">{latestRun.steps.map((step) => <div className="provisioning-step" key={step.id}><span>{step.sequence + 1}</span><div><strong>{step.kind.replaceAll('_', ' ')}</strong><small>{step.status.replaceAll('_', ' ')}{step.lastError ? ` · ${step.lastError}` : ''}</small></div></div>)}</div><InvitationControls organizationId={id} /></article> : <article className="card"><span className="page-eyebrow">Provisioning workflow</span><h2>Not started</h2><p className="muted">Create a persisted workflow for this existing organization, discover its products, and continue through activation.</p><form action={startProvisioningAction}><input name="organizationId" type="hidden" value={id} /><button type="submit">Start provisioning workflow</button></form></article>}
    <form action={saveFeatures} className="card"><input name="organizationId" type="hidden" value={id} /><div className="section-heading"><div><span className="page-eyebrow">Product access</span><h2>Feature entitlements</h2></div><button type="submit">Save features</button></div><div className="entitlement-grid">{Object.values(FEATURE_REGISTRY).map((feature) => <label className="entitlement-option" key={feature.key}><input defaultChecked={enabled.has(feature.key)} name="features" type="checkbox" value={feature.key} /><span><strong>{feature.label}</strong><small>{feature.description}</small>{feature.dependencies.length ? <small>Requires: {feature.dependencies.map((key) => FEATURE_REGISTRY[key].label).join(', ')}</small> : null}</span></label>)}</div></form>
    <section className="platform-grid"><article className="card"><div className="section-heading"><div><span className="page-eyebrow">Ohio market</span><h2>Vendor IDs</h2></div></div><div className="platform-list">{organization.vendorIdentifiers.map((vendor) => <div key={vendor.id}><span><strong>{vendor.vendorId}</strong><small>{vendor.label || 'Ohio Vendor ID'}</small></span><span className="pill">{vendor.active ? 'Active' : 'Inactive'}</span></div>)}</div><form action={addVendor} className="inline-form"><input name="organizationId" type="hidden" value={id} /><label>Vendor ID<input name="vendorId" required /></label><label>Label<input name="label" /></label><button type="submit">Add and discover</button></form></article>
      <article className="card"><div className="section-heading"><div><span className="page-eyebrow">People</span><h2>Organization users</h2></div></div><div className="platform-list">{users.map((user) => <div key={user.id}><span><strong>{getUserDisplayName(user)}</strong><small>{user.email}</small></span><span className="pill">{user.role}</span></div>)}</div></article></section>
    <article className="card"><div className="section-heading"><div><span className="page-eyebrow">Catalog configuration</span><h2>Discovered products</h2><p className="muted">Shared OHLQ product facts with a private, organization-specific ownership decision. Brand Master imports automatically add new matching items as pending review.</p></div><div className="inline-actions"><span className="pill">{organization.products.length}</span><form action={refreshProductCandidates}><input name="organizationId" type="hidden" value={id} /><button className="compact-btn secondary" type="submit">Scan Brand Master</button></form><form action={setPendingProductStatus}><input name="organizationId" type="hidden" value={id} /><input name="status" type="hidden" value={OrganizationProductStatus.OWNED} /><button className="compact-btn secondary" type="submit">Confirm all pending</button></form><form action={setPendingProductStatus}><input name="organizationId" type="hidden" value={id} /><input name="status" type="hidden" value={OrganizationProductStatus.EXCLUDED} /><button className="compact-btn secondary" type="submit">Exclude all pending</button></form></div></div><div className="table-wrap"><table><thead><tr><th>Item</th><th>Name</th><th>Decision</th></tr></thead><tbody>{organization.products.map((product) => <tr key={product.id}><td>{product.externalItemCode}</td><td>{product.displayName || 'Name pending'}</td><td><form action={setProductStatus} className="inline-control-form"><input name="organizationId" type="hidden" value={id} /><input name="productId" type="hidden" value={product.id} /><select defaultValue={product.status} name="status">{Object.values(OrganizationProductStatus).map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select><button type="submit">Save</button></form></td></tr>)}</tbody></table></div></article>
    <article className="card"><div className="section-heading"><div><span className="page-eyebrow">Auditability</span><h2>Recent platform activity</h2></div></div><div className="platform-list">{organization.auditEvents.map((event) => <div key={event.id}><span><strong>{event.action.replaceAll('_', ' ')}</strong><small>{event.occurredAt.toLocaleString('en-US', { timeZone: 'America/New_York' })}</small></span><code>{event.actorUserId.slice(-8)}</code></div>)}</div></article>
  </>;
}
