export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { OrganizationAuditAction, UserRole } from '@prisma/client';
import { redirect } from 'next/navigation';
import { buildPageMetadata } from '../../../../lib/appBrand';
import { getUserDisplayName, requirePlatformAdmin } from '../../../../lib/auth';
import { DEFAULT_FEATURE_KEYS, FEATURE_REGISTRY } from '../../../../lib/featureRegistry';
import { assertFeatureDependencies } from '../../../../lib/organizations';
import { prisma } from '../../../../lib/prisma';
import { createUserInvitationToken, sendUserInvitationEmail } from '../../../../lib/userInvitations';
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
  let features: string[];
  try { features = assertFeatureDependencies(formData.getAll('features').map(String)); } catch { redirect('/platform/organizations/new?status=feature-dependency'); }
  if (!name || !slug || !adminFirstName || !adminLastName || !adminEmail || primaryState !== 'OH') redirect('/platform/organizations/new?status=invalid');
  const existing = await prisma.user.findUnique({ where: { email: adminEmail }, select: { id: true } });
  if (existing) redirect('/platform/organizations/new?status=email-in-use');
  const invite = createUserInvitationToken();
  const result = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({ data: { name, displayName, slug, primaryState, timezone, active: true, accountStatus: 'TRIAL', onboardingStatus: 'PROVISIONING', onboardingData: { identity: true, admin: true, ohioMarket: vendorIds.length > 0, features: features.length > 0 } } });
    await tx.organizationVendorIdentifier.createMany({ data: vendorIds.map((vendorId) => ({ organizationId: organization.id, market: primaryState, vendorId })) });
    await tx.organizationFeature.createMany({ data: features.map((featureKey) => ({ organizationId: organization.id, featureKey, enabled: true, source: 'provisioning' })) });
    const candidates = vendorIds.length ? await tx.ohlqAgencyInventoryCurrent.findMany({ where: { vendorId: { in: vendorIds } }, distinct: ['itemCode'], take: 500, orderBy: { itemCode: 'asc' }, select: { itemCode: true, itemName: true } }) : [];
    await tx.organizationProduct.createMany({ skipDuplicates: true, data: candidates.map((candidate) => ({ organizationId: organization.id, market: primaryState, externalItemCode: candidate.itemCode, displayName: candidate.itemName, status: 'OWNED', active: true })) });
    const user = await tx.user.create({ data: { organizationId: organization.id, email: adminEmail, firstName: adminFirstName, lastName: adminLastName, name: `${adminFirstName} ${adminLastName}`, role: UserRole.ADMIN, isActive: false } });
    const invitation = await tx.userInvitation.create({ data: { userId: user.id, tokenHash: invite.tokenHash, expiresAt: invite.expiresAt } });
    await tx.organization.update({ where: { id: organization.id }, data: { onboardingStatus: candidates.length || !vendorIds.length ? 'READY' : 'NEEDS_ATTENTION', onboardingData: { identity: true, admin: true, ohioMarket: vendorIds.length > 0, productsDiscovered: candidates.length, productsConfirmed: candidates.length > 0, features: true, firstLogin: false } } });
    await tx.organizationAuditEvent.createMany({ data: [{ organizationId: organization.id, actorUserId: actor.id, action: OrganizationAuditAction.ORGANIZATION_CREATED }, { organizationId: organization.id, actorUserId: actor.id, action: OrganizationAuditAction.INITIAL_ADMIN_CREATED, metadata: { userId: user.id } }] });
    return { organization, user, invitation };
  }).catch((error) => { if (String(error).includes('Unique constraint')) redirect('/platform/organizations/new?status=duplicate'); throw error; });
  try {
    const sent = await sendUserInvitationEmail({ invitationId: result.invitation.id, organizationName: result.organization.displayName, recipientEmail: result.user.email, recipientName: getUserDisplayName(result.user), token: invite.token });
    await prisma.userInvitation.update({ where: { id: result.invitation.id }, data: { providerMessageId: sent.providerMessageId } });
  } catch (error) { console.error('[platform/provision] invitation delivery failed', { organizationId: result.organization.id, message: error instanceof Error ? error.message : String(error) }); }
  redirect(`/platform/organizations/${result.organization.id}?status=provisioned`);
}

export default async function NewOrganizationPage({ searchParams }: { searchParams?: Promise<{ status?: string }> }) {
  await requirePlatformAdmin();
  const status = (await searchParams)?.status;
  return <>
    <PageHeader eyebrow="Provisioning" title="New organization" description="Create the company, discover its Ohio products, enable modules, and invite its first administrator." />
    {status ? <p className="notice danger">Provisioning could not continue: {status.replaceAll('-', ' ')}.</p> : null}
    <form action={provisionOrganization} className="platform-provisioning">
      <fieldset className="card"><legend>1. Organization identity</legend><div className="form-grid"><label>Company name<input name="name" required /></label><label>Display name<input name="displayName" /></label><label>Slug<input name="slug" placeholder="auto-generated when blank" /></label><label>Market<select name="primaryState" defaultValue="OH"><option value="OH">Ohio</option></select></label><label>Timezone<input name="timezone" defaultValue="America/New_York" required /></label></div></fieldset>
      <fieldset className="card"><legend>2. Initial organization admin</legend><div className="form-grid"><label>First name<input name="adminFirstName" required /></label><label>Last name<input name="adminLastName" required /></label><label>Email<input name="adminEmail" type="email" required /></label></div><p className="muted">Neat uses the existing secure, single-use invitation flow; no password is handled here.</p></fieldset>
      <fieldset className="card"><legend>3–4. Ohio data and product discovery</legend><label>Ohio Vendor IDs<textarea name="vendorIds" placeholder="One or more IDs, separated by commas or new lines" rows={3} /></label><p className="muted">Matching item codes will be discovered from current shared OHLQ inventory and initialized as owned. They can be confirmed or excluded on the organization page.</p></fieldset>
      <fieldset className="card"><legend>5. Feature entitlements</legend><div className="entitlement-grid">{Object.values(FEATURE_REGISTRY).map((feature) => <label className="entitlement-option" key={feature.key}><input defaultChecked={DEFAULT_FEATURE_KEYS.includes(feature.key)} name="features" type="checkbox" value={feature.key} /><span><strong>{feature.label}</strong><small>{feature.description}</small>{feature.dependencies.length ? <small>Requires: {feature.dependencies.map((key) => FEATURE_REGISTRY[key].label).join(', ')}</small> : null}</span></label>)}</div></fieldset>
      <section className="card provisioning-review"><div><span className="page-eyebrow">6. Review and provision</span><h2>Create organization</h2><p className="muted">This creates tenant configuration, discovers products, applies entitlements, records audit events, and sends the initial admin invitation.</p></div><button type="submit">Provision organization</button></section>
    </form>
  </>;
}
