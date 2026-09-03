import { OrganizationProductStatus, type PrismaClient } from '@prisma/client';
import { prisma } from './prisma';

export const normalizeOrganizationIdentifierList = (value: string) =>
  Array.from(
    new Set(
      value
        .split(/[\s,;]+/)
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean),
    ),
  );

export const isValidA3aStoreId = (value: string) => /^[A-Z0-9-]{1,32}$/.test(value);

export async function replaceOrganizationA3aStoreIds({
  organizationId,
  storeIds,
  db = prisma,
}: {
  organizationId: string;
  storeIds: readonly string[];
  db?: PrismaClient;
}) {
  const normalized = Array.from(new Set(storeIds.map((value) => value.trim().toUpperCase()).filter(Boolean)));
  if (normalized.some((value) => !isValidA3aStoreId(value))) throw new Error('Invalid A3A Store ID.');

  await db.$transaction(async (tx) => {
    await tx.organizationA3aStoreIdentifier.updateMany({
      where: { organizationId, market: 'OH', storeId: { notIn: normalized } },
      data: { active: false },
    });

    for (const storeId of normalized) {
      await tx.organizationA3aStoreIdentifier.upsert({
        where: { organizationId_market_storeId: { organizationId, market: 'OH', storeId } },
        create: { organizationId, market: 'OH', storeId },
        update: { active: true },
      });
    }
  });

  return normalized;
}

export async function saveOrganizationProductSelection({
  includedProductIds,
  organizationId,
  db = prisma,
}: {
  includedProductIds: readonly string[];
  organizationId: string;
  db?: PrismaClient;
}) {
  const included = Array.from(new Set(includedProductIds));
  const products = await db.organizationProduct.findMany({ where: { organizationId }, select: { id: true } });
  const productIds = new Set(products.map((product) => product.id));
  if (included.some((id) => !productIds.has(id))) throw new Error('Invalid product selection.');

  const organization = await db.organization.findUnique({ where: { id: organizationId }, select: { onboardingData: true } });
  if (!organization) throw new Error('Organization not found.');
  const onboarding = organization.onboardingData && typeof organization.onboardingData === 'object' && !Array.isArray(organization.onboardingData)
    ? organization.onboardingData as Record<string, unknown>
    : {};

  await db.$transaction([
    db.organizationProduct.updateMany({ where: { organizationId, id: { in: included } }, data: { status: OrganizationProductStatus.OWNED } }),
    db.organizationProduct.updateMany({ where: { organizationId, id: { notIn: included } }, data: { status: OrganizationProductStatus.EXCLUDED } }),
    db.organization.update({ where: { id: organizationId }, data: { onboardingData: { ...onboarding, productsConfirmed: products.length > 0 } } }),
  ]);

  return { excludedCount: products.length - included.length, includedCount: included.length };
}
