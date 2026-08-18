import { Prisma, type PrismaClient } from '@prisma/client';
import Papa from 'papaparse';
import { normalizeOhlqId } from './ohlqWholesaleMatching';
import { prisma } from './prisma';
import { getTenantConfig, matchesTenantProduct } from './tenantConfig';

const REQUIRED_HEADERS = [
  'Store',
  'Store_Name',
  'Brand',
  'Brand_Name',
  'Status',
  'Detail_Code_Description',
  'Coverage_Group',
  'Minimum',
  'On_Hand',
  'Vendor',
  'Vendor_Name',
  'Broker',
  'Broker_Name',
  'District',
] as const;

const DISTILLERY_ONLY_DETAIL = 'A3A DISTILLERY ONLY';
const INVENTORY_EXCLUDED_ITEM_CODES = new Set(['3150B', '3750B', '4359B']);
export const DEFAULT_OHLQ_INVENTORY_MIN_QUALIFYING_ROWS = 25;

type RawInventoryRow = Record<(typeof REQUIRED_HEADERS)[number], string>;
type CsvParseResult<T> = {
  data: T[];
  errors: Array<{ message: string }>;
  meta: { fields?: string[] };
};

export type OhlqAgencyInventoryDiagnostics = {
  currentRecordsInserted: number;
  currentRecordsRemoved: number;
  currentRecordsUpdated: number;
  durationMs: number;
  excludedDistilleryOnlyRows: number;
  excludedItemRows: Record<'3150B' | '3750B' | '4359B', number>;
  malformedIdentifierRows: number;
  malformedNumericRows: number;
  qualifyingRows: number;
  rawRows: number;
  rowsMatchingVendor: number;
  snapshotDate: string;
  snapshotRecordsInserted: number;
  uniqueAgencies: number;
  uniqueItems: number;
  unmatchedAgencyNumbers: string[];
};

export type OhlqAgencyInventoryImportResult = {
  deletedRows: number;
  diagnostics: OhlqAgencyInventoryDiagnostics;
  importedRows: number;
  parsedRows: number;
  reportDate: string;
  skippedRows: number;
};

const clean = (value: string | null | undefined) => {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
};

const normalizeItemCode = (value: string | null | undefined) => normalizeOhlqId(value);

const toDateOnlyUtc = (isoDate: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error(`Invalid OHLQ inventory snapshot date: ${isoDate}`);
  }
  return new Date(`${isoDate}T00:00:00.000Z`);
};

function parseQuantity(value: string | null | undefined) {
  const normalized = clean(value)?.replace(/,/g, '');
  if (!normalized) return { valid: true as const, value: null };
  if (!/^-?\d+$/.test(normalized)) return { valid: false as const, value: null };
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) return { valid: false as const, value: null };
  return { valid: true as const, value: parsed };
}

export function getOhlqInventoryMinQualifyingRows(
  rawValue: string | null | undefined = process.env.OHLQ_INVENTORY_MIN_QUALIFYING_ROWS,
) {
  if (!rawValue?.trim()) return DEFAULT_OHLQ_INVENTORY_MIN_QUALIFYING_ROWS;
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('OHLQ_INVENTORY_MIN_QUALIFYING_ROWS must be a positive whole number when provided.');
  }
  return parsed;
}

export function parseOhlqAgencyInventoryCsv(
  csv: string | Buffer,
  snapshotDateIso: string,
  { minimumQualifyingRows = getOhlqInventoryMinQualifyingRows() }: { minimumQualifyingRows?: number } = {},
) {
  const snapshotDate = toDateOnlyUtc(snapshotDateIso);
  const parsed = Papa.parse(csv.toString('utf8'), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim().replace(/^\uFEFF/, ''),
  }) as CsvParseResult<RawInventoryRow>;

  if (parsed.errors.length > 0) {
    throw new Error(`Unable to parse OHLQ Agency Inventory CSV: ${parsed.errors[0].message}`);
  }
  if (parsed.data.length === 0) {
    throw new Error('OHLQ Agency Inventory CSV contains no data rows.');
  }

  const headers = new Set(parsed.meta.fields ?? []);
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.has(header));
  if (missingHeaders.length > 0) {
    throw new Error(`OHLQ Agency Inventory CSV is missing required header(s): ${missingHeaders.join(', ')}`);
  }

  const tenantConfig = getTenantConfig();
  const rowsByKey = new Map<string, Prisma.OhlqAgencyInventorySnapshotCreateManyInput>();
  const stats = {
    excludedDistilleryOnlyRows: 0,
    excludedItemRows: { '3150B': 0, '3750B': 0, '4359B': 0 },
    malformedIdentifierRows: 0,
    malformedNumericRows: 0,
    qualifyingRows: 0,
    rawRows: parsed.data.length,
    rowsMatchingVendor: 0,
  };

  for (const row of parsed.data) {
    const agencyNumber = normalizeOhlqId(row.Store);
    const itemCode = normalizeItemCode(row.Brand);
    const vendorId = normalizeOhlqId(row.Vendor);
    if (!agencyNumber || !itemCode || !vendorId) {
      stats.malformedIdentifierRows += 1;
      continue;
    }

    const matchesConfiguredVendor = tenantConfig.productFilter.vendorIds.includes(vendorId);
    if (matchesConfiguredVendor) stats.rowsMatchingVendor += 1;
    if (matchesConfiguredVendor && (itemCode === '3150B' || itemCode === '3750B' || itemCode === '4359B')) {
      stats.excludedItemRows[itemCode] += 1;
    }

    const detailCodeDescription = clean(row.Detail_Code_Description);
    if (matchesConfiguredVendor && detailCodeDescription?.toUpperCase() === DISTILLERY_ONLY_DETAIL) {
      stats.excludedDistilleryOnlyRows += 1;
    }

    if (INVENTORY_EXCLUDED_ITEM_CODES.has(itemCode)) continue;
    if (!matchesTenantProduct({ config: tenantConfig, itemCode, vendor: vendorId })) continue;
    if (detailCodeDescription?.toUpperCase() === DISTILLERY_ONLY_DETAIL) continue;

    const minimum = parseQuantity(row.Minimum);
    const onHand = parseQuantity(row.On_Hand);
    if (!minimum.valid || !onHand.valid) {
      stats.malformedNumericRows += 1;
      continue;
    }

    const agencyName = clean(row.Store_Name);
    const itemName = clean(row.Brand_Name);
    if (!agencyName || !itemName) {
      stats.malformedIdentifierRows += 1;
      continue;
    }

    stats.qualifyingRows += 1;
    rowsByKey.set(`${agencyNumber}:${itemCode}`, {
      agencyName,
      agencyNumber,
      brokerId: normalizeOhlqId(row.Broker),
      brokerName: clean(row.Broker_Name),
      coverageGroup: clean(row.Coverage_Group),
      detailCodeDescription,
      district: clean(row.District),
      itemCode,
      itemName,
      minimum: minimum.value,
      onHand: onHand.value,
      snapshotDate,
      status: clean(row.Status),
      vendorId,
      vendorName: clean(row.Vendor_Name),
    });
  }

  if (stats.qualifyingRows < minimumQualifyingRows || rowsByKey.size < minimumQualifyingRows) {
    throw new Error(
      `OHLQ Agency Inventory CSV produced only ${stats.qualifyingRows} qualifying row(s) ` +
        `and ${rowsByKey.size} unique agency/item row(s); expected at least ${minimumQualifyingRows}.`,
    );
  }

  return { rows: Array.from(rowsByKey.values()), stats };
}

