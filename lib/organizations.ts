import { OrganizationAuditAction, OrganizationProductStatus, OrganizationStatus, Prisma, UserRole } from '@prisma/client';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ECHO_FEATURE_KEYS, FEATURE_KEYS, type FeatureKey, validateFeatureSelection } from './featureRegistry';
import { prisma } from './prisma';
import { DEFAULT_TENANT_ENTITY_NAME, DEFAULT_TENANT_EXCLUDED_ITEM_CODES, DEFAULT_TENANT_OHLQ_VENDOR_IDS } from './tenantConfig';

export const ECHO_ORGANIZATION_ID = 'org_echo_spirits';
export const SUPPORT_VIEW_COOKIE = 'neat_support_organization';

let echoBootstrap: Promise<void> | null = null;

export function ensureEchoOrganization() {
  echoBootstrap ??= (async () => {
    await prisma.organization.upsert({
      where: { id: ECHO_ORGANIZATION_ID },
      create: { id: ECHO_ORGANIZATION_ID, name: DEFAULT_TENANT_ENTITY_NAME, displayName: 'Echo Spirits', slug: 'echo-spirits', active: true, primaryState: 'OH', timezone: 'America/New_York', accountStatus: OrganizationStatus.ACTIVE, onboardingStatus: 'READY', onboardingData: { migrated: true } },
      update: {},
    });
    await prisma.organizationVendorIdentifier.createMany({ skipDuplicates: true, data: DEFAULT_TENANT_OHLQ_VENDOR_IDS.map((vendorId) => ({ organizationId: ECHO_ORGANIZATION_ID, market: 'OH', vendorId, label: 'Echo Spirits' })) });
    await prisma.organizationFeature.createMany({ skipDuplicates: true, data: ECHO_FEATURE_KEYS.map((featureKey) => ({ organizationId: ECHO_ORGANIZATION_ID, featureKey, enabled: true, source: 'migration' })) });
    await prisma.organizationProduct.createMany({ skipDuplicates: true, data: DEFAULT_TENANT_EXCLUDED_ITEM_CODES.map((externalItemCode) => ({ organizationId: ECHO_ORGANIZATION_ID, market: 'OH', externalItemCode, status: OrganizationProductStatus.EXCLUDED, active: true, notes: 'Migrated from the legacy Echo exclusion list.' })) });
    const echoProducts = await prisma.ohlqAgencyInventoryCurrent.findMany({ where: { vendorId: { in: [...DEFAULT_TENANT_OHLQ_VENDOR_IDS] }, itemCode: { notIn: [...DEFAULT_TENANT_EXCLUDED_ITEM_CODES] } }, distinct: ['itemCode'], orderBy: { itemCode: 'asc' }, select: { itemCode: true, itemName: true } });
    await prisma.organizationProduct.createMany({ skipDuplicates: true, data: echoProducts.map((product) => ({ organizationId: ECHO_ORGANIZATION_ID, market: 'OH', externalItemCode: product.itemCode, displayName: product.itemName, status: OrganizationProductStatus.OWNED, active: true, notes: 'Discovered from the migrated Echo Vendor ID.' })) });
    await Promise.all([
      prisma.user.updateMany({ where: { organizationId: null, role: { not: UserRole.PLATFORM_ADMIN } }, data: { organizationId: ECHO_ORGANIZATION_ID } }),
      prisma.weeklyDigestLog.updateMany({ where: { organizationId: null }, data: { organizationId: ECHO_ORGANIZATION_ID } }),
      prisma.tag.updateMany({ where: { organizationId: null }, data: { organizationId: ECHO_ORGANIZATION_ID } }),
      prisma.menuPlacement.updateMany({ where: { organizationId: null }, data: { organizationId: ECHO_ORGANIZATION_ID } }),
      prisma.recipe.updateMany({ where: { organizationId: null }, data: { organizationId: ECHO_ORGANIZATION_ID } }),
      prisma.recipeSuggestion.updateMany({ where: { organizationId: null }, data: { organizationId: ECHO_ORGANIZATION_ID } }),
      prisma.targetAccountProfile.updateMany({ where: { organizationId: null }, data: { organizationId: ECHO_ORGANIZATION_ID } }),
      prisma.locationTag.updateMany({ where: { organizationId: null }, data: { organizationId: ECHO_ORGANIZATION_ID } }),
      prisma.locationContact.updateMany({ where: { organizationId: null }, data: { organizationId: ECHO_ORGANIZATION_ID } }),
      prisma.loggedVisit.updateMany({ where: { organizationId: null }, data: { organizationId: ECHO_ORGANIZATION_ID } }),
      prisma.visitPhoto.updateMany({ where: { organizationId: null }, data: { organizationId: ECHO_ORGANIZATION_ID } }),
      prisma.worklistItem.updateMany({ where: { organizationId: null }, data: { organizationId: ECHO_ORGANIZATION_ID } }),
      prisma.salesOpportunity.updateMany({ where: { organizationId: null }, data: { organizationId: ECHO_ORGANIZATION_ID } }),
      prisma.opportunityEvent.updateMany({ where: { organizationId: null }, data: { organizationId: ECHO_ORGANIZATION_ID } }),
      prisma.accountSalesEvent.updateMany({ where: { organizationId: null }, data: { organizationId: ECHO_ORGANIZATION_ID } }),
      prisma.opportunityAccountSignal.updateMany({ where: { organizationId: null }, data: { organizationId: ECHO_ORGANIZATION_ID } }),
      prisma.agencyProductIntelligence.updateMany({ where: { organizationId: null }, data: { organizationId: ECHO_ORGANIZATION_ID } }),
      prisma.agencyIntelligenceSummary.updateMany({ where: { organizationId: null }, data: { organizationId: ECHO_ORGANIZATION_ID } }),
      prisma.agencyIntelligenceEvent.updateMany({ where: { organizationId: null }, data: { organizationId: ECHO_ORGANIZATION_ID } }),
    ]);
  })().catch((error) => { echoBootstrap = null; throw error; });
  return echoBootstrap;
}

