import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import Papa from 'papaparse';
import { parseOhlqAnnualSalesByWholesaleCsv, parseOhlqAnnualSalesCsv } from '../../lib/ohlqAnnualSalesImport';

const ECHO_VENDOR = 'Z90399001';
const FIRST_REPORT_DATE = '2019-09-01';
const CHUNK_SIZE = 500;

export type ReportEvidence = {
  fromDate: string;
  toDate: string;
  scope: 'echo-only' | 'statewide';
  source: string;
  sha256: string;
  complete: true;
  noData?: true;
};

type SourceReport = { csv: string | Buffer; evidence: ReportEvidence };

export type EchoSalesDay = {
  reportDate: string;
  annualSalesSummary: SourceReport;
  annualSalesSummaryByWholesale: SourceReport;
};

const summarySpec = {
  name: 'Annual Sales Summary',
  vendorColumn: 'Vendor',
  keys: ['Agency_Id', 'Brand'],
  quantities: ['Retail_Bottles_Sold', 'Wholesale_Bottles_Sold'],
};

const wholesaleSpec = {
  name: 'Annual Sales Summary by Wholesale',
  vendorColumn: 'DimVendor_VendorNumber_',
  keys: ['Agency_Id', 'Brand', 'Permit_Number'],
  quantities: ['Wholesale_Bottles_Sold'],
};

const summaryKey = (row: { agencyId: string; brand: string }) => JSON.stringify([row.agencyId, row.brand]);
const wholesaleKey = (row: { agencyId: string; brand: string; permitNumber: string }) =>
  JSON.stringify([row.agencyId, row.brand, row.permitNumber]);
const summaryQuantity = (row: { retailBottlesSold?: number; wholesaleBottlesSold?: number }) =>
  JSON.stringify([row.retailBottlesSold ?? 0, row.wholesaleBottlesSold ?? 0]);
const wholesaleQuantity = (row: { wholesaleBottlesSold?: number }) => String(row.wholesaleBottlesSold ?? 0);

