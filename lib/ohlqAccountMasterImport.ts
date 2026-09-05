import Papa from 'papaparse';
import { areOhlqAddressesSame, getOhlqLicenseeMatchKeys, normalizeOhlqAddressPart } from './ohlqWholesaleMatching';

export type AccountMasterCsvRow = {
  LicenseeID?: string;
  AgencyID?: string;
  Ownership?: string;
  DBA?: string;
  Address?: string;
  City?: string;
  County?: string;
  ZipCode?: string;
  DistrictId?: string;
  DeliveryDay?: string;
  PhoneNumber?: string;
};

export type AccountMasterRow = {
  licenseeId: string;
  agencyId: string | null;
  ownership: string | null;
  dba: string | null;
  name: string;
  address: string | null;
  city: string | null;
  county: string | null;
  state: 'OH';
  zip: string | null;
  districtId: string | null;
  deliveryDay: string | null;
  phone: string | null;
};

export type ExistingAccountIdentity = {
  name: string;
  address: string | null;
  city: string | null;
  zip: string | null;
  agencyId: string | null;
};

export type AccountMasterWholesaleValues = {
  address: string | null;
  agencyId: string | null;
  city: string | null;
  county: string | null;
  deliveryDay: string | null;
  districtId: string | null;
  isActive: boolean;
  name: string;
  officialAccountId: string | null;
  ownership: string | null;
  phone: string | null;
  state: string | null;
  zip: string | null;
};

export type AccountMasterSelection = {
  selected: AccountMasterRow[];
  ambiguous: Array<{ licenseeId: string; rows: AccountMasterRow[] }>;
  excludedTransientRows: number;
  duplicateGroups: number;
  parsedRows: number;
  headers: string[];
};

export const ACCOUNT_MASTER_REQUIRED_HEADERS = [
  'LicenseeID',
  'AgencyID',
  'Ownership',
  'DBA',
  'Address',
  'City',
  'County',
  'ZipCode',
  'DistrictId',
  'DeliveryDay',
  'PhoneNumber',
] as const;

export const DEFAULT_ACCOUNT_MASTER_MIN_SELECTED_ROWS = 10_000;

export function assertAccountMasterSelectionIsSafe(
  selection: AccountMasterSelection,
  { minimumSelectedRows = DEFAULT_ACCOUNT_MASTER_MIN_SELECTED_ROWS }: { minimumSelectedRows?: number } = {},
) {
  const missingHeaders = ACCOUNT_MASTER_REQUIRED_HEADERS.filter((header) => !selection.headers.includes(header));
  if (missingHeaders.length) {
    throw new Error(`Account Master is missing required header(s): ${missingHeaders.join(', ')}.`);
  }
  if (selection.selected.length < minimumSelectedRows) {
    throw new Error(
      `Account Master selected only ${selection.selected.length} Licensee IDs; expected at least ${minimumSelectedRows}.`,
    );
  }
}

const clean = (value: unknown) => {
  const text = String(value ?? '').trim();
  return text && text.toUpperCase() !== 'N/A' ? text : null;
};

const normalizeComparison = (value: string | null | undefined) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();

const normalizeZip = (value: string | null | undefined) => String(value ?? '').replace(/\D/g, '').slice(0, 5);

export const getWholesaleLocationKey = (identity: {
  address: string | null;
  city: string | null;
  state?: string | null;
  zip: string | null;
}) => {
  const address = normalizeOhlqAddressPart(identity.address);
  if (!address) return null;
  const zip = normalizeZip(identity.zip);
  const city = normalizeOhlqAddressPart(identity.city);
  const state = normalizeOhlqAddressPart(identity.state) ?? 'OH';
  if (!zip && !city) return null;
  return `${address}|${zip || city}|${state}`;
};

export const rowMatchesWholesaleImportIdentity = (
  row: AccountMasterRow,
  account: { name: string; address: string | null; city: string | null; state: string | null; zip: string | null },
) => {
  if (row.address && account.address) return areOhlqAddressesSame(row, account);
  return [row.name, row.dba, row.ownership]
    .map(normalizeComparison)
    .filter(Boolean)
    .includes(normalizeComparison(account.name));
};