export async function getOrganizationContext(user: { id: string; organizationId: string | null; role: UserRole }) {
  await ensureEchoOrganization();
  const supportOrganizationId = user.role === UserRole.PLATFORM_ADMIN ? (await cookies()).get(SUPPORT_VIEW_COOKIE)?.value : null;
  const organizationId = supportOrganizationId || user.organizationId;
  if (!organizationId) return null;
  const organization = await prisma.organization.findFirst({ where: { id: organizationId, ...(user.role === UserRole.PLATFORM_ADMIN ? {} : { active: true, accountStatus: { notIn: [OrganizationStatus.SUSPENDED, OrganizationStatus.CANCELLED] } }) } });
  return organization ? { organization, isSupportView: Boolean(supportOrganizationId), organizationId: organization.id } : null;
}

export async function requireOrganizationContext(user: { id: string; organizationId: string | null; role: UserRole }) {
  const context = await getOrganizationContext(user);
  if (!context) {
    if (user.role === UserRole.PLATFORM_ADMIN) redirect('/platform');
    redirect('/login?status=organization-unavailable');
  }
  return context;
}

export async function getOrganizationFeatures(organizationId: string) {
  const rows = await prisma.organizationFeature.findMany({ where: { organizationId, enabled: true }, select: { featureKey: true } });
  return new Set(rows.map((row) => row.featureKey).filter((key): key is FeatureKey => FEATURE_KEYS.includes(key as FeatureKey)));
}

export async function hasFeature(organizationId: string, featureKey: FeatureKey) {
  return Boolean(await prisma.organizationFeature.findFirst({ where: { organizationId, featureKey, enabled: true }, select: { id: true } }));
}

export async function requireFeatureForUser(user: { id: string; organizationId: string | null; role: UserRole }, featureKey: FeatureKey) {
  const context = await requireOrganizationContext(user);
  if (!(await hasFeature(context.organizationId, featureKey))) notFound();
  return context;
}

export function assertFeatureDependencies(keys: readonly string[]) {
  const result = validateFeatureSelection(keys);
  if (result.missing.length) throw new Error(result.missing.map(({ feature, dependency }) => `${feature} requires ${dependency}`).join(', '));
  return result.enabled;
}

export async function writeOrganizationAudit(actorUserId: string, organizationId: string | null, action: OrganizationAuditAction, metadata?: Record<string, unknown>) {
  await prisma.organizationAuditEvent.create({ data: { actorUserId, organizationId, action, metadata: metadata as Prisma.InputJsonValue | undefined } });
}
