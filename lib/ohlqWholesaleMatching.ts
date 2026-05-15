import { AccountType, type Prisma, type PrismaClient } from '@prisma/client';

const minimumStemSearchLength = 4;

export type OhlqWholesaleLookupAccount = {
  address?: string | null;
  city?: string | null;
  licenseeId?: string | null;
  officialAccountId?: string | null;
  state?: string | null;
  zip?: string | null;
};

export type OhlqWholesaleSalesLookup = {
  licenseeMatchKeys: Set<string>;
  permitNumbers: Set<string>;
  primaryLicenseeId: string | null;
};

type AddressIdentity = {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

type OfficialAccountCandidate = AddressIdentity & {
  id: string;
  licenseeId: string | null;
};

export const normalizeOhlqId = (value: string | null | undefined) => {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized || null;
};

const normalizeZip = (value: string | null | undefined) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.slice(0, 5) || null;
};

const normalizeAddressToken = (value: string) => {
  const ordinalWords: Record<string, string> = {
    EIGHTH: '8',
    FIFTH: '5',
    FIRST: '1',
    FOURTH: '4',
    NINTH: '9',
    SECOND: '2',
    SEVENTH: '7',
    SIXTH: '6',
    TENTH: '10',
    THIRD: '3',
  };
  const replacements: Record<string, string> = {
    AV: 'AVE',
    AVENUE: 'AVE',
    BOULEVARD: 'BLVD',
    CENTER: 'CTR',
    CIRCLE: 'CIR',
    COURT: 'CT',
    DRIVE: 'DR',
    EAST: 'E',
    HIGHWAY: 'HWY',
    LANE: 'LN',
    NORTH: 'N',
    OHIO: 'OH',
    PARKWAY: 'PKWY',
    PLACE: 'PL',
    ROAD: 'RD',
    SOUTH: 'S',
    STREET: 'ST',
    TERRACE: 'TER',
    WEST: 'W',
  };

  const withoutOrdinalSuffix = value.replace(/^(\d+)(ST|ND|RD|TH)$/, '$1');
  return ordinalWords[withoutOrdinalSuffix] ?? replacements[withoutOrdinalSuffix] ?? withoutOrdinalSuffix;
};

export const normalizeOhlqAddressPart = (value: string | null | undefined) => {
  const normalized = String(value ?? '')
    .toUpperCase()
    .replace(/[^\dA-Z]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeAddressToken)
    .join(' ');

  return normalized || null;
};

export const getOhlqAddressKey = (account: AddressIdentity) => {
  const address = normalizeOhlqAddressPart(account.address);
  if (!address) return null;

  const city = normalizeOhlqAddressPart(account.city);
  const state = normalizeOhlqAddressPart(account.state) ?? 'OH';
  const zip = normalizeZip(account.zip);

  return [address, city, state, zip].filter(Boolean).join('|');
};

export const areOhlqAddressesSame = (left: AddressIdentity, right: AddressIdentity) => {
  const leftAddress = normalizeOhlqAddressPart(left.address);
  const rightAddress = normalizeOhlqAddressPart(right.address);

  if (!leftAddress || !rightAddress || leftAddress !== rightAddress) return false;

  const leftZip = normalizeZip(left.zip);
  const rightZip = normalizeZip(right.zip);
  if (leftZip && rightZip) return leftZip === rightZip;

  const leftCity = normalizeOhlqAddressPart(left.city);
  const rightCity = normalizeOhlqAddressPart(right.city);
  const leftState = normalizeOhlqAddressPart(left.state) ?? 'OH';
  const rightState = normalizeOhlqAddressPart(right.state) ?? 'OH';

  return Boolean(leftCity && rightCity && leftCity === rightCity && leftState === rightState);
};

const getAddressStreetNumber = (address: string | null | undefined) => address?.match(/\d+/)?.[0] ?? null;

export const normalizeOhlqLicenseeMatchKey = (value: string | null | undefined) => {
  const normalized = normalizeOhlqId(value);
  if (!normalized) return null;

  const withoutSuffix = normalized.replace(/-\d+$/, '');
  const compact = withoutSuffix.replace(/[^A-Z0-9]/g, '');
  const withoutLeadingZeroes = compact.replace(/^0+/, '');

  return withoutLeadingZeroes || compact || normalized;
};

export const getOhlqLicenseeMatchKeys = (value: string | null | undefined) => {
  const normalized = normalizeOhlqId(value);
  const canonical = normalizeOhlqLicenseeMatchKey(value);
  return Array.from(new Set([normalized, canonical].filter(Boolean) as string[]));
};