export function assertHistoricalDate(reportDate: string) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York' }).format(new Date());
  const date = new Date(`${reportDate}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== reportDate || reportDate < FIRST_REPORT_DATE || reportDate >= today) {
    throw new Error('Expected a complete calendar report date on or after 2019-09-01.');
  }
  return date;
}

function strictQuantity(raw: string, sourceName: string) {
  if (raw === '') return 0;
  const quantity = Number(raw.replaceAll(',', ''));
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(raw) || !Number.isInteger(quantity) ||
      quantity < -2_147_483_648 || quantity > 2_147_483_647) {
    throw new Error(`${sourceName} has an invalid Echo bottle quantity.`);
  }
  return quantity;
}

function validateReport(report: SourceReport, reportDate: string, spec: typeof summarySpec) {
  const { csv, evidence } = report;
  if (!evidence || evidence.complete !== true || evidence.fromDate !== reportDate || evidence.toDate !== reportDate ||
      !['echo-only', 'statewide'].includes(evidence.scope) || typeof evidence.source !== 'string' || !evidence.source.trim()) {
    throw new Error(`${spec.name} lacks verified source coverage for ${reportDate}.`);
  }
  const sha256 = createHash('sha256').update(typeof csv === 'string' ? csv : Uint8Array.from(csv)).digest('hex');
  if (typeof evidence.sha256 !== 'string' || sha256 !== evidence.sha256.toLowerCase()) {
    throw new Error(`${spec.name} bytes differ from the source receipt.`);
  }

  // The existing summary parser permits partial integers and keeps the last
  // duplicate. Check Echo quantities and duplicate consistency before reuse.
  const parsed = Papa.parse(csv.toString(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim().replace(/^\uFEFF/, ''),
  }) as { data: Array<Record<string, string>>; errors: unknown[]; meta: { fields?: string[] } };
  const fields = parsed.meta.fields ?? [];
  if (parsed.errors.length || new Set(fields).size !== fields.length ||
      [spec.vendorColumn, ...spec.keys, ...spec.quantities].some((field) => !fields.includes(field))) {
    throw new Error(`${spec.name} has invalid CSV rows or headers.`);
  }
  if ((parsed.data.length === 0) !== (evidence.noData === true)) {
    throw new Error(`${spec.name} does not match its recorded source row presence.`);
  }

  const seen = new Map<string, string>();
  for (const row of parsed.data) {
    const vendor = row[spec.vendorColumn]?.trim();
    const keys = spec.keys.map((key) => row[key]?.trim());
    if (!vendor || keys.some((key) => !key)) throw new Error(`${spec.name} has a row missing its source identity.`);
    if (vendor !== ECHO_VENDOR) {
      if (evidence.scope === 'echo-only') throw new Error(`${spec.name} returned another vendor in an Echo export.`);
      continue;
    }
    const key = JSON.stringify(keys);
    const quantities = JSON.stringify(spec.quantities.map((field) => strictQuantity(row[field]?.trim() ?? '', spec.name)));
    const prior = seen.get(key);
    if (prior !== undefined && prior !== quantities) throw new Error(`${spec.name} has conflicting duplicate Echo rows.`);
    seen.set(key, quantities);
  }
  return { ...evidence, sha256, echoRows: seen.size };
}

export function prepareEchoSalesSummary(report: SourceReport, reportDate: string) {
  const evidence = validateReport(report, reportDate, summarySpec);
  const parsed = parseOhlqAnnualSalesCsv(report.csv, reportDate);
  const rows = parsed.rows.filter((row) => row.vendor === ECHO_VENDOR);
  if (parsed.skippedRows || rows.length !== evidence.echoRows) {
    throw new Error('The OHLQ parsers did not preserve the verified Echo source rows.');
  }
  return { evidence, rows };
}

export function prepareEchoSalesWholesale(report: SourceReport, reportDate: string) {
  const evidence = validateReport(report, reportDate, wholesaleSpec);
  const parsed = parseOhlqAnnualSalesByWholesaleCsv(report.csv, reportDate);
  const rows = parsed.rows.filter((row) => row.vendor === ECHO_VENDOR);
  if (parsed.skippedRows || rows.length !== evidence.echoRows) {
    throw new Error('The OHLQ parsers did not preserve the verified Echo source rows.');
  }
  return { evidence, rows };
}

export function prepareEchoSalesDay(input: EchoSalesDay) {
  const { reportDate, annualSalesSummary, annualSalesSummaryByWholesale } = input;
  const date = assertHistoricalDate(reportDate);
  const { evidence: summaryEvidence, rows: summaryRows } = prepareEchoSalesSummary(annualSalesSummary, reportDate);
  const { evidence: wholesaleEvidence, rows: wholesaleRows } = prepareEchoSalesWholesale(annualSalesSummaryByWholesale, reportDate);
  return { reportDate, date, summaryRows, wholesaleRows, summaryEvidence, wholesaleEvidence };
}

function findMissingRows<Row>(source: Row[], present: Row[], key: (row: Row) => string,
  quantity: (row: Row) => string, sourceName: string) {
  const sourceByKey = new Map(source.map((row) => [key(row), row]));
  for (const row of present) {
    const id = key(row);
    const expected = sourceByKey.get(id);
    if (!expected || quantity(expected) !== quantity(row)) {
      throw new Error(`${sourceName} disagrees with existing Echo rows for this date. No changes were made.`);
    }
    sourceByKey.delete(id);
  }
  return [...sourceByKey.values()];
}

export async function importEchoSalesDay(input: EchoSalesDay & { db: Pick<PrismaClient, '$transaction'> }) {
  const { reportDate, summaryRows, wholesaleRows, summaryEvidence, wholesaleEvidence } = prepareEchoSalesDay(input);
  const result = await importPreparedEchoSalesDay({ db: input.db, reportDate, summaryRows, wholesaleRows });
  const inserted = { summary: result.summaryInserted, wholesale: result.wholesaleInserted };
  return { reportDate, committedAt: new Date().toISOString(), inserted, summaryEvidence, wholesaleEvidence };
}

/**
 * Insert one pair from separately verified provider reports. This also
 * supports a successful rendered no-data report without inventing a CSV.
 */
export async function importPreparedEchoSalesDay({ db, reportDate, summaryRows, wholesaleRows }: {
  db: Pick<PrismaClient, '$transaction'>;
  reportDate: string;
  summaryRows: VerifiedSummaryRow[];
  wholesaleRows: VerifiedWholesaleRow[];
}) {
  const date = assertHistoricalDate(reportDate);
  const where = { reportDate: date, vendor: ECHO_VENDOR };
  const summary = checkedSnapshotRows(summaryRows, reportDate, (row) => [row.agencyId, row.brand],
    (row) => [row.retailBottlesSold, row.wholesaleBottlesSold]);
  const wholesale = checkedSnapshotRows(wholesaleRows, reportDate, (row) => [row.agencyId, row.brand, row.permitNumber],
    (row) => [row.wholesaleBottlesSold]);

  return db.$transaction(async (tx) => {
    const presentSummary = await tx.ohlqAnnualSalesRow.findMany({ where });
    const presentWholesale = await tx.ohlqAnnualSalesByWholesaleRow.findMany({ where });
    const missingSummary = findMissingRows(summary, presentSummary, summaryKey, summaryQuantity, summarySpec.name);
    const missingWholesale = findMissingRows(wholesale, presentWholesale, wholesaleKey, wholesaleQuantity, wholesaleSpec.name);

    for (let offset = 0; offset < missingSummary.length; offset += CHUNK_SIZE) {
      const data = missingSummary.slice(offset, offset + CHUNK_SIZE)
        .map(({ agencyId, brand, retailBottlesSold, wholesaleBottlesSold }) =>
          ({ ...where, agencyId, brand, retailBottlesSold, wholesaleBottlesSold }));
      const result = await tx.ohlqAnnualSalesRow.createMany({ data });
      if (result.count !== data.length) throw new Error('The sales summary insert count disagrees with the source.');
    }
    for (let offset = 0; offset < missingWholesale.length; offset += CHUNK_SIZE) {
      const data = missingWholesale.slice(offset, offset + CHUNK_SIZE)
        .map(({ agencyId, brand, permitNumber, wholesaleBottlesSold }) =>
          ({ ...where, agencyId, brand, permitNumber, wholesaleBottlesSold }));
      const result = await tx.ohlqAnnualSalesByWholesaleRow.createMany({ data });
      if (result.count !== data.length) throw new Error('The wholesale detail insert count disagrees with the source.');
    }

    const actualSummary = await tx.ohlqAnnualSalesRow.findMany({ where });
    const actualWholesale = await tx.ohlqAnnualSalesByWholesaleRow.findMany({ where });
    if (findMissingRows(summary, actualSummary, summaryKey, summaryQuantity, summarySpec.name).length ||
        findMissingRows(wholesale, actualWholesale, wholesaleKey, wholesaleQuantity, wholesaleSpec.name).length) {
      throw new Error('The persisted Echo report pair does not match the verified source.');
    }
    return {
      summaryRows: actualSummary.length,
      wholesaleRows: actualWholesale.length,
      summaryInserted: missingSummary.length,
      wholesaleInserted: missingWholesale.length,
    };
  }, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 30_000 });
}

export function buildEchoSalesDaySql(input: EchoSalesDay) {
  const { reportDate, summaryRows, wholesaleRows, summaryEvidence, wholesaleEvidence } = prepareEchoSalesDay(input);
  const sqlStatements = buildVerifiedEchoSalesDaySql({ reportDate, summaryRows, wholesaleRows });
  return { reportDate, summaryEvidence, wholesaleEvidence, sqlStatements };
}

type VerifiedSummaryRow = {
  agencyId: string;
  brand: string;
  retailBottlesSold?: number;
  wholesaleBottlesSold?: number;
  reportDate?: string | Date;
  vendor?: string;
};
type VerifiedWholesaleRow = Omit<VerifiedSummaryRow, 'retailBottlesSold'> & { permitNumber: string };

function checkedSnapshotRows<Row extends VerifiedSummaryRow | VerifiedWholesaleRow>(rows: Row[], reportDate: string,
  key: (row: Row) => string[], quantities: (row: Row) => Array<number | undefined>) {
  const seen = new Set<string>();
  for (const row of rows) {
    const rowDate = row.reportDate instanceof Date ? row.reportDate.toISOString().slice(0, 10) : row.reportDate;
    const identity = key(row);
    if ((row.vendor !== undefined && row.vendor !== ECHO_VENDOR) || (rowDate !== undefined && rowDate !== reportDate) ||
        identity.some((value) => typeof value !== 'string' || !value || value !== value.trim() || value.includes('\0')) ||
        quantities(row).some((quantity) => typeof quantity !== 'number' || !Number.isInteger(quantity) ||
          quantity < -2_147_483_648 || quantity > 2_147_483_647)) {
      throw new Error('Invalid Echo sales snapshot row for the specified report date.');
    }
    const id = JSON.stringify(identity);
    if (seen.has(id)) throw new Error('Duplicate Echo sales snapshot row.');
    seen.add(id);
  }
  return rows;
}

// Caller must verify historical source provenance, date coverage and the Echo
// scope independently when the normalized rows come from a Neon snapshot.
export function buildVerifiedEchoSalesDaySql({ reportDate, summaryRows, wholesaleRows }: {
  reportDate: string;
  summaryRows: VerifiedSummaryRow[];
  wholesaleRows: VerifiedWholesaleRow[];
}) {
  assertHistoricalDate(reportDate);
  // Base64 uses a fixed alphabet without SQL quoting characters. Vendor and
  // date are fixed separately from the payload and applied by the database.
  const summary = checkedSnapshotRows(summaryRows, reportDate, (row) => [row.agencyId, row.brand],
    (row) => [row.retailBottlesSold, row.wholesaleBottlesSold]);
  const wholesale = checkedSnapshotRows(wholesaleRows, reportDate, (row) => [row.agencyId, row.brand, row.permitNumber],
    (row) => [row.wholesaleBottlesSold]);
  const summaryPayload = Buffer.from(JSON.stringify(summary.map((row) => ({
    agency: row.agencyId, brand: row.brand, retail: row.retailBottlesSold ?? 0, wholesale: row.wholesaleBottlesSold ?? 0,
  })))).toString('base64');
  const wholesalePayload = Buffer.from(JSON.stringify(wholesale.map((row) => ({
    agency: row.agencyId, brand: row.brand, permit: row.permitNumber, wholesale: row.wholesaleBottlesSold ?? 0,
  })))).toString('base64');

  const expectedSummary = `SELECT agency, brand, retail, wholesale FROM jsonb_to_recordset(summary_source)
    AS source(agency text, brand text, retail integer, wholesale integer)`;
  const actualSummary = `SELECT "agencyId", brand, "retailBottlesSold", "wholesaleBottlesSold"
    FROM "OhlqAnnualSalesRow" WHERE "reportDate" = sales_date AND vendor = echo_vendor`;
  const expectedWholesale = `SELECT agency, brand, permit, wholesale FROM jsonb_to_recordset(wholesale_source)
    AS source(agency text, brand text, permit text, wholesale integer)`;
  const actualWholesale = `SELECT "agencyId", brand, "permitNumber", "wholesaleBottlesSold"
    FROM "OhlqAnnualSalesByWholesaleRow" WHERE "reportDate" = sales_date AND vendor = echo_vendor`;

  const extraSummary = `${actualSummary} EXCEPT ${expectedSummary}`;
  const extraWholesale = `${actualWholesale} EXCEPT ${expectedWholesale}`;
  const missingSummary = `${expectedSummary} EXCEPT ${actualSummary}`;
  const missingWholesale = `${expectedWholesale} EXCEPT ${actualWholesale}`;
  const dateValue = `DATE '${reportDate}'`;
  const vendorValue = `'${ECHO_VENDOR}'`;

  const sqlStatements = [
    'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE',
    "SET LOCAL lock_timeout = '5s'",
    "SET LOCAL statement_timeout = '25s'",
    `DO $echo_backfill$
    DECLARE
      sales_date CONSTANT date := ${dateValue};
      echo_vendor CONSTANT text := ${vendorValue};
      summary_source CONSTANT jsonb := convert_from(decode('${summaryPayload}', 'base64'), 'UTF8')::jsonb;
      wholesale_source CONSTANT jsonb := convert_from(decode('${wholesalePayload}', 'base64'), 'UTF8')::jsonb;
      summary_inserted integer;
      wholesale_inserted integer;
    BEGIN
      IF EXISTS (${extraSummary}) OR EXISTS (${extraWholesale}) THEN
        RAISE EXCEPTION 'Existing Echo sales disagree with the verified source for %', sales_date;
      END IF;

      INSERT INTO "OhlqAnnualSalesRow" ("reportDate", "agencyId", vendor, brand, "retailBottlesSold", "wholesaleBottlesSold")
        SELECT sales_date, agency, echo_vendor, brand, retail, wholesale FROM (${missingSummary}) missing;
      GET DIAGNOSTICS summary_inserted = ROW_COUNT;

      INSERT INTO "OhlqAnnualSalesByWholesaleRow" ("reportDate", "agencyId", vendor, brand, "permitNumber", "wholesaleBottlesSold")
        SELECT sales_date, agency, echo_vendor, brand, permit, wholesale FROM (${missingWholesale}) missing;
      GET DIAGNOSTICS wholesale_inserted = ROW_COUNT;

      IF EXISTS (${extraSummary}) OR EXISTS (${extraWholesale}) OR
         EXISTS (${missingSummary}) OR EXISTS (${missingWholesale}) THEN
        RAISE EXCEPTION 'Persisted Echo sales disagree with the verified source for %', sales_date;
      END IF;

      PERFORM set_config('echo_backfill.summary_inserted', summary_inserted::text, true);
      PERFORM set_config('echo_backfill.wholesale_inserted', wholesale_inserted::text, true);
    END;
    $echo_backfill$`,
    `SELECT sales.*,
      current_setting('echo_backfill.summary_inserted')::integer AS "summaryInserted",
      current_setting('echo_backfill.wholesale_inserted')::integer AS "wholesaleInserted"
    FROM (
      SELECT ${dateValue} AS "reportDate", ${vendorValue} AS vendor,
        (SELECT count(*)::integer FROM "OhlqAnnualSalesRow" WHERE "reportDate" = ${dateValue} AND vendor = ${vendorValue})
          AS "summaryRows",
        (SELECT count(*)::integer FROM "OhlqAnnualSalesByWholesaleRow" WHERE "reportDate" = ${dateValue} AND vendor = ${vendorValue})
          AS "wholesaleRows"
    ) sales`,
  ];
  return sqlStatements;
}
