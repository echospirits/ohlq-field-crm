import { UserRole } from '@prisma/client';
import { ensureEchoOrganization } from '../lib/organizations';
import { prisma } from '../lib/prisma';

async function main() {
  await ensureEchoOrganization();
  let platformAdmin = await prisma.user.findFirst({ where: { role: UserRole.PLATFORM_ADMIN }, orderBy: { createdAt: 'asc' } });
  if (!platformAdmin) {
    const configuredEmail = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
    const candidate = configuredEmail
      ? await prisma.user.findUnique({ where: { email: configuredEmail } })
      : await prisma.user.findFirst({ where: { role: UserRole.ADMIN, isActive: true }, orderBy: { createdAt: 'asc' } });
    if (!candidate) throw new Error('No active administrator exists to initialize PLATFORM_ADMIN. Set PLATFORM_ADMIN_EMAIL after creating an admin.');
    platformAdmin = await prisma.user.update({ where: { id: candidate.id }, data: { role: UserRole.PLATFORM_ADMIN } });
  }
  const counts = await Promise.all([
    prisma.organization.count(), prisma.organizationFeature.count(), prisma.organizationVendorIdentifier.count(), prisma.organizationProduct.count(), prisma.user.count({ where: { organizationId: 'org_echo_spirits' } }),
  ]);
  console.log(JSON.stringify({ organizationCount: counts[0], featureCount: counts[1], vendorIdentifierCount: counts[2], productConfigurationCount: counts[3], echoUserCount: counts[4], platformAdminEmail: platformAdmin.email }, null, 2));
}

main().finally(() => prisma.$disconnect());