const getLicenseeKeys = (licenseeIds: string[]) => new Set(licenseeIds.flatMap(getOhlqLicenseeMatchKeys));

const BUSINESS_NAME_STOP_WORDS = new Set(['AND', 'AT', 'DBA', 'LLC', 'OF', 'THE']);

const getBusinessNameTokens = (value: string) =>
  normalizeComparison(value).split(' ').filter((token) => token && !BUSINESS_NAME_STOP_WORDS.has(token));

const getBusinessNameKey = (value: string | null | undefined) => getBusinessNameTokens(String(value ?? '')).join(' ');

const getBusinessNameOverlap = (left: string, right: string) => {
  const leftTokens = new Set(getBusinessNameTokens(left));
  const rightTokens = new Set(getBusinessNameTokens(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let shared = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) shared += 1;
  });
  return shared / Math.max(leftTokens.size, rightTokens.size);
};

export const wholesaleLocationIdentitiesMatch = (
  left: { address: string | null; city: string | null; state?: string | null; zip: string | null; name: string; ownership?: string | null; licenseeIds: string[] },
  right: { address: string | null; city: string | null; state?: string | null; zip: string | null; name: string; ownership?: string | null; licenseeIds: string[] },
) => {
  const leftLocation = getWholesaleLocationKey(left);
  if (!leftLocation || leftLocation !== getWholesaleLocationKey(right)) return false;
  if (getBusinessNameKey(left.name) === getBusinessNameKey(right.name)) return true;
  const leftKeys = getLicenseeKeys(left.licenseeIds);
  const sharesLicenseFamily = right.licenseeIds.flatMap(getOhlqLicenseeMatchKeys).some((key) => leftKeys.has(key));
  const leftOwnership = getBusinessNameKey(left.ownership);
  const rightOwnership = getBusinessNameKey(right.ownership);
  if (sharesLicenseFamily && leftOwnership && leftOwnership === rightOwnership) return true;
  return sharesLicenseFamily && getBusinessNameOverlap(left.name, right.name) >= 0.5;
};

type WholesaleLocationIdentity = {
  address: string | null;
  city: string | null;
  state?: string | null;
  zip: string | null;
  name: string;
  ownership?: string | null;
  licenseeIds: string[];
};

export function groupWholesaleLocationIdentities<T extends WholesaleLocationIdentity>(rows: T[]) {
  const locationBuckets = new Map<string, T[]>();
  const ungrouped: T[][] = [];
  rows.forEach((row) => {
    const key = getWholesaleLocationKey(row);
    if (!key) ungrouped.push([row]);
    else locationBuckets.set(key, [...(locationBuckets.get(key) ?? []), row]);
  });

  const groups = [...ungrouped];
  for (const bucket of locationBuckets.values()) {
    const parents = bucket.map((_, index) => index);
    const find = (index: number): number => parents[index] === index ? index : (parents[index] = find(parents[index]));
    const union = (left: number, right: number) => {
      const leftRoot = find(left);
      const rightRoot = find(right);
      if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
    };
    for (let left = 0; left < bucket.length; left += 1) {
      for (let right = left + 1; right < bucket.length; right += 1) {
        if (wholesaleLocationIdentitiesMatch(
          bucket[left],
          bucket[right],
        )) union(left, right);
      }
    }
    const components = new Map<number, T[]>();
    bucket.forEach((row, index) => {
      const root = find(index);
      components.set(root, [...(components.get(root) ?? []), row]);
    });
    groups.push(...components.values());
  }
  return groups;
}

export function groupAccountMasterRowsByLocation(rows: AccountMasterRow[]) {
  return groupWholesaleLocationIdentities(
    rows.map((row) => ({ ...row, licenseeIds: [row.licenseeId] })),
  ).map((group) => group.map(({ licenseeIds: _licenseeIds, ...row }) => row));
}

