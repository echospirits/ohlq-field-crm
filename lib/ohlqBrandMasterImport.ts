import { Prisma, type PrismaClient } from '@prisma/client';
import Papa from 'papaparse';
import { prisma } from './prisma';

const REQUIRED_HEADERS = [
  'RetailPrice',
  'WholesalePrice',
  'VENDOR',
  'BROKER',
  'itemnumber',
  'searchname',
  'productcategoryname',
  'purchaseunitsymbol',
  'productvolume',
  'solitemstatuscode',
  'BottleLimit',
] as const;

type RawBrandMasterRow = Record<(typeof REQUIRED_HEADERS)[number], string>;
type CsvParseResult<T> = {
  data: T[];
  errors: Array<{ message: string }>;
  meta: { fields?: string[] };
};

export type OhlqBrandMasterImportResult = {
  deletedRows: number;
  importedRows: number;
  parsedRows: number;
  skippedRows: number;
};

const clean = (value: string | null | undefined) => {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
};

const normalizeItemCode = (value: string | null | undefined) => clean(value)?.toUpperCase() ?? null;

const toDecimal = (value: string | null | undefined) => {
  const normalized = clean(value)?.replace(/[$,]/g, '');
  if (!normalized) return null;

  try {
    return new Prisma.Decimal(normalized);
  } catch {
    throw new Error(`Invalid decimal value in OHLQ brand master CSV: ${value}`);
  }
};

const toInt = (value: string | null | undefined) => {
  const normalized = clean(value)?.replace(/,/g, '');
  if (!normalized) return null;

  const parsed = Number.parseInt(normalized, 10);
  if (Number.isNaN(parsed)) throw new Error(`Invalid integer value in OHLQ brand master CSV: ${value}`);
  return parsed;
};

export function parseOhlqBrandMasterCsv(csv: string | Buffer) {
  const parsed = Papa.parse(csv.toString('utf8'), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim().replace(/^\uFEFF/, ''),
  }) as CsvParseResult<RawBrandMasterRow>;

  if (parsed.errors.length > 0) {
    const firstError = parsed.errors[0];
    throw new Error(`Unable to parse OHLQ brand master CSV: ${firstError.message}`);
  }

  const headers = new Set(parsed.meta.fields ?? []);
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.has(header));
  if (missingHeaders.length > 0) {
    throw new Error(`OHLQ brand master CSV is missing required header(s): ${missingHeaders.join(', ')}`);
  }

  const data = new Map<string, Prisma.OhlqBrandMasterItemCreateManyInput>();
  let skippedRows = 0;

  for (const row of parsed.data) {
    const itemCode = normalizeItemCode(row.itemnumber);
    const name = clean(row.searchname);

    if (!itemCode || !name) {
      skippedRows += 1;
      continue;
    }

    data.set(itemCode, {
      bottleLimit: toInt(row.BottleLimit),
      broker: clean(row.BROKER),
      category: clean(row.productcategoryname),
      itemCode,
      name,
      productVolume: toDecimal(row.productvolume),
      purchaseUnitSymbol: clean(row.purchaseunitsymbol),
      retailPrice: toDecimal(row.RetailPrice),
      solItemStatusCode: clean(row.solitemstatuscode),
      vendor: clean(row.VENDOR),
      wholesalePrice: toDecimal(row.WholesalePrice),
    });
  }

  return {
    rows: Array.from(data.values()),
    skippedRows,
  };
}

export async function importOhlqBrandMasterCsv({
  csv,
  db = prisma,
}: {
  csv: string | Buffer;
  db?: PrismaClient;
}) {
  const parsed = parseOhlqBrandMasterCsv(csv);
  const chunkSize = 1_000;

  const result = await db.$transaction(
    async (tx) => {
      const deleted = await tx.ohlqBrandMasterItem.deleteMany();

      let importedRows = 0;
      for (let index = 0; index < parsed.rows.length; index += chunkSize) {
        const chunk = parsed.rows.slice(index, index + chunkSize);
        const created = await tx.ohlqBrandMasterItem.createMany({
          data: chunk,
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
    skippedRows: parsed.skippedRows,
  } satisfies OhlqBrandMasterImportResult;
}
