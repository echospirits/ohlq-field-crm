import { Prisma, type PrismaClient } from '@prisma/client';
import Papa from 'papaparse';
import { prisma } from './prisma';

const REQUIRED_HEADERS = [
  'District',
  'Agency_Id',
  'Agency_Name',
  'Vendor',
  'Brand',
  'Name',
  'Category',
  'Retail_Bottles_Sold',
  'Retail_Amount',
  'Retail_Tax',
  'Wholesale_Bottles_Sold',
  'Wholesale_Amount',
  'Wholesale_Tax',
] as const;

type RawAnnualSalesRow = Record<(typeof REQUIRED_HEADERS)[number], string>;
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

const required = (row: RawAnnualSalesRow, key: keyof RawAnnualSalesRow) => {
  const value = clean(row[key]);
  if (!value) throw new Error(`Missing required OHLQ CSV value: ${key}`);
  return value;
};

const toInt = (value: string | null | undefined) => {
  const normalized = clean(value)?.replace(/,/g, '');
  if (!normalized) return 0;
  const parsed = Number.parseInt(normalized, 10);
  if (Number.isNaN(parsed)) throw new Error(`Invalid integer value in OHLQ CSV: ${value}`);
  return parsed;
};

const toDecimalString = (value: string | null | undefined) => {
  const normalized = clean(value)?.replace(/[$,]/g, '');
  if (!normalized) return '0';
  const parsed = Number(normalized);
  if (Number.isNaN(parsed)) throw new Error(`Invalid money value in OHLQ CSV: ${value}`);
  return normalized;
};

export function parseOhlqAnnualSalesCsv(csv: string | Buffer, reportDateIso: string) {
  const reportDate = toDateOnlyUtc(reportDateIso);
  const parsed = Papa.parse(csv.toString('utf8'), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim(),
  }) as CsvParseResult<RawAnnualSalesRow>;

  if (parsed.errors.length > 0) {
    const firstError = parsed.errors[0];
    throw new Error(`Unable to parse OHLQ CSV: ${firstError.message}`);
  }

  const headers = new Set(parsed.meta.fields ?? []);
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.has(header));
  if (missingHeaders.length > 0) {
    throw new Error(`OHLQ CSV is missing required header(s): ${missingHeaders.join(', ')}`);
  }

  const data = new Map<string, Prisma.OhlqAnnualSalesRowCreateManyInput>();
  let skippedRows = 0;

  for (const row of parsed.data) {
    const agencyId = clean(row.Agency_Id);
    const vendor = clean(row.Vendor);
    const brand = clean(row.Brand);

    if (!agencyId || !vendor || !brand) {
      skippedRows += 1;
      continue;
    }

    data.set(`${reportDateIso}:${agencyId}:${vendor}:${brand}`, {
      agencyId,
      agencyName: required(row, 'Agency_Name'),
      brand,
      category: clean(row.Category),
      district: clean(row.District),
      name: required(row, 'Name'),
      reportDate,
      retailAmount: toDecimalString(row.Retail_Amount),
      retailBottlesSold: toInt(row.Retail_Bottles_Sold),
      retailTax: toDecimalString(row.Retail_Tax),
      vendor,
      wholesaleAmount: toDecimalString(row.Wholesale_Amount),
      wholesaleBottlesSold: toInt(row.Wholesale_Bottles_Sold),
      wholesaleTax: toDecimalString(row.Wholesale_Tax),
    });
  }

  return {
    rows: Array.from(data.values()),
    skippedRows,
  };
}

export async function importOhlqAnnualSalesCsv({
  csv,
  db = prisma,
  reportDate,
}: {
  csv: string | Buffer;
  db?: PrismaClient;
  reportDate: string;
}) {
  const parsed = parseOhlqAnnualSalesCsv(csv, reportDate);
  const reportDateValue = toDateOnlyUtc(reportDate);
  const chunkSize = 1_000;

  const result = await db.$transaction(
    async (tx) => {
      const deleted = await tx.ohlqAnnualSalesRow.deleteMany({
        where: { reportDate: reportDateValue },
      });

      let importedRows = 0;
      for (let index = 0; index < parsed.rows.length; index += chunkSize) {
        const chunk = parsed.rows.slice(index, index + chunkSize);
        const created = await tx.ohlqAnnualSalesRow.createMany({
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