export function choosePrimaryAccountMasterRow(rows: AccountMasterRow[]) {
  if (rows.length === 0) throw new Error('Cannot choose a primary row from an empty location group.');
  const nameFrequency = new Map<string, number>();
  rows.forEach((row) => {
    const key = normalizeComparison(row.name);
    nameFrequency.set(key, (nameFrequency.get(key) ?? 0) + 1);
  });
  return [...rows].sort((left, right) =>
    (nameFrequency.get(normalizeComparison(right.name)) ?? 0) - (nameFrequency.get(normalizeComparison(left.name)) ?? 0) ||
    Number(Boolean(right.dba)) - Number(Boolean(left.dba)) ||
    left.licenseeId.localeCompare(right.licenseeId),
  )[0];
}

const normalizeLicenseeId = (value: unknown) => String(value ?? '').trim().toUpperCase();

const isTransient = (row: AccountMasterCsvRow) =>
  /transient/i.test(String(row.DBA ?? '')) || /transient/i.test(String(row.Ownership ?? ''));

const preferredDuplicateNames = new Map([
  ['3843801-0015', 'LIBERTY WINE & LIQUOR'],
]);

const toAccountMasterRow = (row: AccountMasterCsvRow): AccountMasterRow | null => {
  const licenseeId = normalizeLicenseeId(row.LicenseeID);
  const ownership = clean(row.Ownership);
  const dba = clean(row.DBA);
  const name = dba ?? ownership;

  if (!licenseeId || !name || /^0+$/.test(licenseeId)) return null;

  return {
    licenseeId,
    agencyId: clean(row.AgencyID),
    ownership,
    dba,
    name,
    address: clean(row.Address),
    city: clean(row.City),
    county: clean(row.County),
    state: 'OH',
    zip: clean(row.ZipCode),
    districtId: clean(row.DistrictId),
    deliveryDay: clean(row.DeliveryDay),
    phone: clean(row.PhoneNumber),
  };
};

const rowFingerprint = (row: AccountMasterRow) =>
  [
    row.licenseeId,
    row.agencyId,
    row.ownership,
    row.dba,
    row.address,
    row.city,
    row.county,
    row.zip,
    row.districtId,
    row.deliveryDay,
    row.phone,
  ]
    .map(normalizeComparison)
    .join('|');

const scoreCandidate = (row: AccountMasterRow, identity: ExistingAccountIdentity) => {
  const rowNames = [row.name, row.dba, row.ownership].map(normalizeComparison).filter(Boolean);
  const identityName = normalizeComparison(identity.name);
  const rowAddress = normalizeComparison(row.address);
  const identityAddress = normalizeComparison(identity.address);
  const rowCity = normalizeComparison(row.city);
  const identityCity = normalizeComparison(identity.city);
  const rowZip = normalizeComparison(row.zip);
  const identityZip = normalizeComparison(identity.zip);
  let score = 0;

  if (identityName && rowNames.includes(identityName)) score += 140;
  if (rowAddress && identityAddress && rowAddress === identityAddress) score += 120;
  if (rowCity && identityCity && rowCity === identityCity) score += 15;
  if (rowZip && identityZip && rowZip === identityZip) score += 20;
  if (row.agencyId && identity.agencyId && row.agencyId === identity.agencyId) score += 10;
  return score;
};

export function chooseAccountMasterDuplicate(
  rows: AccountMasterRow[],
  identities: ExistingAccountIdentity[],
) {
  const uniqueRows = Array.from(new Map(rows.map((row) => [rowFingerprint(row), row])).values());
  if (uniqueRows.length === 1) return uniqueRows[0];
  if (identities.length === 0) return null;

  const scored = uniqueRows
    .map((row) => ({ row, score: Math.max(...identities.map((identity) => scoreCandidate(row, identity))) }))
    .sort((left, right) => right.score - left.score);

  return scored[0].score >= 120 && scored[0].score > (scored[1]?.score ?? -1) ? scored[0].row : null;
}

