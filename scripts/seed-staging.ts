import { OrganizationOnboardingStatus, OrganizationStatus, UserRole, WorklistCategory, WorklistSource } from '@prisma/client';
import { getAppEnvironment, logEnvironmentEvent, validateRuntimeEnvironment } from '../lib/appEnvironment';
import { hashPassword } from '../lib/password';
import { prisma } from '../lib/prisma';

async function main() {
  validateRuntimeEnvironment();
  if (getAppEnvironment() !== 'test') throw new Error('The staging seed is allowed only when APP_ENV=test.');
  const password = process.env.STAGING_ADMIN_PASSWORD?.trim();
  if (!password || password.length < 12) throw new Error('Set STAGING_ADMIN_PASSWORD to at least 12 characters.');
  const email = process.env.STAGING_ADMIN_EMAIL?.trim().toLowerCase() || 'admin@example.test';

  const organization = await prisma.organization.upsert({
    where: { slug: 'neat-staging' },
    create: { id: 'org_neat_staging', name: 'Neat Staging', displayName: 'Neat Staging', slug: 'neat-staging', accountStatus: OrganizationStatus.ACTIVE, onboardingStatus: OrganizationOnboardingStatus.READY },
    update: { active: true, displayName: 'Neat Staging' },
  });
  const admin = await prisma.user.upsert({
    where: { email },
    create: { organizationId: organization.id, email, firstName: 'Staging', lastName: 'Admin', passwordHash: hashPassword(password), role: UserRole.ADMIN },
    update: { organizationId: organization.id, passwordHash: hashPassword(password), role: UserRole.ADMIN, isActive: true },
  });
  const agency = await prisma.agency.upsert({
    where: { agencyId: 'TEST-AGENCY-001' },
    create: { agencyId: 'TEST-AGENCY-001', name: 'Synthetic Test Agency', address: '100 Test Market Street', city: 'Columbus', state: 'OH', zip: '43215' },
    update: { name: 'Synthetic Test Agency' },
  });
  const wholesale = await prisma.wholesaleAccount.upsert({
    where: { licenseeId: 'TEST-WHOLESALE-001' },
    create: { licenseeId: 'TEST-WHOLESALE-001', name: 'Synthetic Test Restaurant', address: '200 Sandbox Avenue', city: 'Columbus', state: 'OH', zip: '43215' },
    update: { isActive: true, name: 'Synthetic Test Restaurant' },
  });
  await prisma.worklistItem.upsert({
    where: { submissionKey: 'staging-seed-follow-up' },
    create: { organizationId: organization.id, submissionKey: 'staging-seed-follow-up', title: 'Synthetic staging follow-up', detail: 'Safe sample task; no production data.', category: WorklistCategory.GENERAL, source: WorklistSource.MANUAL, agencyId: agency.id, assignedToUserId: admin.id, createdByUserId: admin.id },
    update: { organizationId: organization.id, agencyId: agency.id, wholesaleAccountId: null, assignedToUserId: admin.id, createdByUserId: admin.id },
  });

  logEnvironmentEvent('database.staging-seed.completed', { agencyId: agency.agencyId, adminEmail: email, organizationId: organization.id, wholesaleLicenseeId: wholesale.licenseeId });
}

main().finally(() => prisma.$disconnect());