export const licenseeIdsMatch = (left: string | null | undefined, right: string | null | undefined) => {
  const leftKeys = new Set(getOhlqLicenseeMatchKeys(left));
  return getOhlqLicenseeMatchKeys(right).some((key) => leftKeys.has(key));
};

export const salesPermitMatchesLookup = (
  permitNumber: string | null | undefined,
  lookup: OhlqWholesaleSalesLookup,
) => {
  const normalizedPermitNumber = normalizeOhlqId(permitNumber);

  if (normalizedPermitNumber && lookup.permitNumbers.has(normalizedPermitNumber)) return true;
  return getOhlqLicenseeMatchKeys(permitNumber).some((key) => lookup.licenseeMatchKeys.has(key));
};

const addLicenseeIdToLookup = (lookup: OhlqWholesaleSalesLookup, value: string | null | undefined) => {
  const normalized = normalizeOhlqId(value);
  if (normalized) lookup.permitNumbers.add(normalized);
  getOhlqLicenseeMatchKeys(value).forEach((key) => lookup.licenseeMatchKeys.add(key));
};

const getOfficialAccountCandidates = async ({
  account,
  db,
}: {
  account: OhlqWholesaleLookupAccount;
  db: PrismaClient;
}) => {
  const ors: Prisma.AccountWhereInput[] = [];
  const normalizedLicenseeId = normalizeOhlqId(account.licenseeId);
  const streetNumber = getAddressStreetNumber(account.address);
  const zip = normalizeZip(account.zip);
  const city = normalizeOhlqAddressPart(account.city);

  if (account.officialAccountId) {
    ors.push({ id: account.officialAccountId });
  }

  if (normalizedLicenseeId) {
    ors.push({ licenseeId: { equals: normalizedLicenseeId, mode: 'insensitive' } });
  }

  if (streetNumber) {
    ors.push({
      address: { contains: streetNumber, mode: 'insensitive' },
      ...(zip
        ? { zip: { startsWith: zip } }
        : city
          ? { city: { equals: city, mode: 'insensitive' } }
          : {}),
    });
  }

  if (ors.length === 0) return [] satisfies OfficialAccountCandidate[];

  return db.account.findMany({
    where: {
      type: AccountType.BAR_RESTAURANT,
      OR: ors,
    },
    select: {
      address: true,
      city: true,
      id: true,
      licenseeId: true,
      state: true,
      zip: true,
    },
    take: 250,
  });
};

export async function resolveOhlqWholesaleSalesLookup({
  account,
  db,
}: {
  account: OhlqWholesaleLookupAccount;
  db: PrismaClient;
}) {
  const lookup: OhlqWholesaleSalesLookup = {
    licenseeMatchKeys: new Set(),
    permitNumbers: new Set(),
    primaryLicenseeId: normalizeOhlqId(account.licenseeId),
  };

  addLicenseeIdToLookup(lookup, account.licenseeId);

  const officialCandidates = await getOfficialAccountCandidates({ account, db });
  officialCandidates.forEach((candidate) => {
    if (
      candidate.id === account.officialAccountId ||
      licenseeIdsMatch(candidate.licenseeId, account.licenseeId) ||
      areOhlqAddressesSame(account, candidate)
    ) {
      addLicenseeIdToLookup(lookup, candidate.licenseeId);
    }
  });

  return lookup;
}

export function buildPermitNumberSearchConditions(lookup: OhlqWholesaleSalesLookup) {
  const conditions: Prisma.OhlqAnnualSalesByWholesaleRowWhereInput[] = [
    ...Array.from(lookup.permitNumbers).map((permitNumber) => ({
      permitNumber: { equals: permitNumber, mode: 'insensitive' as const },
    })),
    ...Array.from(lookup.licenseeMatchKeys)
      .filter((key) => key.length >= minimumStemSearchLength)
      .map((key) => ({
        permitNumber: { contains: key, mode: 'insensitive' as const },
      })),
  ];

  const seen = new Set<string>();
  return conditions.filter((condition) => {
    const filter = condition.permitNumber;
    const key =
      typeof filter === 'object' && filter && 'equals' in filter
        ? `equals:${filter.equals}`
        : typeof filter === 'object' && filter && 'contains' in filter
          ? `contains:${filter.contains}`
          : JSON.stringify(condition);

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
