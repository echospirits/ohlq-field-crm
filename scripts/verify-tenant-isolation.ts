import { randomUUID } from 'node:crypto';
import { WorklistCategory, WorklistSource } from '@prisma/client';
import { getAppEnvironment, validateRuntimeEnvironment } from '../lib/appEnvironment';
import { prisma } from '../lib/prisma';

async function main() {
  validateRuntimeEnvironment();
  if (getAppEnvironment() !== 'test') throw new Error('Tenant isolation verification is test-only.');

  const suffix = randomUUID();
  const organizationIds = [`isolation-a-${suffix}`, `isolation-b-${suffix}`];
  try {
    await prisma.organization.createMany({
      data: organizationIds.map((id, index) => ({
        id,
        displayName: `Isolation ${index + 1}`,
        name: `Synthetic isolation tenant ${index + 1}`,
        slug: id,
      })),
    });
    await Promise.all(organizationIds.map((organizationId) => prisma.tag.create({
      data: { organizationId, name: 'Same private tag' },
    })));
    const workItems = await Promise.all(organizationIds.map((organizationId) => prisma.worklistItem.create({
      data: {
        category: WorklistCategory.GENERAL,
        organizationId,
        source: WorklistSource.MANUAL,
        submissionKey: 'same-private-submission-key',
        title: 'Synthetic tenant-isolation check',
      },
    })));

    const [firstTags, secondTags, crossTenantWorkItem] = await Promise.all([
      prisma.tag.count({ where: { organizationId: organizationIds[0], name: 'Same private tag' } }),
      prisma.tag.count({ where: { organizationId: organizationIds[1], name: 'Same private tag' } }),
      prisma.worklistItem.findFirst({
        where: { id: workItems[1].id, organizationId: organizationIds[0] },
        select: { id: true },
      }),
    ]);
    if (firstTags !== 1 || secondTags !== 1 || crossTenantWorkItem) {
      throw new Error('Tenant isolation verification failed.');
    }
    console.log('Tenant isolation verified with duplicate tenant-local keys and scoped reads.');
  } finally {
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
