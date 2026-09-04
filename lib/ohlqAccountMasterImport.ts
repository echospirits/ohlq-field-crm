import Papa from 'papaparse';

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

export type AccountMasterSelection = {
  selected: AccountMasterRow[];
  ambiguous: Array<{ licenseeId: string; rows: AccountMasterRow[] }>;
  excludedTransientRows: number;
  duplicateGroups: number;
  parsedRows: number;
};

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
  }) as { data: AccountMasterCsvRow[]; errors: Array<{ row?: number; message: string }> };

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
