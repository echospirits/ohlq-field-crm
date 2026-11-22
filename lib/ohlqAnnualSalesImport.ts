import { Prisma, type PrismaClient } from '@prisma/client';
import Papa from 'papaparse';
import { syncWholesaleAccountEchoPurchaseState, type OhlqWholesalePurchaseStateSyncResult } from './ohlqWholesalePurchaseState';
import { prisma } from './prisma';
import {
  reconcileWholesaleOrdersAfterOhlqImport,
  type WholesaleOrderReconciliationResult,
  type WholesaleOrderReconciliationRow,
} from './wholesaleOrderReconciliation';
import { lockWholesaleOrderLifecycle } from './wholesaleOrders';
import { ECHO_SALES_VENDOR, lockEchoSalesDate, publishEchoSalesCoverage,
  validateEchoSalesEvidence, type EchoSalesEvidence } from './echoBottleSalesCoverage';

const REQUIRED_HEADERS = [
  'Agency_Id',
  'Vendor',
  'Brand',
  'Retail_Bottles_Sold',
  'Wholesale_Bottles_Sold',
] as const;

const WHOLESALE_REQUIRED_HEADERS = [
  'Agency_Id',
  'DimVendor_VendorNumber_',
  'Brand',
  'Permit_Number',
  'Wholesale_Bottles_Sold',
] as const;

type RawAnnualSalesRow = Record<(typeof REQUIRED_HEADERS)[number], string>;
type RawAnnualSalesByWholesaleRow = Record<(typeof WHOLESALE_REQUIRED_HEADERS)[number], string>;
type CsvParseResult<T> = {
  data: T[];
  errors: Array<{ message: string }>;
  meta: { fields?: string[] };
};

export type OhlqAnnualSalesImportResult = {
  deletedRows: number;
  importedRows: number;
  parsedRows: number;
  reportDate: string;
  skippedRows: number;
};

export type OhlqAnnualSalesByWholesaleImportResult = OhlqAnnualSalesImportResult & {
  echoPurchaseState: OhlqWholesalePurchaseStateSyncResult;
  wholesaleOrderReconciliation: WholesaleOrderReconciliationResult;
};

export type OhlqAnnualSalesByWholesalePurchaseStateSyncResult = {
  echoPurchaseState: OhlqWholesalePurchaseStateSyncResult;
  parsedRows: number;
  reportDate: string;
  skippedRows: number;
  wholesaleOrderReconciliation: WholesaleOrderReconciliationResult;
};

const toDateOnlyUtc = (isoDate: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error(`Invalid OHLQ report date: ${isoDate}`);
  }

  return new Date(`${isoDate}T00:00:00.000Z`);
};

const clean = (value: string | null | undefined) => {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
};

const toInt = (value: string | null | undefined) => {
  const normalized = clean(value)?.replace(/,/g, '');
  if (!normalized) return 0;
  const parsed = Number.parseInt(normalized, 10);
  if (Number.isNaN(parsed)) throw new Error(`Invalid integer value in OHLQ CSV: ${value}`);
  return parsed;
};

