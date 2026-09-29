import type { PrismaClient, WorklistCategory } from '@prisma/client';
import { readBusinessHours } from './accountResearchQueue';
import { readOperatingHoursSchedule, type OperatingHoursEntry } from './operatingHours';
import { prisma } from './prisma';

type WorklistLocationReferenceItem = {
  category: WorklistCategory;
  agencyId: string | null;
  wholesaleAccountId: string | null;
  loggedVisit: {
    locationType: string;
    agencyId: string | null;
    wholesaleAccountId: string | null;
  } | null;
};

type WorklistLocationItem = WorklistLocationReferenceItem & {
  id: string;
  title: string;
};

export type WorklistLocationReference = {
  id: string;
  type: 'agency' | 'wholesale';
};

export type WorklistLocation = WorklistLocationReference & {
  href: string;
  name: string;
  businessHours: OperatingHoursEntry[] | null;
};

export function getWorklistCategoryForLocationSelection(
  requestedCategory: WorklistCategory,
  agencyId: string | null,
  wholesaleAccountId: string | null,
): WorklistCategory {
  if (requestedCategory !== 'GENERAL') {
    return requestedCategory;
  }

  if (agencyId && !wholesaleAccountId) {
    return 'AGENCY';
  }

  if (wholesaleAccountId && !agencyId) {
    return 'WHOLESALE';
  }

  return requestedCategory;
}

export function getWorklistLocationReference(
  item: WorklistLocationReferenceItem,
): WorklistLocationReference | null {
  if (item.category === 'AGENCY' && item.agencyId) {
    return { id: item.agencyId, type: 'agency' };
  }

  if (item.category === 'WHOLESALE' && item.wholesaleAccountId) {
    return { id: item.wholesaleAccountId, type: 'wholesale' };
  }

  if (item.agencyId) {
    return { id: item.agencyId, type: 'agency' };
  }

  if (item.wholesaleAccountId) {
    return { id: item.wholesaleAccountId, type: 'wholesale' };
  }

  if (item.loggedVisit?.locationType === 'agency' && item.loggedVisit.agencyId) {
    return { id: item.loggedVisit.agencyId, type: 'agency' };
  }

  if (item.loggedVisit?.locationType === 'wholesale' && item.loggedVisit.wholesaleAccountId) {
    return { id: item.loggedVisit.wholesaleAccountId, type: 'wholesale' };
  }

  if (item.loggedVisit?.agencyId) {
    return { id: item.loggedVisit.agencyId, type: 'agency' };
  }

  if (item.loggedVisit?.wholesaleAccountId) {
    return { id: item.loggedVisit.wholesaleAccountId, type: 'wholesale' };
  }

  return null;
}

export function getWorklistLocationFallbackLabel(
  item: WorklistLocationReferenceItem & { title: string },
): string {
  if (getWorklistLocationReference(item)) {
    return 'Location unavailable';
  }

  if (item.category === 'GENERAL' && item.title.trim()) {
    return item.title.trim();
  }

  return 'No location';
}

export async function getWorklistLocations(
  items: WorklistLocationItem[],
  db: PrismaClient = prisma,
): Promise<Map<string, WorklistLocation>> {
  const references = new Map(
    items.map((item) => [item.id, getWorklistLocationReference(item)] as const),
  );
  const agencyIds = Array.from(
    new Set(
      Array.from(references.values())
        .filter((reference) => reference?.type === 'agency')
        .map((reference) => reference!.id),
    ),
  );
  const wholesaleAccountIds = Array.from(
    new Set(
      Array.from(references.values())
        .filter((reference) => reference?.type === 'wholesale')
        .map((reference) => reference!.id),
    ),
  );

  const [agencies, wholesaleAccounts] = await Promise.all([
    agencyIds.length
      ? db.agency.findMany({
          where: {
            OR: [{ id: { in: agencyIds } }, { agencyId: { in: agencyIds } }],
          },
          select: { id: true, agencyId: true, name: true, businessHours: true },
        })
      : [],
    wholesaleAccountIds.length
      ? db.wholesaleAccount.findMany({
          where: { id: { in: wholesaleAccountIds } },
          select: { id: true, name: true, targetPublicResearch: { select: { identitySnapshot: true } } },
        })
      : [],
  ]);

  const agencyByReference = new Map(
    agencies.flatMap((agency) => [
      [agency.id, agency] as const,
      [agency.agencyId, agency] as const,
    ]),
  );
  const wholesaleById = new Map(wholesaleAccounts.map((account) => [account.id, account] as const));
  const locations = new Map<string, WorklistLocation>();

  references.forEach((reference, itemId) => {
    if (!reference) return;

    if (reference.type === 'agency') {
      const agency = agencyByReference.get(reference.id);
      if (agency) {
        locations.set(itemId, {
          id: agency.id,
          type: 'agency',
          href: `/agencies/${agency.id}`,
          name: agency.name,
          businessHours: readOperatingHoursSchedule(agency.businessHours),
        });
      }
      return;
    }

    const account = wholesaleById.get(reference.id);
    if (account) {
      locations.set(itemId, {
        id: account.id,
        type: 'wholesale',
        href: `/wholesale/${account.id}`,
        name: account.name,
        businessHours: readOperatingHoursSchedule(readBusinessHours(account.targetPublicResearch?.identitySnapshot)?.schedule),
      });
    }
  });

  return locations;
}
