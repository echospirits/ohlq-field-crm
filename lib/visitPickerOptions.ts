import type { PrismaClient } from '@prisma/client';
import { prisma } from './prisma';

export type VisitLocationType = 'agency' | 'wholesale';

export type VisitPickerAgencyOption = {
  agencyId: string;
  city: string | null;
  county: string | null;
  id: string;
  lastVisitAt: string | null;
  name: string;
  phone: string | null;
};

export type VisitPickerWholesaleOption = {
  agencyId: string | null;
  city: string | null;
  county: string | null;
  id: string;
  lastVisitAt: string | null;
  licenseeId: string;
  name: string;
  phone: string | null;
};

type VisitPickerRouteParams = {
  agencyId?: string | null;
  type?: string | null;
  wholesaleAccountId?: string | null;
};

type SortableVisitPickerOption = {
  lastVisitAt: string | null;
  name: string;
};

const defaultTake = 750;

const toIsoString = (date: Date | null | undefined) => date?.toISOString() ?? null;

const getVisitTime = (value: string | null) => (value ? new Date(value).getTime() : Number.NEGATIVE_INFINITY);

const maxDate = (...dates: Array<Date | null | undefined>) =>
  dates.reduce<Date | null>((latest, date) => {
    if (!date) return latest;
    if (!latest || date.getTime() > latest.getTime()) return date;
    return latest;
  }, null);

export const getInitialVisitLocationType = (params: VisitPickerRouteParams = {}): VisitLocationType => {
  if (params.type === 'agency' || params.agencyId) {
    return 'agency';
  }

  return 'wholesale';
};

export function sortVisitPickerOptions<T extends SortableVisitPickerOption>(items: T[]): T[] {
  return [...items].sort(
    (left, right) =>
      getVisitTime(right.lastVisitAt) - getVisitTime(left.lastVisitAt) ||
      left.name.localeCompare(right.name) ||
      ('id' in left && 'id' in right ? String(left.id).localeCompare(String(right.id)) : 0),
  );
}

async function getLastVisitByLocationId({
  db,
  ids,
  locationType,
  locationField,
}: {
  db: PrismaClient;
  ids: string[];
  locationField: 'agencyId' | 'wholesaleAccountId';
  locationType: VisitLocationType;
}) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map<string, Date>();

  const rows = await db.loggedVisit.groupBy({
    by: [locationField],
    where: {
      locationType,
      [locationField]: { in: uniqueIds },
    },
    _max: { visitAt: true },
  });

  return new Map(
    rows
      .map((row) => {
        const id = row[locationField];
        return id && row._max.visitAt ? ([id, row._max.visitAt] as const) : null;
      })
      .filter(Boolean) as Array<readonly [string, Date]>,
  );
}

const toAgencyOption = (
  agency: Omit<VisitPickerAgencyOption, 'lastVisitAt'>,
  lastVisitByAgencyKey: Map<string, Date>,
): VisitPickerAgencyOption => ({
  ...agency,
  lastVisitAt: toIsoString(maxDate(lastVisitByAgencyKey.get(agency.id), lastVisitByAgencyKey.get(agency.agencyId))),
});

const toWholesaleOption = (
  account: Omit<VisitPickerWholesaleOption, 'lastVisitAt'>,
  lastVisitByAccountId: Map<string, Date>,
): VisitPickerWholesaleOption => ({
  ...account,
  lastVisitAt: toIsoString(lastVisitByAccountId.get(account.id)),
});

export async function getAgenciesForVisitPicker({
  db = prisma,
  take = defaultTake,
}: {
  db?: PrismaClient;
  take?: number;
} = {}) {
  const agencies = await db.agency.findMany({
    orderBy: { name: 'asc' },
    take,
    select: {
      agencyId: true,
      city: true,
      county: true,
      id: true,
      name: true,
      phone: true,
    },
  });
  const lastVisitByAgencyKey = await getLastVisitByLocationId({
    db,
    ids: agencies.flatMap((agency) => [agency.id, agency.agencyId]),
    locationField: 'agencyId',
    locationType: 'agency',
  });

  return sortVisitPickerOptions(agencies.map((agency) => toAgencyOption(agency, lastVisitByAgencyKey)));
}

export async function getAgencyVisitPickerOptionById({
  db = prisma,
  id,
}: {
  db?: PrismaClient;
  id: string;
}) {
  const agency = await db.agency.findUnique({
    where: { id },
    select: {
      agencyId: true,
      city: true,
      county: true,
      id: true,
      name: true,
      phone: true,
    },
  });

  if (!agency) return null;

  const lastVisitByAgencyKey = await getLastVisitByLocationId({
    db,
    ids: [agency.id, agency.agencyId],
    locationField: 'agencyId',
    locationType: 'agency',
  });

  return toAgencyOption(agency, lastVisitByAgencyKey);
}

export async function getWholesaleAccountsForVisitPicker({
  db = prisma,
  take = defaultTake,
}: {
  db?: PrismaClient;
  take?: number;
} = {}) {
  const accounts = await db.wholesaleAccount.findMany({
    orderBy: { name: 'asc' },
    take,
    where: { isActive: true },
    select: {
      agencyId: true,
      city: true,
      county: true,
      id: true,
      licenseeId: true,
      name: true,
      phone: true,
    },
  });
  const lastVisitByAccountId = await getLastVisitByLocationId({
    db,
    ids: accounts.map((account) => account.id),
    locationField: 'wholesaleAccountId',
    locationType: 'wholesale',
  });

  return sortVisitPickerOptions(accounts.map((account) => toWholesaleOption(account, lastVisitByAccountId)));
}

export async function getWholesaleVisitPickerOptionById({
  db = prisma,
  id,
}: {
  db?: PrismaClient;
  id: string;
}) {
  const account = await db.wholesaleAccount.findUnique({
    where: { id },
    select: {
      agencyId: true,
      city: true,
      county: true,
      id: true,
      licenseeId: true,
      name: true,
      phone: true,
    },
  });

  if (!account) return null;

  const lastVisitByAccountId = await getLastVisitByLocationId({
    db,
    ids: [account.id],
    locationField: 'wholesaleAccountId',
    locationType: 'wholesale',
  });

  return toWholesaleOption(account, lastVisitByAccountId);
}
