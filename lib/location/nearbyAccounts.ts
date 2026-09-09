import type { PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';
import { formatWholesaleLicenseeIds } from '../wholesaleAccounts';
import { getCoordinateBounds, getDistanceMiles, isValidCoordinates, type Coordinates } from './distance';
import { NEARBY_ACCOUNT_LIMITS } from './nearbyLimits';

export type NearbyAccount = {
  agencyId: string | null;
  city: string | null;
  county: string | null;
  distanceMiles: number;
  id: string;
  lastVisitAt: string | null;
  licenseeId: string | null;
  name: string;
  phone: string | null;
  type: 'agency' | 'wholesale';
};

type NearbyParams = Coordinates & {
  db?: PrismaClient;
  limit?: number;
  radiusMiles?: number;
};

const clampLimit = (limit: number) => Math.min(Math.max(Math.trunc(limit), 1), NEARBY_ACCOUNT_LIMITS.wholesale);
const clampRadius = (radiusMiles = 10) => Math.min(Math.max(radiusMiles, 1), 50);
const toIso = (value: Date | null | undefined) => value?.toISOString() ?? null;

const assertCoordinates = (coordinates: Coordinates) => {
  if (!isValidCoordinates(coordinates)) throw new Error('Invalid coordinates.');
};

export async function getNearbyAgencies({
  db = prisma,
  latitude,
  longitude,
  limit = NEARBY_ACCOUNT_LIMITS.agency,
  radiusMiles = 10,
}: NearbyParams): Promise<NearbyAccount[]> {
  const center = { latitude, longitude };
  assertCoordinates(center);
  const radius = clampRadius(radiusMiles);
  const bounds = getCoordinateBounds(center, radius);
  const agencies = await db.agency.findMany({
    where: {
      geocodeStatus: 'SUCCESS',
      latitude: { gte: bounds.minLatitude, lte: bounds.maxLatitude },
      longitude: { gte: bounds.minLongitude, lte: bounds.maxLongitude },
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
  const candidates = agencies
    .filter((agency) => agency.latitude !== null && agency.longitude !== null)
    .map((agency) => ({
      agency,
      distanceMiles: getDistanceMiles(center, {
        latitude: agency.latitude as number,
        longitude: agency.longitude as number,
      }),
    }))
    .filter((candidate) => candidate.distanceMiles <= radius)
    .sort((left, right) => left.distanceMiles - right.distanceMiles || left.agency.name.localeCompare(right.agency.name))
    .slice(0, clampLimit(limit));
  const agencyKeys = candidates.flatMap(({ agency }) => [agency.id, agency.agencyId]);
  const visits = agencyKeys.length
    ? await db.loggedVisit.groupBy({
        by: ['agencyId'],
        where: { locationType: 'agency', agencyId: { in: agencyKeys } },
        _max: { visitAt: true },
      })
    : [];
  const lastVisitByAgencyKey = new Map(
    visits.flatMap((visit) => visit.agencyId && visit._max.visitAt ? [[visit.agencyId, visit._max.visitAt] as const] : []),
  );

  return candidates.map(({ agency, distanceMiles }) => {
    const byId = lastVisitByAgencyKey.get(agency.id);
    const byAgencyId = lastVisitByAgencyKey.get(agency.agencyId);
    const lastVisitAt = !byId || (byAgencyId && byAgencyId > byId) ? byAgencyId : byId;
    return {
      agencyId: agency.agencyId,
      city: agency.city,
      county: agency.county,
      distanceMiles,
      id: agency.id,
      lastVisitAt: toIso(lastVisitAt),
      licenseeId: null,
      name: agency.name,
      phone: agency.phone,
      type: 'agency' as const,
    };
  });
}

export async function getNearbyWholesaleAccounts({
  db = prisma,
  latitude,
  longitude,
  limit = NEARBY_ACCOUNT_LIMITS.wholesale,
  radiusMiles = 10,
}: NearbyParams): Promise<NearbyAccount[]> {
  const center = { latitude, longitude };
  assertCoordinates(center);
  const radius = clampRadius(radiusMiles);
  const bounds = getCoordinateBounds(center, radius);
  const accounts = await db.wholesaleAccount.findMany({
    where: {
      isActive: true,
      mergedIntoId: null,
      geocodeStatus: 'SUCCESS',
      latitude: { gte: bounds.minLatitude, lte: bounds.maxLatitude },
      longitude: { gte: bounds.minLongitude, lte: bounds.maxLongitude },
    },
    select: {
      agencyId: true,
      city: true,
      county: true,
      id: true,
      latitude: true,
      licenseeId: true,
      licenseeIds: { select: { licenseeId: true } },
      longitude: true,
      name: true,
      phone: true,
    },
  });
  const candidates = accounts
    .filter((account) => account.latitude !== null && account.longitude !== null)
    .map((account) => ({
      account,
      distanceMiles: getDistanceMiles(center, {
        latitude: account.latitude as number,
        longitude: account.longitude as number,
      }),
    }))
    .filter((candidate) => candidate.distanceMiles <= radius)
    .sort((left, right) => left.distanceMiles - right.distanceMiles || left.account.name.localeCompare(right.account.name))
    .slice(0, clampLimit(limit));
  const accountIds = candidates.map(({ account }) => account.id);
  const visits = accountIds.length
    ? await db.loggedVisit.groupBy({
        by: ['wholesaleAccountId'],
        where: { locationType: 'wholesale', wholesaleAccountId: { in: accountIds } },
        _max: { visitAt: true },
      })
    : [];
  const lastVisitByAccountId = new Map(
    visits.flatMap((visit) => visit.wholesaleAccountId && visit._max.visitAt
      ? [[visit.wholesaleAccountId, visit._max.visitAt] as const]
      : []),
  );

  return candidates.map(({ account, distanceMiles }) => ({
    agencyId: account.agencyId,
    city: account.city,
    county: account.county,
    distanceMiles,
    id: account.id,
    lastVisitAt: toIso(lastVisitByAccountId.get(account.id)),
    licenseeId: formatWholesaleLicenseeIds(account),
    name: account.name,
    phone: account.phone,
    type: 'wholesale' as const,
  }));
}