const keyFor = (row: { agencyNumber: string; itemCode: string }) => `${row.agencyNumber}:${row.itemCode}`;

export async function importOhlqAgencyInventoryCsv({
  csv,
  db = prisma,
  minimumQualifyingRows,
  reportDate,
}: {
  csv: string | Buffer;
  db?: PrismaClient;
  minimumQualifyingRows?: number;
  reportDate: string;
}) {
  const startedAt = Date.now();
  const parsed = parseOhlqAgencyInventoryCsv(csv, reportDate, { minimumQualifyingRows });
  const snapshotDate = toDateOnlyUtc(reportDate);
  const agencyNumbers = Array.from(new Set(parsed.rows.map((row) => row.agencyNumber)));
  const agencies = await db.agency.findMany({
    select: { agencyId: true, id: true },
    where: { agencyId: { in: agencyNumbers } },
  });
  const agencyIdByNumber = new Map(agencies.map((agency) => [normalizeOhlqId(agency.agencyId), agency.id]));
  const unmatchedAgencyNumbers = agencyNumbers.filter((agencyNumber) => !agencyIdByNumber.has(agencyNumber)).sort();
  const snapshotRows = parsed.rows.map((row) => ({
    ...row,
    agencyId: agencyIdByNumber.get(row.agencyNumber) ?? null,
  }));
  const existingCurrent = await db.ohlqAgencyInventoryCurrent.findMany({
    select: { agencyNumber: true, itemCode: true },
  });
  const existingKeys = new Set(existingCurrent.map(keyFor));
  const incomingKeys = new Set(snapshotRows.map(keyFor));
  const currentRecordsInserted = snapshotRows.filter((row) => !existingKeys.has(keyFor(row))).length;
  const currentRecordsUpdated = snapshotRows.length - currentRecordsInserted;
  const currentRecordsRemoved = existingCurrent.filter((row) => !incomingKeys.has(keyFor(row))).length;
  const chunkSize = 1_000;

  const result = await db.$transaction(
    async (tx) => {
      const deletedSnapshots = await tx.ohlqAgencyInventorySnapshot.deleteMany({ where: { snapshotDate } });
      let snapshotRecordsInserted = 0;
      for (let index = 0; index < snapshotRows.length; index += chunkSize) {
        const created = await tx.ohlqAgencyInventorySnapshot.createMany({
          data: snapshotRows.slice(index, index + chunkSize),
          skipDuplicates: true,
        });
        snapshotRecordsInserted += created.count;
      }

      await tx.ohlqAgencyInventoryCurrent.deleteMany({});
      for (let index = 0; index < snapshotRows.length; index += chunkSize) {
        await tx.ohlqAgencyInventoryCurrent.createMany({
          data: snapshotRows.slice(index, index + chunkSize),
          skipDuplicates: true,
        });
      }

      return { deletedSnapshots: deletedSnapshots.count, snapshotRecordsInserted };
    },
    { timeout: 120_000 },
  );

  const diagnostics: OhlqAgencyInventoryDiagnostics = {
    ...parsed.stats,
    currentRecordsInserted,
    currentRecordsRemoved,
    currentRecordsUpdated,
    durationMs: Date.now() - startedAt,
    snapshotDate: reportDate,
    snapshotRecordsInserted: result.snapshotRecordsInserted,
    uniqueAgencies: new Set(snapshotRows.map((row) => row.agencyNumber)).size,
    uniqueItems: new Set(snapshotRows.map((row) => row.itemCode)).size,
    unmatchedAgencyNumbers,
  };

  return {
    deletedRows: result.deletedSnapshots,
    diagnostics,
    importedRows: result.snapshotRecordsInserted,
    parsedRows: parsed.stats.rawRows,
    reportDate,
    skippedRows: parsed.stats.rawRows - parsed.stats.qualifyingRows,
  } satisfies OhlqAgencyInventoryImportResult;
}