export function parseAccountMasterCsv(
  csv: string,
  identitiesByLicenseeId: Map<string, ExistingAccountIdentity[]> = new Map(),
): AccountMasterSelection {
  const parsed = Papa.parse(csv.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: true,
  }) as {
    data: AccountMasterCsvRow[];
    errors: Array<{ row?: number; message: string }>;
    meta: { fields?: string[] };
  };

  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new Error(`CSV parse failed near row ${first.row ?? 'unknown'}: ${first.message}`);
  }

  const eligibleRows = parsed.data.filter((row) => !isTransient(row));
  const normalizedRows = eligibleRows.map(toAccountMasterRow).filter(Boolean) as AccountMasterRow[];
  const identityFrequency = new Map<string, number>();
  const getBusinessIdentity = (row: AccountMasterRow) =>
    [row.name, row.address, row.city, row.agencyId].map(normalizeComparison).join('|');
  normalizedRows.forEach((row) => {
    const key = getBusinessIdentity(row);
    identityFrequency.set(key, (identityFrequency.get(key) ?? 0) + 1);
  });
  const groups = new Map<string, AccountMasterRow[]>();
  normalizedRows.forEach((row) => groups.set(row.licenseeId, [...(groups.get(row.licenseeId) ?? []), row]));

  const selected: AccountMasterRow[] = [];
  const ambiguous: AccountMasterSelection['ambiguous'] = [];
  let duplicateGroups = 0;

  for (const [licenseeId, rows] of groups) {
    if (rows.length > 1) duplicateGroups += 1;
    let chosen = chooseAccountMasterDuplicate(rows, identitiesByLicenseeId.get(licenseeId) ?? []);
    if (!chosen) {
      const preferredName = preferredDuplicateNames.get(licenseeId);
      const preferredRows = preferredName
        ? rows.filter((row) => normalizeComparison(row.name) === normalizeComparison(preferredName))
        : [];
      if (preferredRows.length === 1) chosen = preferredRows[0];
    }
    if (!chosen) {
      const rankedByFrequency = Array.from(new Map(rows.map((row) => [rowFingerprint(row), row])).values())
        .map((row) => ({ row, frequency: identityFrequency.get(getBusinessIdentity(row)) ?? 0 }))
        .sort((left, right) => left.frequency - right.frequency);
      if (rankedByFrequency[0].frequency < (rankedByFrequency[1]?.frequency ?? Number.POSITIVE_INFINITY)) {
        chosen = rankedByFrequency[0].row;
      }
    }
    if (chosen) selected.push(chosen);
    else ambiguous.push({ licenseeId, rows });
  }

  selected.sort((left, right) => left.licenseeId.localeCompare(right.licenseeId));
  ambiguous.sort((left, right) => left.licenseeId.localeCompare(right.licenseeId));

  return {
    selected,
    ambiguous,
    excludedTransientRows: parsed.data.length - eligibleRows.length,
    duplicateGroups,
    headers: parsed.meta.fields ?? [],
    parsedRows: parsed.data.length,
  };
}

export function getImportedWholesaleName({
  currentName,
  officialName,
  wasActive,
}: {
  currentName: string;
  officialName: string;
  wasActive: boolean;
}) {
  return wasActive ? currentName : officialName;
}

const ACCOUNT_MASTER_WHOLESALE_FIELDS = [
  'address',
  'agencyId',
  'city',
  'county',
  'deliveryDay',
  'districtId',
  'isActive',
  'name',
  'officialAccountId',
  'ownership',
  'phone',
  'state',
  'zip',
] as const satisfies ReadonlyArray<keyof AccountMasterWholesaleValues>;

export function hasAccountMasterWholesaleChanges({
  current,
  existingLicenseeIds,
  next,
  sourceLicenseeIds,
}: {
  current: AccountMasterWholesaleValues;
  existingLicenseeIds: string[];
  next: AccountMasterWholesaleValues;
  sourceLicenseeIds: string[];
}) {
  if (ACCOUNT_MASTER_WHOLESALE_FIELDS.some((field) => current[field] !== next[field])) return true;
  const existing = new Set(existingLicenseeIds.map(normalizeLicenseeId));
  return sourceLicenseeIds.some((licenseeId) => !existing.has(normalizeLicenseeId(licenseeId)));
}
