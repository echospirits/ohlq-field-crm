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

export type OrganizationA3aLocationInput = {
  active: boolean;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  dba?: string;
  email?: string;
  isDefault: boolean;
  locationId?: string;
  name: string;
  permitNumber?: string;
  phone?: string;
  postalCode: string;
  state: string;
  storeId: string;
};

const optionalText = (value: string | undefined) => value?.trim() || null;

export async function saveOrganizationA3aLocation({
  input,
  organizationId,
  db = prisma,
}: {
  input: OrganizationA3aLocationInput;
  organizationId: string;
  db?: PrismaClient;
}) {
  const storeId = input.storeId.trim().toUpperCase();
  const state = input.state.trim().toUpperCase();
  const email = optionalText(input.email)?.toLowerCase() ?? null;
  if (!isValidA3aStoreId(storeId)) throw new Error('Invalid A3A Store ID.');
  if (!input.name.trim() || !input.addressLine1.trim() || !input.city.trim() || !input.postalCode.trim()) {
    throw new Error('A3A location name and address are required.');
  }
  if (state !== 'OH') throw new Error('Ohio A3A locations must use OH as the state.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid A3A location email.');

  return db.$transaction(async (tx) => {
    if (input.locationId) {
      const existing = await tx.organizationA3aStoreIdentifier.findFirst({
        where: { id: input.locationId, organizationId },
        select: { id: true },
      });
      if (!existing) throw new Error('A3A location not found.');
    }

    const currentDefault = await tx.organizationA3aStoreIdentifier.findFirst({
      where: { organizationId, active: true, isDefault: true },
      select: { id: true },
    });
    const isDefault = input.active && (input.isDefault || !currentDefault || currentDefault.id === input.locationId);
    if (isDefault) {
      await tx.organizationA3aStoreIdentifier.updateMany({ where: { organizationId }, data: { isDefault: false } });
    }

    const data = {
      active: input.active,
      addressLine1: input.addressLine1.trim(),
      addressLine2: optionalText(input.addressLine2),
      city: input.city.trim(),
      dba: optionalText(input.dba),
      email,
      isDefault,
      name: input.name.trim(),
      permitNumber: optionalText(input.permitNumber),
      phone: optionalText(input.phone),
      postalCode: input.postalCode.trim(),
      state,
      storeId,
    };
    const location = input.locationId
      ? await tx.organizationA3aStoreIdentifier.update({ where: { id: input.locationId }, data })
      : await tx.organizationA3aStoreIdentifier.upsert({
          where: { organizationId_market_storeId: { organizationId, market: 'OH', storeId } },
          create: { ...data, organizationId, market: 'OH' },
          update: data,
        });

    if (!location.active) {
      const remainingDefault = await tx.organizationA3aStoreIdentifier.findFirst({
        where: { organizationId, active: true, isDefault: true },
        select: { id: true },
      });
      if (!remainingDefault) {
        const fallback = await tx.organizationA3aStoreIdentifier.findFirst({
          where: { organizationId, active: true },
          orderBy: { storeId: 'asc' },
          select: { id: true },
        });
        if (fallback) await tx.organizationA3aStoreIdentifier.update({ where: { id: fallback.id }, data: { isDefault: true } });
      }
    }

    return location;
  });
}

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
