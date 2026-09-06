import { Prisma, type PrismaClient } from '@prisma/client';
import Papa from 'papaparse';
import { discoverProductsForOrganizations } from './organizationProductDiscovery';
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
  createdItems: number;
  deletedRows: number;
  importedRows: number;
  organizationsScanned: number;
  parsedRows: number;
  productsDiscovered: number;
  removedItems: number;
  skippedRows: number;
  unchangedItems: number;
  updatedItems: number;
};

type BrandMasterComparable = Pick<Prisma.OhlqBrandMasterItemCreateManyInput,
  'bottleLimit' | 'broker' | 'category' | 'itemCode' | 'name' | 'productVolume' | 'purchaseUnitSymbol' |
  'retailPrice' | 'solItemStatusCode' | 'vendor' | 'wholesalePrice'>;

const comparableValue = (value: unknown) => value === null || value === undefined ? null : String(value);

const brandMasterValuesMatch = (left: BrandMasterComparable, right: BrandMasterComparable) =>
  Object.keys(left).every((key) => comparableValue(left[key as keyof BrandMasterComparable]) === comparableValue(right[key as keyof BrandMasterComparable]));

export function getOhlqBrandMasterChangeMetrics(existingRows: BrandMasterComparable[], incomingRows: BrandMasterComparable[]) {
  const existingByCode = new Map(existingRows.map((row) => [row.itemCode, row]));
  const incomingByCode = new Map(incomingRows.map((row) => [row.itemCode, row]));
  let createdItems = 0;
  let unchangedItems = 0;
  let updatedItems = 0;

  incomingByCode.forEach((row, itemCode) => {
    const existing = existingByCode.get(itemCode);
    if (!existing) createdItems += 1;
    else if (brandMasterValuesMatch(existing, row)) unchangedItems += 1;
    else updatedItems += 1;
  });

  return {
    createdItems,
    removedItems: Array.from(existingByCode.keys()).filter((itemCode) => !incomingByCode.has(itemCode)).length,
    unchangedItems,
    updatedItems,
  };
}

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
  discoverProducts = discoverProductsForOrganizations,
  minimumRows = 1_000,
}: {
  csv: string | Buffer;
  db?: PrismaClient;
  discoverProducts?: (options: { db: PrismaClient }) => Promise<{ organizationsScanned: number; productsDiscovered: number }>;
  minimumRows?: number;
}) {
  const parsed = parseOhlqBrandMasterCsv(csv);
  if (parsed.rows.length < minimumRows) {
    throw new Error(`OHLQ brand master CSV has only ${parsed.rows.length} valid items; expected at least ${minimumRows}.`);
  }
  const chunkSize = 1_000;

  const result = await db.$transaction(
    async (tx) => {
      const existingRows = await tx.ohlqBrandMasterItem.findMany({
        select: {
          bottleLimit: true, broker: true, category: true, itemCode: true, name: true, productVolume: true,
          purchaseUnitSymbol: true, retailPrice: true, solItemStatusCode: true, vendor: true, wholesalePrice: true,
        },
      });
      const changes = getOhlqBrandMasterChangeMetrics(existingRows, parsed.rows);
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
        ...changes,
        deletedRows: deleted.count,
        importedRows,
      };
    },
    { timeout: 120_000 },
  );
  const discovery = await discoverProducts({ db });

  return {
    createdItems: result.createdItems,
    deletedRows: result.deletedRows,
    importedRows: result.importedRows,
    organizationsScanned: discovery.organizationsScanned,
    parsedRows: parsed.rows.length,
    productsDiscovered: discovery.productsDiscovered,
    removedItems: result.removedItems,
    skippedRows: parsed.skippedRows,
    unchangedItems: result.unchangedItems,
    updatedItems: result.updatedItems,
  } satisfies OhlqBrandMasterImportResult;
}