const toStrictWholesaleInt = (value: string | null | undefined) => {
  const normalized = clean(value)?.replace(/,/g, '');
  if (!normalized) return 0;
  if (!/^-?\d+$/.test(normalized)) {
    throw new Error(`Invalid wholesale bottle quantity in OHLQ CSV: ${value}`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Invalid wholesale bottle quantity in OHLQ CSV: ${value}`);
  }
  return parsed;
};

export function parseOhlqAnnualSalesCsv(csv: string | Buffer, reportDateIso: string, strict = false) {
  const reportDate = toDateOnlyUtc(reportDateIso);
  const parsed = Papa.parse(csv.toString('utf8'), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim().replace(/^\uFEFF/, ''),
  }) as CsvParseResult<RawAnnualSalesRow>;

  if (parsed.errors.length > 0) {
    const firstError = parsed.errors[0];
    throw new Error(`Unable to parse OHLQ CSV: ${firstError.message}`);
  }

  if (strict && (parsed.meta as { renamedHeaders?: object }).renamedHeaders &&
      Object.keys((parsed.meta as { renamedHeaders?: object }).renamedHeaders!).length) {
    throw new Error('Duplicate OHLQ summary headers.');
  }
  const headers = new Set(parsed.meta.fields ?? []);
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.has(header));
  if (missingHeaders.length > 0) {
    throw new Error(`OHLQ CSV is missing required header(s): ${missingHeaders.join(', ')}`);
  }

  const data = new Map<string, Prisma.OhlqAnnualSalesRowCreateManyInput>();
  let skippedRows = 0;

  function quantity(raw: string, vendor: string) {
    if (!strict) return toInt(raw);
    const value = raw.trim();
    if (!value) return 0;
    const numeric = Number(value.replaceAll(',', ''));
    const echo = vendor === ECHO_SALES_VENDOR;
    // The existing statewide importer truncates non-Echo decimal quantities.
    // Echo receipts require exact whole bottles, including decimal renderings of integers.
    const parsed = echo ? numeric : toInt(raw);
    if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value) ||
        (echo && /[1-9]/.test(value.split('.')[1] ?? '')) ||
        !Number.isInteger(parsed) || parsed < -2147483648 || parsed > 2147483647) {
      throw new Error(`Invalid signed integer in OHLQ sales summary for ${echo ? 'Echo' : 'a non-Echo vendor'}.`);
    }
    return parsed;
  }
  for (const row of parsed.data) {
    const agencyId = clean(row.Agency_Id);
    const vendor = clean(row.Vendor);
    const brand = clean(row.Brand);

    if (!agencyId || !vendor || !brand) {
      skippedRows += 1;
      continue;
    }

    const key = JSON.stringify([agencyId, vendor, brand]);
    if (strict && data.has(key)) throw new Error('Duplicate OHLQ sales summary source key.');
    data.set(key, {
      agencyId,
      brand,
      reportDate,
      retailBottlesSold: quantity(row.Retail_Bottles_Sold, vendor),
      vendor,
      wholesaleBottlesSold: quantity(row.Wholesale_Bottles_Sold, vendor),
    });
  }

  return {
    rows: Array.from(data.values()),
    skippedRows,
  };
}

export function parseOhlqAnnualSalesByWholesaleCsv(csv: string | Buffer, reportDateIso: string) {
  const reportDate = toDateOnlyUtc(reportDateIso);
  const parsed = Papa.parse(csv.toString('utf8'), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim().replace(/^\uFEFF/, ''),
  }) as CsvParseResult<RawAnnualSalesByWholesaleRow>;

  if (parsed.errors.length > 0) {
    const firstError = parsed.errors[0];
    throw new Error(`Unable to parse OHLQ wholesale CSV: ${firstError.message}`);
  }

  const headers = new Set(parsed.meta.fields ?? []);
  const missingHeaders = WHOLESALE_REQUIRED_HEADERS.filter((header) => !headers.has(header));
  if (missingHeaders.length > 0) {
    throw new Error(`OHLQ wholesale CSV is missing required header(s): ${missingHeaders.join(', ')}`);
  }

  const data = new Map<string, Prisma.OhlqAnnualSalesByWholesaleRowCreateManyInput>();
  let skippedRows = 0;

  for (const row of parsed.data) {
    const agencyId = clean(row.Agency_Id);
    const vendor = clean(row.DimVendor_VendorNumber_);
    const brand = clean(row.Brand);
    const permitNumber = clean(row.Permit_Number);

    if (!agencyId || !vendor || !brand || !permitNumber) {
      skippedRows += 1;
      continue;
    }

    const key = `${reportDateIso}:${agencyId}:${vendor}:${brand}:${permitNumber}`;
    const wholesaleBottlesSold = toStrictWholesaleInt(row.Wholesale_Bottles_Sold);
    const existing = data.get(key);
    if (existing && existing.wholesaleBottlesSold !== wholesaleBottlesSold) {
      throw new Error(
        `OHLQ wholesale CSV contains conflicting duplicate rows for agency ${agencyId}, vendor ${vendor}, item ${brand}, and permit ${permitNumber}.`,
      );
    }
    data.set(key, {
      agencyId,
      brand,
      permitNumber,
      reportDate,
      vendor,
      wholesaleBottlesSold,
    });
  }

  return {
    rows: Array.from(data.values()),
    skippedRows,
  };
}

const toWholesalePurchaseStateRows = (rows: Prisma.OhlqAnnualSalesByWholesaleRowCreateManyInput[]) =>
  rows.map((row) => ({
    brand: row.brand,
    permitNumber: row.permitNumber,
    reportDate: row.reportDate instanceof Date ? row.reportDate : new Date(row.reportDate),
    vendor: row.vendor,
    wholesaleBottlesSold: row.wholesaleBottlesSold ?? 0,
  }));

const toWholesaleOrderReconciliationRows = (
  rows: Prisma.OhlqAnnualSalesByWholesaleRowCreateManyInput[],
): WholesaleOrderReconciliationRow[] => rows.map((row) => ({
  agencyId: row.agencyId,
  itemCode: row.brand,
  permitNumber: row.permitNumber,
  reportDate: row.reportDate instanceof Date ? row.reportDate : new Date(row.reportDate),
  vendor: row.vendor,
  wholesaleBottlesSold: row.wholesaleBottlesSold ?? 0,
}));

type ReconcileWholesaleOrders = typeof reconcileWholesaleOrdersAfterOhlqImport;

export async function syncOhlqAnnualSalesByWholesalePurchaseStateCsv({
  csv,
  db = prisma,
  reconcileWholesaleOrders = reconcileWholesaleOrdersAfterOhlqImport,
  reportDate,
}: {
  csv: string | Buffer;
  db?: PrismaClient;
  reconcileWholesaleOrders?: ReconcileWholesaleOrders;
  reportDate: string;
}) {
  const parsed = parseOhlqAnnualSalesByWholesaleCsv(csv, reportDate);
  if (parsed.skippedRows > 0) {
    throw new Error(
      `OHLQ wholesale CSV is incomplete: ${parsed.skippedRows} row(s) are missing agency, vendor, item, or permit identity.`,
    );
  }
  const reportDateValue = toDateOnlyUtc(reportDate);
  const wholesaleOrderReconciliation = await reconcileWholesaleOrders({
    db,
    incomingReportDate: reportDateValue,
    incomingRows: toWholesaleOrderReconciliationRows(parsed.rows),
  });
  const echoPurchaseState = await syncWholesaleAccountEchoPurchaseState({
    db,
    rows: toWholesalePurchaseStateRows(parsed.rows),
  });

  return {
    echoPurchaseState,
    parsedRows: parsed.rows.length,
    reportDate,
    skippedRows: parsed.skippedRows,
    wholesaleOrderReconciliation,
  } satisfies OhlqAnnualSalesByWholesalePurchaseStateSyncResult;
}

export async function importOhlqAnnualSalesCsv({
  csv,
  db = prisma,
  reportDate,
  evidence,
  echoOnly = false,
  pairedWholesale,
}: {
  csv: string | Buffer;
  db?: PrismaClient;
  reportDate: string;
  evidence?: EchoSalesEvidence;
  echoOnly?: boolean;
  pairedWholesale?: (tx: Prisma.TransactionClient) => Promise<string>;
}) {
  const source = evidence && validateEchoSalesEvidence(csv, reportDate, evidence);
  if (pairedWholesale && (!echoOnly || !source)) throw new Error('Paired wholesale requires verified Echo-only writes.');
  if (echoOnly && !source) throw new Error('Echo-only imports require native source evidence.');
  const parsed = parseOhlqAnnualSalesCsv(csv, reportDate, Boolean(source));
  const vendorFiltered = source?.scope === 'VENDOR_FILTERED';
  if (source && (parsed.skippedRows || (vendorFiltered && parsed.rows.some(row => row.vendor !== ECHO_SALES_VENDOR)))) {
    throw new Error('Incomplete or incorrectly scoped Annual Sales Summary.');
  }
  const scopedToEcho = vendorFiltered || echoOnly;
  const rowsToWrite = scopedToEcho ? parsed.rows.filter(row => row.vendor === ECHO_SALES_VENDOR) : parsed.rows;
  const reportDateValue = toDateOnlyUtc(reportDate);
  const chunkSize = 1_000;

  const result = await db.$transaction(
    async (tx) => {
      if (source) await lockEchoSalesDate(tx, reportDate);
      if (pairedWholesale && source) {
        const prior = await tx.echoBottleSalesDayCoverage.findUnique({ where: { reportDate: reportDateValue } });
        if (prior && (!prior.sourceAcquiredAt || prior.sourceAcquiredAt >= source.acquiredAt)) {
          throw new Error('Refusing an unordered Echo report pair.');
        }
      }
      const deleted = await tx.ohlqAnnualSalesRow.deleteMany({
        where: { reportDate: reportDateValue, ...(scopedToEcho ? { vendor: ECHO_SALES_VENDOR } : {}) },
      });

      let importedRows = 0;
      for (let index = 0; index < rowsToWrite.length; index += chunkSize) {
        const chunk = rowsToWrite.slice(index, index + chunkSize);
        const created = await tx.ohlqAnnualSalesRow.createMany({
          data: chunk,
          skipDuplicates: true,
        });
        importedRows += created.count;
      }

      if (source) {
        if (importedRows !== rowsToWrite.length) throw new Error('Incomplete sales summary insert.');
        const requestReference = pairedWholesale ? await pairedWholesale(tx) : source.requestReference;
        await publishEchoSalesCoverage(tx, reportDate, parsed.rows, { ...source, requestReference });
      }
      return {
        deletedRows: deleted.count,
        importedRows,
      };
    },
    { timeout: 120_000 },
  );

  return {
    deletedRows: result.deletedRows,
    importedRows: result.importedRows,
    parsedRows: parsed.rows.length,
    reportDate,
    skippedRows: parsed.skippedRows,
  } satisfies OhlqAnnualSalesImportResult;
}

export async function importOhlqAnnualSalesByWholesaleCsv({
  csv,
  db = prisma,
  reconcileWholesaleOrders = reconcileWholesaleOrdersAfterOhlqImport,
  reportDate,
}: {
  csv: string | Buffer;
  db?: PrismaClient;
  reconcileWholesaleOrders?: ReconcileWholesaleOrders;
  reportDate: string;
}) {
  const parsed = parseOhlqAnnualSalesByWholesaleCsv(csv, reportDate);
  if (parsed.skippedRows > 0) {
    throw new Error(
      `OHLQ wholesale CSV is incomplete: ${parsed.skippedRows} row(s) are missing agency, vendor, item, or permit identity.`,
    );
  }
  const reportDateValue = toDateOnlyUtc(reportDate);
  const chunkSize = 1_000;

  const result = await db.$transaction(
    async (tx) => {
      await lockWholesaleOrderLifecycle(tx);
      const deleted = await tx.ohlqAnnualSalesByWholesaleRow.deleteMany({
        where: { reportDate: reportDateValue },
      });

      let importedRows = 0;
      for (let index = 0; index < parsed.rows.length; index += chunkSize) {
        const chunk = parsed.rows.slice(index, index + chunkSize);
        const created = await tx.ohlqAnnualSalesByWholesaleRow.createMany({
          data: chunk,
          skipDuplicates: true,
        });
        importedRows += created.count;
      }

      return {
        deletedRows: deleted.count,
        importedRows,
      };
    },
    { maxWait: 10_000, timeout: 120_000 },
  );
  const wholesaleOrderReconciliation = await reconcileWholesaleOrders({ db });
  const echoPurchaseState = await syncWholesaleAccountEchoPurchaseState({
    db,
    rows: toWholesalePurchaseStateRows(parsed.rows),
  });

  return {
    deletedRows: result.deletedRows,
    echoPurchaseState,
    importedRows: result.importedRows,
    parsedRows: parsed.rows.length,
    reportDate,
    skippedRows: parsed.skippedRows,
    wholesaleOrderReconciliation,
  } satisfies OhlqAnnualSalesByWholesaleImportResult;
}
