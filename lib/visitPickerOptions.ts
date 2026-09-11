import type { PrismaClient } from '@prisma/client';
import { prisma } from './prisma';
import { formatWholesaleLicenseeIds } from './wholesaleAccounts';
import { getDistanceMiles, isValidCoordinates, type Coordinates } from './location/distance';

export type VisitLocationType = 'agency' | 'wholesale';

export type VisitPickerAgencyOption = {
  agencyId: string;
  city: string | null;
  county: string | null;
  id: string;
  lastVisitAt: string | null;
  name: string;
  phone: string | null;
  latitude?: number | null;
  longitude?: number | null;
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
  latitude?: number | null;
  longitude?: number | null;
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
const defaultSearchTake = 20;

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

const getTextRelevance = (query: string, name: string) => {
  const search = query.trim().toLowerCase();
  const normalizedName = name.trim().toLowerCase();
  if (normalizedName === search) return 4;
  if (normalizedName.startsWith(search)) return 3;
  if (normalizedName.includes(search)) return 2;
  return 1;
};

export function rankVisitSearchOptions<
  T extends SortableVisitPickerOption & { latitude?: number | null; longitude?: number | null },
>(items: T[], query: string, coordinates?: Coordinates | null): T[] {
  const center = coordinates && isValidCoordinates(coordinates) ? coordinates : null;
  return [...items].sort((left, right) => {
    const relevance = getTextRelevance(query, right.name) - getTextRelevance(query, left.name);
    if (relevance) return relevance;
    if (center) {
      const leftDistance = left.latitude == null || left.longitude == null
        ? Number.POSITIVE_INFINITY
        : getDistanceMiles(center, { latitude: left.latitude, longitude: left.longitude });
      const rightDistance = right.latitude == null || right.longitude == null
        ? Number.POSITIVE_INFINITY
        : getDistanceMiles(center, { latitude: right.latitude, longitude: right.longitude });
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    }
    return getVisitTime(right.lastVisitAt) - getVisitTime(left.lastVisitAt) || left.name.localeCompare(right.name);
  });
}

async function getLastVisitByLocationId({
  db,
  ids,
  locationType,
  locationField,
  organizationId,
}: {
  db: PrismaClient;
  ids: string[];
  locationField: 'agencyId' | 'wholesaleAccountId';
  locationType: VisitLocationType;
  organizationId?: string;
}) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map<string, Date>();

  const rows = await db.loggedVisit.groupBy({
    by: [locationField],
    where: {
      locationType,
      ...(organizationId ? { organizationId } : {}),
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
  account: Omit<VisitPickerWholesaleOption, 'lastVisitAt'> & {
    licenseeIds?: Array<{ licenseeId: string | null }> | null;
  },
  lastVisitByAccountId: Map<string, Date>,
): VisitPickerWholesaleOption => ({
  ...account,
  licenseeId: formatWholesaleLicenseeIds(account),
  lastVisitAt: toIsoString(lastVisitByAccountId.get(account.id)),
});

export async function getAgenciesForVisitPicker({
  db = prisma,
  take = defaultTake,
  organizationId,
}: {
  db?: PrismaClient;
  take?: number;
  organizationId?: string;
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
    organizationId,
  });

  return sortVisitPickerOptions(agencies.map((agency) => toAgencyOption(agency, lastVisitByAgencyKey)));
}

export async function getAgencyVisitPickerOptionById({
  db = prisma,
  id,
  organizationId,
}: {
  db?: PrismaClient;
  id: string;
  organizationId?: string;
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
    organizationId,
  });

  return toAgencyOption(agency, lastVisitByAgencyKey);
}

export async function searchAgenciesForVisitPicker({
  db = prisma,
  query,
  take = defaultSearchTake,
  coordinates,
  organizationId,
}: {
  db?: PrismaClient;
  query: string;
  take?: number;
  coordinates?: Coordinates | null;
  organizationId?: string;
}) {
  const search = query.trim();
  if (search.length < 2) return [];

  const agencies = await db.agency.findMany({
    orderBy: { name: 'asc' },
    take: 50,
    where: {
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { agencyId: { contains: search, mode: 'insensitive' } },
        { address: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { county: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ],
    },
    select: {
      agencyId: true,
      city: true,
      county: true,
      id: true,
      latitude: true,
      longitude: true,
      name: true,
      phone: true,
    },
  });
  const lastVisitByAgencyKey = await getLastVisitByLocationId({
    db,
    ids: agencies.flatMap((agency) => [agency.id, agency.agencyId]),
    locationField: 'agencyId',
    locationType: 'agency',
    organizationId,
  });

  return rankVisitSearchOptions(
    agencies.map((agency) => toAgencyOption(agency, lastVisitByAgencyKey)),
    search,
    coordinates,
  ).slice(0, Math.min(Math.max(take, 1), 50));
}

export async function getWholesaleAccountsForVisitPicker({
  db = prisma,
  take = defaultTake,
  organizationId,
}: {
  db?: PrismaClient;
  take?: number;
  organizationId?: string;
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
      licenseeIds: { select: { licenseeId: true } },
      name: true,
      phone: true,
    },
  });
  const lastVisitByAccountId = await getLastVisitByLocationId({
    db,
    ids: accounts.map((account) => account.id),
    locationField: 'wholesaleAccountId',
    locationType: 'wholesale',
    organizationId,
  });

  return sortVisitPickerOptions(accounts.map((account) => toWholesaleOption(account, lastVisitByAccountId)));
}

export async function getWholesaleVisitPickerOptionById({
  db = prisma,
  id,
  organizationId,
}: {
  db?: PrismaClient;
  id: string;
  organizationId?: string;
}) {
  const account = await db.wholesaleAccount.findUnique({
    where: { id },
    select: {
      agencyId: true,
      city: true,
      county: true,
      id: true,
      licenseeId: true,
      licenseeIds: { select: { licenseeId: true } },
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
    organizationId,
  });

  return toWholesaleOption(account, lastVisitByAccountId);
}

export async function searchWholesaleAccountsForVisitPicker({
  db = prisma,
  query,
  take = defaultSearchTake,
  coordinates,
  organizationId,
}: {
  db?: PrismaClient;
  query: string;
  take?: number;
  coordinates?: Coordinates | null;
  organizationId?: string;
}) {
  const search = query.trim();
  if (search.length < 2) return [];

  const accounts = await db.wholesaleAccount.findMany({
    orderBy: { name: 'asc' },
    take: 50,
    where: {
      isActive: true,
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { licenseeId: { contains: search, mode: 'insensitive' } },
        { licenseeIds: { some: { licenseeId: { contains: search, mode: 'insensitive' } } } },
        { agencyId: { contains: search, mode: 'insensitive' } },
        { address: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { county: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ],
    },
    select: {
      agencyId: true,
      city: true,
      county: true,
      id: true,
      latitude: true,
      longitude: true,
      licenseeId: true,
      licenseeIds: { select: { licenseeId: true } },
      name: true,
      phone: true,
    },
  });
  const lastVisitByAccountId = await getLastVisitByLocationId({
    db,
    ids: accounts.map((account) => account.id),
    locationField: 'wholesaleAccountId',
    locationType: 'wholesale',
    organizationId,
  });

  return rankVisitSearchOptions(
    accounts.map((account) => toWholesaleOption(account, lastVisitByAccountId)),
    search,
    coordinates,
  ).slice(0, Math.min(Math.max(take, 1), 50));
}
