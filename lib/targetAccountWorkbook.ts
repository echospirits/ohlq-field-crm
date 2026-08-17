import { createHash } from 'crypto';
import path from 'path';
import {
  TargetOpportunityType,
  type TargetOpportunityType as TargetOpportunityTypeValue,
} from '@prisma/client';
import JSZip from 'jszip';
import { normalizeWholesaleLicenseeId } from './wholesaleAccounts';

export const DEFAULT_TARGET_MODEL_VERSION = 'central-ohio-2026-ytd';

export const DEFAULT_TARGET_MODEL_PERIOD = {
  end: new Date('2026-06-30T00:00:00.000Z'),
  scoringDate: new Date('2026-07-14T00:00:00.000Z'),
  start: new Date('2026-01-01T00:00:00.000Z'),
};

const REQUIRED_SHEETS = [
  'Top Prospects',
  'Research Queue',
  'Existing Growth',
  'Chain Opportunities',
  'All Active Central',
  'ETOHIO Portfolio',
] as const;

type RequiredSheetName = (typeof REQUIRED_SHEETS)[number];

type RowValue = string | number | boolean | Date | null | undefined;
type WorkbookRow = Record<string, RowValue>;
type ParsedCell = {
  formula: boolean;
  value: RowValue;
};
type Worksheet = {
  columnCount: number;
  dimension: string;
  formulaCount: number;
  name: string;
  rowCount: number;
  rows: Map<number, Map<number, ParsedCell>>;
};
type Workbook = {
  getWorksheet: (name: string) => Worksheet | undefined;
  worksheets: Worksheet[];
};

type ColumnDefinition = {
  aliases?: string[];
  required?: boolean;
};

type SheetDefinition = {
  headerRow?: number;
  columns: Record<string, ColumnDefinition>;
};

export type SheetMapping = {
  columns: Array<{
    key: string;
    matchedHeader: string | null;
    required: boolean;
  }>;
  extraColumns: string[];
  missingRequired: string[];
  missingOptional: string[];
  rowCount: number;
  sheetName: string;
};

export type WorkbookSummarySheet = {
  dimension: string;
  formulaCount: number;
  name: string;
};

export type TargetWorkbookWarning = {
  detail: string;
  sheetName?: string;
};

export type TargetWorkbookFailedRow = {
  message: string;
  row: Record<string, unknown>;
  rowNumber?: number;
  sheetName: string;
};

export type PortfolioSku = {
  brandSearchName: string;
  category: string;
  coreCoverageFile: string | null;
  itemCode: string;
  retailPrice: number | null;
  statusCode: string | null;
  volumeOz: number | null;
  wholesalePrice: number | null;
};

export type TargetAccountImportRow = {
  accountName: string;
  accountType: string | null;
  address: string | null;
  avgMonthly9L: number;
  baselineRank: number | null;
  blendedScore: number | null;
  buysOtherOhioCraft: boolean;
  categoryWhitespacePercent: number | null;
  city: string | null;
  cocktailFocus: string | null;
  cocktailMenuUrl: string | null;
  consistencyScore: number | null;
  cordial9L: number;
  currentEtohioCategories: string[];
  dataScore: number | null;
  etohioItems: number;
  etohioVolume9L: number;
  eventsGroups: string | null;
  existingBuyer: boolean;
  existingOhioCraftPercentile: number | null;
  expansionScore: number | null;
  fitVolumePercentile: number | null;
  locationConfidence: string | null;
  localBrandsOnMenu: string[];
  mapsSearchUrl: string | null;
  missingCategories: string[];
  momentumScore: number | null;
  monthsActive: number;
  ohioCraftAffinityScore: number | null;
  ohioCraftVolumePercentile: number | null;
  otherOhioCraft9L: number;
  otherOhioCraftVendors: number;
  ownership: string | null;
  isNationalChain: boolean | null;
  patioOutdoor: string | null;
  permitNumber: string;
  popularitySignal: string | null;
  googleRating: number | null;
  googleReviewCount: number | null;
  portfolioCategory9L: number;
  portfolioPriceMedian: number | null;
  portfolioVolumePercentile: number | null;
  premiumBottleSharePercent: number;
  priceFit9L: number;
  priceFitPercent: number;
  priorityTier: string | null;
  publicFitScore: number | null;
  researchNotes: string | null;
  researchStatus: string | null;
  rowNumber: number;
  rum9L: number;
  sourceRowHash: string;
  sourceSheet: 'Top Prospects' | 'Existing Growth';
  sourceUrls: string[];
  strategicFlag: string | null;
  total9LCases: number;
  totalVolumePercentile: number | null;
  websiteUrl: string | null;
  vodka9L: number;
  whiskey9L: number;
  wholesaleSpend: number;
  zip: string | null;
  yelpRating: number | null;
  yelpReviewCount: number | null;
};

export type TargetRecommendation = {
  category: string | null;
  confidence: string;
  currentCategoryVolume9L: number;
  estimatedMonthlyPotential: number;
  itemCode: string | null;
  opportunityType: TargetOpportunityTypeValue;
  productName: string;
  recommendedNextAction: string;
  reasons: string[];
  score: number;
};

export type ChainOpportunityImportRow = {
  aggregateVolume9L: number;
  avgDataScore: number | null;
  chainLeverageScore: number | null;
  currentEtohioLocations: number;
  currentEtohioVolume9L: number;
  locationReview: string | null;
  locations: string[];
  maxDataScore: number | null;
  name: string;
  otherOhioCraft9L: number;
  priceFit9L: number;
  rowNumber: number;
  strategicNote: string | null;
  totalLocations: number;
  unservedLocations: number;
};

export type ResearchQueueImportRow = {
  accountName: string;
  blendedScore: number | null;
  city: string | null;
  dataScore: number | null;
  mapsSearchUrl: string | null;
  nextAction: string | null;
  priorityTier: string | null;
  publicFitScore: number | null;
  queueRank: number | null;
  researchStatus: string | null;
  sourceUrls: string[];
  zip: string | null;
};

export type ParsedTargetWorkbook = {
  accountRows: TargetAccountImportRow[];
  chainRows: ChainOpportunityImportRow[];
  failedRows: TargetWorkbookFailedRow[];
  mappings: SheetMapping[];
  portfolioSkus: PortfolioSku[];
  researchQueueRows: ResearchQueueImportRow[];
  sourceWorkbookHash: string;
  summary: {
    sheets: WorkbookSummarySheet[];
    sheetNames: string[];
  };
  warnings: TargetWorkbookWarning[];
};

const sheetDefinitions: Record<RequiredSheetName, SheetDefinition> = {
  'Top Prospects': {
    columns: {
      accountName: { aliases: ['Account'], required: true },
      accountType: { aliases: ['Account Type'] },
      address: { aliases: ['Address'] },
      baselineRank: { aliases: ['Baseline Rank'], required: true },
      blendedScore: { aliases: ['Blended Score'], required: true },
      city: { aliases: ['City'] },
      cocktailFocus: { aliases: ['Cocktail Focus'] },
      cocktailMenuUrl: { aliases: ['Cocktail Menu URL', 'Menu URL'] },
      consistencyScore: { aliases: ['Consistency Score'] },
      cordial9L: { aliases: ['Cordial 9L'] },
      dataScore: { aliases: ['Data Score'], required: true },
      eventsGroups: { aliases: ['Events / Groups'] },
      fitVolumePercentile: { aliases: ['Fit Volume Percentile'] },
      locationConfidence: { aliases: ['Location Confidence'] },
      localBrandsOnMenu: { aliases: ['Local Brands on Menu', 'Local Spirits on Menu'] },
      mapsSearchUrl: { aliases: ['Maps Search URL'] },
      momentumScore: { aliases: ['Momentum Score'] },
      monthsActive: { aliases: ['Months Active'] },
      ohioCraftAffinityScore: { aliases: ['Ohio Craft Affinity Score'] },
      ohioCraftVolumePercentile: { aliases: ['Ohio Craft Volume Percentile'] },
      otherOhioCraft9L: { aliases: ['Other Ohio Craft 9L'] },
      otherOhioCraftVendors: { aliases: ['Other Ohio Craft Vendors'] },
      patioOutdoor: { aliases: ['Patio / Outdoor'] },
      isNationalChain: { aliases: ['National Chain', 'Is National Chain'] },
      permitNumber: { aliases: ['Permit Number', 'Licensee ID', 'OHLQ ID'], required: true },
      popularitySignal: { aliases: ['Popularity Signal'] },
      googleRating: { aliases: ['Google Rating'] },
      googleReviewCount: { aliases: ['Google Review Count', 'Google Reviews'] },
      portfolioCategory9L: { aliases: ['Portfolio Category 9L'] },
      portfolioPriceMedian: { aliases: ['Portfolio Price Median'] },
      premiumBottleSharePercent: { aliases: ['Premium Bottle Share %', 'Premium Share %'] },
      priceFit9L: { aliases: ['Price-Fit 9L', 'Price Fit 9L'] },
      priceFitPercent: { aliases: ['Price Fit %'] },
      priorityTier: { aliases: ['Priority Tier', 'Priority'], required: true },
      publicFitScore: { aliases: ['Public Fit Score', 'Public Fit'] },
      researchNotes: { aliases: ['Research Notes'] },
      researchStatus: { aliases: ['Research Status'] },
      rum9L: { aliases: ['Rum 9L'] },
      sourceUrl1: { aliases: ['Source URL 1'] },
      sourceUrl2: { aliases: ['Source URL 2'] },
      strategicFlag: { aliases: ['Strategic Flag'] },
      total9LCases: { aliases: ['Total 9L Cases', 'Total 9L'], required: true },
      totalVolumePercentile: { aliases: ['Total Volume Percentile'] },
      websiteUrl: { aliases: ['Website URL', 'Website'] },
      vodka9L: { aliases: ['Vodka 9L'] },
      whiskey9L: { aliases: ['American Whiskey 9L', 'Whiskey 9L'] },
      wholesaleSpend: { aliases: ['Wholesale Spend'] },
      zip: { aliases: ['Zip', 'ZIP'] },
      yelpRating: { aliases: ['Yelp Rating'] },
      yelpReviewCount: { aliases: ['Yelp Review Count', 'Yelp Reviews'] },
    },
  },
  'Research Queue': {
    columns: {
      accountName: { aliases: ['Account'], required: true },
      blendedScore: { aliases: ['Blended Score'] },
      city: { aliases: ['City'] },
      dataScore: { aliases: ['Data Score'] },
      mapsSearchUrl: { aliases: ['Maps Search URL'] },
      nextAction: { aliases: ['Next Action'] },
      priorityTier: { aliases: ['Priority'], required: true },
      publicFitScore: { aliases: ['Public Fit'] },
      queueRank: { aliases: ['Queue Rank'] },
      researchStatus: { aliases: ['Research Status'] },
      sourceUrl1: { aliases: ['Source URL 1'] },
      sourceUrl2: { aliases: ['Source URL 2'] },
      zip: { aliases: ['Zip', 'ZIP'] },
    },
  },
  'Existing Growth': {
    columns: {
      accountName: { aliases: ['Account'], required: true },
      accountType: { aliases: ['Account Type'] },
      baselineRank: { aliases: ['Baseline Rank'], required: true },
      buysOtherOhioCraft: { aliases: ['Buys Other Ohio Craft'] },
      categoryWhitespacePercent: { aliases: ['Category Whitespace %'] },
      city: { aliases: ['City'] },
      consistencyScore: { aliases: ['Consistency Score'] },
      currentEtohioCategories: { aliases: ['ETOHIO Categories'] },
      etohioItems: { aliases: ['ETOHIO Items'] },
      etohioVolume9L: { aliases: ['ETOHIO 9L'] },
      existingOhioCraftPercentile: { aliases: ['Existing Ohio Craft Percentile'] },
      expansionScore: { aliases: ['Expansion Score'], required: true },
      locationConfidence: { aliases: ['Location Confidence'] },
      mapsSearchUrl: { aliases: ['Maps Search URL'] },
      monthsActive: { aliases: ['Months Active'] },
      ohioCraftAffinityScore: { aliases: ['Ohio Craft Affinity'] },
      otherOhioCraft9L: { aliases: ['Other Ohio Craft 9L'] },
      permitNumber: { aliases: ['Permit Number', 'Licensee ID', 'OHLQ ID'], required: true },
      portfolioCategory9L: { aliases: ['Portfolio Category 9L'] },
      portfolioVolumePercentile: { aliases: ['Portfolio Volume Percentile'] },
      priceFit9L: { aliases: ['Price-Fit 9L', 'Price Fit 9L'] },
      priorityTier: { aliases: ['Priority'], required: true },
      strategicFlag: { aliases: ['Strategic Flag'] },
      total9LCases: { aliases: ['Total 9L', 'Total 9L Cases'], required: true },
      avgMonthly9L: { aliases: ['Avg Monthly 9L'] },
      zip: { aliases: ['Zip', 'ZIP'] },
    },
  },
  'Chain Opportunities': {
    columns: {
      aggregateVolume9L: { aliases: ['Total 9L Cases'], required: true },
      avgDataScore: { aliases: ['Avg Data Score'] },
      chainLeverageScore: { aliases: ['Chain Leverage Score'], required: true },
      currentEtohioLocations: { aliases: ['Current ETOHIO Locations'] },
      currentEtohioVolume9L: { aliases: ['ETOHIO 9L'] },
      locationReview: { aliases: ['Location Review'] },
      locations: { aliases: ['Locations'] },
      maxDataScore: { aliases: ['Max Data Score'] },
      name: { aliases: ['Ownership / Group', 'Ownership', 'Group'], required: true },
      otherOhioCraft9L: { aliases: ['Other Ohio Craft 9L'] },
      priceFit9L: { aliases: ['Price-Fit 9L'] },
      rowRank: { aliases: ['Chain Rank'] },
      strategicNote: { aliases: ['Strategic Note'] },
      totalLocations: { aliases: ['Unique Locations'], required: true },
      unservedLocations: { aliases: ['Unserved Locations'] },
    },
  },
  'All Active Central': {
    columns: {
      accountName: { aliases: ['Account'], required: true },
      ownership: { aliases: ['Ownership'] },
      permitNumber: { aliases: ['Permit Number'], required: true },
    },
  },
  'ETOHIO Portfolio': {
    columns: {
      brandSearchName: { aliases: ['Brand / Search Name'], required: true },
      category: { aliases: ['Category'], required: true },
      coreCoverageFile: { aliases: ['Core Coverage File'] },
      itemCode: { aliases: ['Item', 'Item Code'], required: true },
      retailPrice: { aliases: ['Retail Price'] },
      statusCode: { aliases: ['Status Code'] },
      volumeOz: { aliases: ['Volume oz', 'Volume Oz'] },
      wholesalePrice: { aliases: ['Wholesale Price'] },
    },
  },
};

const normalizeHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

const toText = (value: RowValue) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
};

const toNumber = (value: RowValue) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = toText(value);
  if (!text) return null;
  const parsed = Number(text.replace(/[$,%]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const toInteger = (value: RowValue) => {
  const number = toNumber(value);
  return number === null ? null : Math.round(number);
};

const toBool = (value: RowValue) => {
  const text = toText(value)?.toLowerCase();
  return text === 'yes' || text === 'true' || text === '1';
};

const toNullableBool = (value: RowValue) => toText(value) === null ? null : toBool(value);

const cleanList = (value: RowValue) =>
  (toText(value) ?? '')
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean);

const cleanUrls = (...values: RowValue[]) =>
  values
    .map(toText)
    .filter((value): value is string => Boolean(value))
    .filter((value) => /^https?:\/\//i.test(value));

const sourceHash = (row: Record<string, unknown>) =>
  createHash('sha256').update(JSON.stringify(row)).digest('hex');

export const getWorkbookHash = (buffer: Buffer) =>
  createHash('sha256').update(buffer.toString('base64')).digest('hex');

const columnLetter = (columnNumber: number) => {
  let value = '';
  let current = Math.max(1, columnNumber);

  while (current > 0) {
    const remainder = (current - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    current = Math.floor((current - 1) / 26);
  }

  return value;
};

const columnIndexFromLetters = (letters: string) =>
  letters
    .toUpperCase()
    .split('')
    .reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);

const parseCellReference = (reference: string) => {
  const match = /^([A-Z]+)(\d+)$/i.exec(reference);
  if (!match) return null;

  return {
    column: columnIndexFromLetters(match[1]),
    row: Number(match[2]),
  };
};

const decodeXmlEntities = (value: string) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)));

const parseAttributes = (source: string) => {
  const attributes: Record<string, string> = {};
  const attributeRegex = /([\w:.-]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;

  while ((match = attributeRegex.exec(source)) !== null) {
    attributes[match[1]] = decodeXmlEntities(match[2]);
  }

  return attributes;
};

const getXmlInner = (source: string, tagName: string) => {
  const match = new RegExp(`<(?:\\w+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tagName}>`).exec(source);
  return match?.[1] ?? null;
};

const parseTextRuns = (source: string) => {
  const texts: string[] = [];
  const textRegex = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g;
  let match: RegExpExecArray | null;

  while ((match = textRegex.exec(source)) !== null) {
    texts.push(decodeXmlEntities(match[1]));
  }

  return texts.join('');
};

const normalizeWorksheetTargetPath = (target: string) => {
  const normalizedTarget = target.replace(/\\/g, '/');
  if (normalizedTarget.startsWith('/')) return normalizedTarget.slice(1);
  return path.posix.normalize(path.posix.join('xl', normalizedTarget)).replace(/^\.\//, '');
};

const parseRelationships = (xml: string | null) => {
  const relationships = new Map<string, string>();
  if (!xml) return relationships;

  const relationshipRegex = /<(?:\w+:)?Relationship\b([^>]*?)\/?>/g;
  let match: RegExpExecArray | null;

  while ((match = relationshipRegex.exec(xml)) !== null) {
    const attributes = parseAttributes(match[1]);
    if (attributes.Id && attributes.Target) {
      relationships.set(attributes.Id, normalizeWorksheetTargetPath(attributes.Target));
    }
  }

  return relationships;
};

const parseSharedStrings = (xml: string | null) => {
  if (!xml) return [];

  const sharedStrings: string[] = [];
  const stringRegex = /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g;
  let match: RegExpExecArray | null;

  while ((match = stringRegex.exec(xml)) !== null) {
    sharedStrings.push(parseTextRuns(match[1]));
  }

  return sharedStrings;
};

const parseCellValue = (content: string, type: string | undefined, sharedStrings: string[]): RowValue => {
  if (type === 'inlineStr') return toText(parseTextRuns(content));

  const rawValue = getXmlInner(content, 'v');
  if (rawValue === null) return null;

  const decodedValue = decodeXmlEntities(rawValue);
  if (type === 's') return sharedStrings[Number(decodedValue)] ?? null;
  if (type === 'b') return decodedValue === '1';
  if (type === 'd') {
    const date = new Date(decodedValue);
    return Number.isNaN(date.getTime()) ? decodedValue : date;
  }
  if (type === 'str' || type === 'e') return decodedValue;

  const number = Number(decodedValue);
  return Number.isFinite(number) ? number : decodedValue;
};

const parseWorksheet = (name: string, xml: string, sharedStrings: string[]): Worksheet => {
  const dimension = parseAttributes(/<(?:\w+:)?dimension\b([^>]*?)\/?>/.exec(xml)?.[1] ?? '').ref ?? 'A1';
  const rows = new Map<number, Map<number, ParsedCell>>();
  const cellRegex = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
  let match: RegExpExecArray | null;
  let rowCount = 0;
  let columnCount = 0;
  let formulaCount = 0;

  while ((match = cellRegex.exec(xml)) !== null) {
    const attributes = parseAttributes(match[1]);
    const reference = attributes.r ? parseCellReference(attributes.r) : null;
    if (!reference) continue;

    const content = match[2] ?? '';
    const formula = /<(?:\w+:)?f\b/.test(content);
    const value = parseCellValue(content, attributes.t, sharedStrings);
    let row = rows.get(reference.row);

    if (!row) {
      row = new Map<number, ParsedCell>();
      rows.set(reference.row, row);
    }

    row.set(reference.column, { formula, value });
    rowCount = Math.max(rowCount, reference.row);
    columnCount = Math.max(columnCount, reference.column);
    if (formula) formulaCount += 1;
  }

  return {
    columnCount: Math.max(columnCount, 1),
    dimension: dimension === 'A1' ? `A1:${columnLetter(Math.max(columnCount, 1))}${Math.max(rowCount, 1)}` : dimension,
    formulaCount,
    name,
    rowCount: Math.max(rowCount, 1),
    rows,
  };
};

const parseWorkbookSheets = (workbookXml: string, relationships: Map<string, string>) => {
  const sheets: Array<{ name: string; path: string }> = [];
  const sheetRegex = /<(?:\w+:)?sheet\b([^>]*?)(?:\/>|>[\s\S]*?<\/(?:\w+:)?sheet>)/g;
  let match: RegExpExecArray | null;

  while ((match = sheetRegex.exec(workbookXml)) !== null) {
    const attributes = parseAttributes(match[1]);
    const relationshipId = attributes['r:id'] ?? attributes.id;
    const targetPath = relationshipId ? relationships.get(relationshipId) : null;
    if (attributes.name && targetPath) {
      sheets.push({ name: attributes.name, path: targetPath });
    }
  }

  return sheets;
};

const readZipText = async (zip: JSZip, entryPath: string) => {
  const entry = zip.file(entryPath);
  return entry ? entry.async('string') : null;
};

const readWorkbook = async (buffer: Buffer): Promise<Workbook> => {
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  const zip = await JSZip.loadAsync(new Uint8Array(arrayBuffer));
  const workbookXml = await readZipText(zip, 'xl/workbook.xml');
  if (!workbookXml) throw new Error('Workbook is missing xl/workbook.xml.');

  const relationships = parseRelationships(await readZipText(zip, 'xl/_rels/workbook.xml.rels'));
  const sharedStrings = parseSharedStrings(await readZipText(zip, 'xl/sharedStrings.xml'));
  const worksheets = (
    await Promise.all(
      parseWorkbookSheets(workbookXml, relationships).map(async (sheet) => {
        const worksheetXml = await readZipText(zip, sheet.path);
        return worksheetXml ? parseWorksheet(sheet.name, worksheetXml, sharedStrings) : null;
      }),
    )
  ).filter((worksheet): worksheet is Worksheet => Boolean(worksheet));
  const worksheetsByName = new Map(worksheets.map((worksheet) => [worksheet.name, worksheet]));

  return {
    getWorksheet: (name: string) => worksheetsByName.get(name),
    worksheets,
  };
};

const worksheetColumnLimit = (worksheet: Worksheet) => Math.max(worksheet.columnCount, 1);

const getWorksheetCellValue = (worksheet: Worksheet, rowNumber: number, columnNumber: number) =>
  worksheet.rows.get(rowNumber)?.get(columnNumber)?.value ?? null;

const getWorksheetDimension = (worksheet: Worksheet) => worksheet.dimension;

const hasUsableValue = (value: RowValue) =>
  value instanceof Date ||
  typeof value === 'boolean' ||
  typeof value === 'number' ||
  Boolean(toText(value));

const getFormulaCount = (worksheet: Worksheet) => worksheet.formulaCount;

const getHeaderNames = (worksheet: Worksheet, headerRow = 1) => {
  const headers: string[] = [];

  for (let column = 1; column <= worksheetColumnLimit(worksheet); column += 1) {
    const header = toText(getWorksheetCellValue(worksheet, headerRow, column));
    if (header) headers.push(header);
  }

  return headers;
};

const getSheetRows = (worksheet: Worksheet, headerRow = 1) => {
  const headerCells: Array<{ column: number; header: string }> = [];

  for (let column = 1; column <= worksheetColumnLimit(worksheet); column += 1) {
    const headerName = toText(getWorksheetCellValue(worksheet, headerRow, column));
    if (headerName) headerCells.push({ column, header: headerName });
  }

  const rows: WorkbookRow[] = [];
  for (let rowNumber = headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row: WorkbookRow = {};
    let hasValue = false;

    headerCells.forEach(({ column, header: headerName }) => {
      const value = getWorksheetCellValue(worksheet, rowNumber, column);
      row[headerName] = value ?? null;
      if (hasUsableValue(value)) hasValue = true;
    });

    if (hasValue) rows.push(row);
  }

  return rows;
};

const buildMapping = (
  sheetName: string,
  worksheet: Worksheet | undefined,
  definition: SheetDefinition,
): SheetMapping => {
  if (!worksheet) {
    const columns = Object.entries(definition.columns).map(([key, column]) => ({
      key,
      matchedHeader: null,
      required: Boolean(column.required),
    }));

    return {
      columns,
      extraColumns: [],
      missingOptional: columns.filter((column) => !column.required).map((column) => column.key),
      missingRequired: columns.filter((column) => column.required).map((column) => column.key),
      rowCount: 0,
      sheetName,
    };
  }

  const headerNames = getHeaderNames(worksheet, definition.headerRow);
  const headerByNormalized = new Map(headerNames.map((header) => [normalizeHeader(header), header]));
  const matchedHeaders = new Set<string>();
  const columns = Object.entries(definition.columns).map(([key, column]) => {
    const aliases = [key, ...(column.aliases ?? [])];
    const matchedHeader =
      aliases.map((alias) => headerByNormalized.get(normalizeHeader(alias))).find(Boolean) ?? null;

    if (matchedHeader) matchedHeaders.add(matchedHeader);

    return {
      key,
      matchedHeader,
      required: Boolean(column.required),
    };
  });

  return {
    columns,
    extraColumns: headerNames.filter((header) => !matchedHeaders.has(header)),
    missingOptional: columns
      .filter((column) => !column.required && !column.matchedHeader)
      .map((column) => column.key),
    missingRequired: columns
      .filter((column) => column.required && !column.matchedHeader)
      .map((column) => column.key),
    rowCount: getSheetRows(worksheet, definition.headerRow).length,
    sheetName,
  };
};

const getMappedValue = (row: WorkbookRow, mapping: SheetMapping, key: string): RowValue => {
  const header = mapping.columns.find((column) => column.key === key)?.matchedHeader;
  return header ? row[header] : null;
};

const getAllActiveOwnershipByPermit = (workbook: Workbook, mapping: SheetMapping) => {
  const worksheet = workbook.getWorksheet('All Active Central');
  if (!worksheet) return new Map<string, string>();

  const rows = getSheetRows(worksheet, sheetDefinitions['All Active Central'].headerRow);
  const ownershipByPermit = new Map<string, string>();

  rows.forEach((row) => {
    const permit = normalizeWholesaleLicenseeId(toText(getMappedValue(row, mapping, 'permitNumber')));
    const ownership = toText(getMappedValue(row, mapping, 'ownership'));

    if (permit && ownership) {
      ownershipByPermit.set(permit, ownership);
    }
  });

  return ownershipByPermit;
};

const readPortfolioSkus = (
  workbook: Workbook,
  mapping: SheetMapping,
  failedRows: TargetWorkbookFailedRow[],
): PortfolioSku[] => {
  const worksheet = workbook.getWorksheet('ETOHIO Portfolio');
  if (!worksheet || mapping.missingRequired.length > 0) return [];

  return getSheetRows(worksheet, sheetDefinitions['ETOHIO Portfolio'].headerRow)
    .map((row, index) => {
      const itemCode = toText(getMappedValue(row, mapping, 'itemCode'));
      const brandSearchName = toText(getMappedValue(row, mapping, 'brandSearchName'));
      const category = toText(getMappedValue(row, mapping, 'category'));

      if (!itemCode || !brandSearchName || !category) {
        failedRows.push({
          message: 'Portfolio row is missing item, brand/search name, or category.',
          row,
          rowNumber: index + 2,
          sheetName: 'ETOHIO Portfolio',
        });
        return null;
      }

      return {
        brandSearchName,
        category,
        coreCoverageFile: toText(getMappedValue(row, mapping, 'coreCoverageFile')),
        itemCode,
        retailPrice: toNumber(getMappedValue(row, mapping, 'retailPrice')),
        statusCode: toText(getMappedValue(row, mapping, 'statusCode')),
        volumeOz: toNumber(getMappedValue(row, mapping, 'volumeOz')),
        wholesalePrice: toNumber(getMappedValue(row, mapping, 'wholesalePrice')),
      };
    })
    .filter((row): row is PortfolioSku => Boolean(row));
};

const toAccountRow = ({
  row,
  rowNumber,
  mapping,
  ownershipByPermit,
  sourceSheet,
}: {
  mapping: SheetMapping;
  ownershipByPermit: Map<string, string>;
  row: WorkbookRow;
  rowNumber: number;
  sourceSheet: 'Top Prospects' | 'Existing Growth';
}): TargetAccountImportRow | TargetWorkbookFailedRow => {
  const permitNumber = normalizeWholesaleLicenseeId(toText(getMappedValue(row, mapping, 'permitNumber')));
  const accountName = toText(getMappedValue(row, mapping, 'accountName'));

  if (!permitNumber || !accountName) {
    return {
      message: 'Target account row is missing Account or Permit Number.',
      row,
      rowNumber,
      sheetName: sourceSheet,
    };
  }

  const currentEtohioCategories = cleanList(getMappedValue(row, mapping, 'currentEtohioCategories'));
  const common = {
    accountName,
    accountType: toText(getMappedValue(row, mapping, 'accountType')),
    address: toText(getMappedValue(row, mapping, 'address')),
    avgMonthly9L: toNumber(getMappedValue(row, mapping, 'avgMonthly9L')) ?? 0,
    baselineRank: toInteger(getMappedValue(row, mapping, 'baselineRank')),
    blendedScore: toNumber(getMappedValue(row, mapping, 'blendedScore')),
    buysOtherOhioCraft: toBool(getMappedValue(row, mapping, 'buysOtherOhioCraft')),
    categoryWhitespacePercent: toNumber(getMappedValue(row, mapping, 'categoryWhitespacePercent')),
    city: toText(getMappedValue(row, mapping, 'city')),
    cocktailFocus: toText(getMappedValue(row, mapping, 'cocktailFocus')),
    cocktailMenuUrl: toText(getMappedValue(row, mapping, 'cocktailMenuUrl')),
    consistencyScore: toNumber(getMappedValue(row, mapping, 'consistencyScore')),
    cordial9L: toNumber(getMappedValue(row, mapping, 'cordial9L')) ?? 0,
    currentEtohioCategories,
    dataScore: toNumber(getMappedValue(row, mapping, 'dataScore')),
    etohioItems: toInteger(getMappedValue(row, mapping, 'etohioItems')) ?? 0,
    etohioVolume9L: toNumber(getMappedValue(row, mapping, 'etohioVolume9L')) ?? 0,
    eventsGroups: toText(getMappedValue(row, mapping, 'eventsGroups')),
    existingBuyer: sourceSheet === 'Existing Growth',
    existingOhioCraftPercentile: toNumber(getMappedValue(row, mapping, 'existingOhioCraftPercentile')),
    expansionScore: toNumber(getMappedValue(row, mapping, 'expansionScore')),
    fitVolumePercentile: toNumber(getMappedValue(row, mapping, 'fitVolumePercentile')),
    locationConfidence: toText(getMappedValue(row, mapping, 'locationConfidence')),
    localBrandsOnMenu: cleanList(getMappedValue(row, mapping, 'localBrandsOnMenu')),
    mapsSearchUrl: toText(getMappedValue(row, mapping, 'mapsSearchUrl')),
    missingCategories: [] as string[],
    momentumScore: toNumber(getMappedValue(row, mapping, 'momentumScore')),
    monthsActive: toInteger(getMappedValue(row, mapping, 'monthsActive')) ?? 0,
    ohioCraftAffinityScore: toNumber(getMappedValue(row, mapping, 'ohioCraftAffinityScore')),
    ohioCraftVolumePercentile: toNumber(getMappedValue(row, mapping, 'ohioCraftVolumePercentile')),
    otherOhioCraft9L: toNumber(getMappedValue(row, mapping, 'otherOhioCraft9L')) ?? 0,
    otherOhioCraftVendors: toInteger(getMappedValue(row, mapping, 'otherOhioCraftVendors')) ?? 0,
    ownership: ownershipByPermit.get(permitNumber) ?? null,
    isNationalChain: toNullableBool(getMappedValue(row, mapping, 'isNationalChain')),
    patioOutdoor: toText(getMappedValue(row, mapping, 'patioOutdoor')),
    permitNumber,
    popularitySignal: toText(getMappedValue(row, mapping, 'popularitySignal')),
    googleRating: toNumber(getMappedValue(row, mapping, 'googleRating')),
    googleReviewCount: toInteger(getMappedValue(row, mapping, 'googleReviewCount')),
    portfolioCategory9L: toNumber(getMappedValue(row, mapping, 'portfolioCategory9L')) ?? 0,
    portfolioPriceMedian: toNumber(getMappedValue(row, mapping, 'portfolioPriceMedian')),
    portfolioVolumePercentile: toNumber(getMappedValue(row, mapping, 'portfolioVolumePercentile')),
    premiumBottleSharePercent: toNumber(getMappedValue(row, mapping, 'premiumBottleSharePercent')) ?? 0,
    priceFit9L: toNumber(getMappedValue(row, mapping, 'priceFit9L')) ?? 0,
    priceFitPercent: toNumber(getMappedValue(row, mapping, 'priceFitPercent')) ?? 0,
    priorityTier: toText(getMappedValue(row, mapping, 'priorityTier')),
    publicFitScore: toNumber(getMappedValue(row, mapping, 'publicFitScore')),
    researchNotes: toText(getMappedValue(row, mapping, 'researchNotes')),
    researchStatus: toText(getMappedValue(row, mapping, 'researchStatus')),
    rowNumber,
    rum9L: toNumber(getMappedValue(row, mapping, 'rum9L')) ?? 0,
    sourceRowHash: sourceHash({ row, sourceSheet }),
    sourceSheet,
    sourceUrls: cleanUrls(
      getMappedValue(row, mapping, 'mapsSearchUrl'),
      getMappedValue(row, mapping, 'websiteUrl'),
      getMappedValue(row, mapping, 'cocktailMenuUrl'),
      getMappedValue(row, mapping, 'sourceUrl1'),
      getMappedValue(row, mapping, 'sourceUrl2'),
    ),
    strategicFlag: toText(getMappedValue(row, mapping, 'strategicFlag')),
    total9LCases: toNumber(getMappedValue(row, mapping, 'total9LCases')) ?? 0,
    totalVolumePercentile: toNumber(getMappedValue(row, mapping, 'totalVolumePercentile')),
    websiteUrl: toText(getMappedValue(row, mapping, 'websiteUrl')),
    vodka9L: toNumber(getMappedValue(row, mapping, 'vodka9L')) ?? 0,
    whiskey9L: toNumber(getMappedValue(row, mapping, 'whiskey9L')) ?? 0,
    wholesaleSpend: toNumber(getMappedValue(row, mapping, 'wholesaleSpend')) ?? 0,
    zip: toText(getMappedValue(row, mapping, 'zip')),
    yelpRating: toNumber(getMappedValue(row, mapping, 'yelpRating')),
    yelpReviewCount: toInteger(getMappedValue(row, mapping, 'yelpReviewCount')),
  };

  return common;
};

const readAccountRows = (
  workbook: Workbook,
  mappingsBySheet: Map<string, SheetMapping>,
  ownershipByPermit: Map<string, string>,
  failedRows: TargetWorkbookFailedRow[],
) => {
  const rows: TargetAccountImportRow[] = [];

  (['Top Prospects', 'Existing Growth'] as const).forEach((sheetName) => {
    const worksheet = workbook.getWorksheet(sheetName);
    const mapping = mappingsBySheet.get(sheetName);
    if (!worksheet || !mapping || mapping.missingRequired.length > 0) return;

    getSheetRows(worksheet, sheetDefinitions[sheetName].headerRow).forEach((row, index) => {
      const parsed = toAccountRow({
        mapping,
        ownershipByPermit,
        row,
        rowNumber: index + 2,
        sourceSheet: sheetName,
      });

      if ('message' in parsed) {
        failedRows.push(parsed);
      } else {
        rows.push(parsed);
      }
    });
  });

  return rows;
};

const readChainRows = (
  workbook: Workbook,
  mapping: SheetMapping,
  failedRows: TargetWorkbookFailedRow[],
): ChainOpportunityImportRow[] => {
  const worksheet = workbook.getWorksheet('Chain Opportunities');
  if (!worksheet || mapping.missingRequired.length > 0) return [];

  return getSheetRows(worksheet, sheetDefinitions['Chain Opportunities'].headerRow)
    .map((row, index) => {
      const name = toText(getMappedValue(row, mapping, 'name'));
      if (!name) {
        failedRows.push({
          message: 'Chain opportunity row is missing ownership/group name.',
          row,
          rowNumber: index + 2,
          sheetName: 'Chain Opportunities',
        });
        return null;
      }

      return {
        aggregateVolume9L: toNumber(getMappedValue(row, mapping, 'aggregateVolume9L')) ?? 0,
        avgDataScore: toNumber(getMappedValue(row, mapping, 'avgDataScore')),
        chainLeverageScore: toNumber(getMappedValue(row, mapping, 'chainLeverageScore')),
        currentEtohioLocations: toInteger(getMappedValue(row, mapping, 'currentEtohioLocations')) ?? 0,
        currentEtohioVolume9L: toNumber(getMappedValue(row, mapping, 'currentEtohioVolume9L')) ?? 0,
        locationReview: toText(getMappedValue(row, mapping, 'locationReview')),
        locations: cleanList(getMappedValue(row, mapping, 'locations')),
        maxDataScore: toNumber(getMappedValue(row, mapping, 'maxDataScore')),
        name,
        otherOhioCraft9L: toNumber(getMappedValue(row, mapping, 'otherOhioCraft9L')) ?? 0,
        priceFit9L: toNumber(getMappedValue(row, mapping, 'priceFit9L')) ?? 0,
        rowNumber: index + 2,
        strategicNote: toText(getMappedValue(row, mapping, 'strategicNote')),
        totalLocations: toInteger(getMappedValue(row, mapping, 'totalLocations')) ?? 0,
        unservedLocations: toInteger(getMappedValue(row, mapping, 'unservedLocations')) ?? 0,
      };
    })
    .filter((row): row is ChainOpportunityImportRow => Boolean(row));
};

const readResearchQueueRows = (workbook: Workbook, mapping: SheetMapping): ResearchQueueImportRow[] => {
  const worksheet = workbook.getWorksheet('Research Queue');
  if (!worksheet || mapping.missingRequired.length > 0) return [];

  return getSheetRows(worksheet, sheetDefinitions['Research Queue'].headerRow)
    .map((row) => ({
      accountName: toText(getMappedValue(row, mapping, 'accountName')) ?? '',
      blendedScore: toNumber(getMappedValue(row, mapping, 'blendedScore')),
      city: toText(getMappedValue(row, mapping, 'city')),
      dataScore: toNumber(getMappedValue(row, mapping, 'dataScore')),
      mapsSearchUrl: toText(getMappedValue(row, mapping, 'mapsSearchUrl')),
      nextAction: toText(getMappedValue(row, mapping, 'nextAction')),
      priorityTier: toText(getMappedValue(row, mapping, 'priorityTier')),
      publicFitScore: toNumber(getMappedValue(row, mapping, 'publicFitScore')),
      queueRank: toInteger(getMappedValue(row, mapping, 'queueRank')),
      researchStatus: toText(getMappedValue(row, mapping, 'researchStatus')),
      sourceUrls: cleanUrls(
        getMappedValue(row, mapping, 'mapsSearchUrl'),
        getMappedValue(row, mapping, 'sourceUrl1'),
        getMappedValue(row, mapping, 'sourceUrl2'),
      ),
      zip: toText(getMappedValue(row, mapping, 'zip')),
    }))
    .filter((row) => row.accountName);
};

export const buildScoreExplanation = (row: TargetAccountImportRow) => {
  const reasons = [
    row.whiskey9L >= 50 ? 'high whiskey volume' : null,
    row.priceFitPercent >= 80 ? 'strong premium-price fit' : null,
    row.consistencyScore !== null && row.consistencyScore >= 80 ? 'consistent purchasing' : null,
    row.ohioCraftAffinityScore !== null && row.ohioCraftAffinityScore >= 80
      ? 'demonstrated affinity for Ohio craft brands'
      : null,
    row.publicFitScore !== null && row.publicFitScore >= 80 ? 'strong public-fit signals' : null,
    row.momentumScore !== null && row.momentumScore >= 65 ? 'positive recent momentum' : null,
  ].filter(Boolean) as string[];

  if (reasons.length === 0) {
    return 'Worth reviewing because the model shows measurable portfolio-category volume and account activity.';
  }

  return `${reasons[0][0].toUpperCase()}${reasons[0].slice(1)}${reasons.length > 1 ? `, ${reasons.slice(1).join(', ')}` : ''}.`;
};

export const getCategoryVolumes = (row: TargetAccountImportRow) =>
  new Map([
    ['American Whiskey', row.whiskey9L],
    ['Rum', row.rum9L],
    ['Vodka', row.vodka9L],
    ['Cordial', row.cordial9L],
  ]);

export const calculateMissingCategories = (row: TargetAccountImportRow, portfolioSkus: PortfolioSku[]) => {
  const portfolioCategories = Array.from(new Set(portfolioSkus.map((sku) => sku.category).filter(Boolean)));
  const current = new Set(row.currentEtohioCategories.map((category) => normalizeHeader(category)));

  return portfolioCategories.filter((category) => !current.has(normalizeHeader(category)));
};

export const buildTargetRecommendation = (
  row: TargetAccountImportRow,
  portfolioSkus: PortfolioSku[],
): TargetRecommendation => {
  const categoryVolumes = getCategoryVolumes(row);
  const missingCategories = row.missingCategories.length > 0 ? row.missingCategories : calculateMissingCategories(row, portfolioSkus);
  const missingCategoryVolumes = missingCategories
    .map((category) => ({ category, volume: categoryVolumes.get(category) ?? 0 }))
    .sort((left, right) => right.volume - left.volume);
  const strongestCategory =
    missingCategoryVolumes[0]?.category ??
    Array.from(categoryVolumes.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ??
    null;
  const productName = strongestCategory ? `${strongestCategory} opportunity` : 'Portfolio opportunity';
  const score = row.existingBuyer ? row.expansionScore ?? row.blendedScore ?? row.dataScore ?? 0 : row.blendedScore ?? row.dataScore ?? 0;
  const currentCategoryVolume9L = strongestCategory ? categoryVolumes.get(strongestCategory) ?? 0 : row.portfolioCategory9L;
  const opportunityType = row.existingBuyer
    ? TargetOpportunityType.EXISTING_ACCOUNT_EXPANSION
    : !row.researchStatus || /needs|pending|incomplete|queue/i.test(row.researchStatus)
      ? TargetOpportunityType.RESEARCH_REQUIRED
      : TargetOpportunityType.NEW_PLACEMENT;
  const recommendedNextAction =
    opportunityType === TargetOpportunityType.RESEARCH_REQUIRED
      ? 'Complete public-fit research before choosing an account plan.'
      : row.existingBuyer
        ? `Review ${strongestCategory ?? 'portfolio'} expansion potential and choose the product during account planning.`
        : `Review ${strongestCategory ?? 'portfolio'} opening potential and choose the product during account planning.`;
  const reasons = [
    currentCategoryVolume9L > 0 ? `${strongestCategory ?? 'Target category'} volume is ${currentCategoryVolume9L.toFixed(1)} 9L.` : null,
    row.priceFitPercent > 0 ? `Price-fit share is ${row.priceFitPercent.toFixed(1)}%.` : null,
    row.premiumBottleSharePercent > 0 ? `Premium bottle share is ${row.premiumBottleSharePercent.toFixed(1)}%.` : null,
    row.buysOtherOhioCraft ? 'Account already buys other Ohio craft brands.' : null,
    row.existingBuyer && missingCategories.length > 0 ? `Missing portfolio categories: ${missingCategories.join(', ')}.` : null,
  ].filter(Boolean) as string[];

  return {
    category: strongestCategory,
    confidence: score >= 90 ? 'High' : score >= 75 ? 'Medium' : 'Low',
    currentCategoryVolume9L,
    estimatedMonthlyPotential: Math.max(currentCategoryVolume9L / Math.max(row.monthsActive || 6, 1), 0),
    itemCode: null,
    opportunityType,
    productName,
    recommendedNextAction,
    reasons,
    score,
  };
};

export type TargetAlertThresholds = {
  excessiveLowPriorityActivityDays: number;
  staleHighPriorityDays: number;
};

export const defaultTargetAlertThresholds: TargetAlertThresholds = {
  excessiveLowPriorityActivityDays: 14,
  staleHighPriorityDays: 30,
};

export const buildHeatLossRules = ({
  daysSinceLastActivity,
  hasActiveOpportunity,
  hasNextAction,
  row,
  thresholds = defaultTargetAlertThresholds,
}: {
  daysSinceLastActivity?: number | null;
  hasActiveOpportunity?: boolean;
  hasNextAction?: boolean;
  row: TargetAccountImportRow;
  thresholds?: TargetAlertThresholds;
}) => {
  const alerts: Array<{ detail: string; severity: string; title: string; type: string }> = [];
  const isHighPriority = row.priorityTier === 'A';

  if (isHighPriority && !hasNextAction) {
    alerts.push({
      detail: 'A-tier target account has no active primary next action.',
      severity: 'high',
      title: 'A-tier target needs a next action',
      type: 'A_TIER_NO_NEXT_ACTION',
    });
  }

  if (isHighPriority && daysSinceLastActivity !== null && daysSinceLastActivity !== undefined && daysSinceLastActivity > thresholds.staleHighPriorityDays) {
    alerts.push({
      detail: `No logged activity in ${daysSinceLastActivity} days.`,
      severity: 'high',
      title: 'High-priority account has gone cold',
      type: 'HIGH_PRIORITY_UNTOUCHED',
    });
  }

  if (/researched/i.test(row.researchStatus ?? '') && !hasActiveOpportunity && !row.existingBuyer) {
    alerts.push({
      detail: 'Research is complete, but no open opportunity has been created.',
      severity: 'medium',
      title: 'Completed research needs sales follow-up',
      type: 'RESEARCH_COMPLETE_NO_FOLLOW_UP',
    });
  }

  if (row.existingBuyer && (row.expansionScore ?? 0) >= 75 && !hasActiveOpportunity) {
    alerts.push({
      detail: `Expansion score is ${(row.expansionScore ?? 0).toFixed(1)} with no open opportunity.`,
      severity: 'medium',
      title: 'High expansion account has no opportunity',
      type: 'HIGH_EXPANSION_NO_OPPORTUNITY',
    });
  }

  return alerts;
};

export const parseTargetAccountWorkbook = async (buffer: Buffer): Promise<ParsedTargetWorkbook> => {
  const workbook = await readWorkbook(buffer);
  const warnings: TargetWorkbookWarning[] = [];
  const failedRows: TargetWorkbookFailedRow[] = [];
  const mappings = REQUIRED_SHEETS.map((sheetName) =>
    buildMapping(sheetName, workbook.getWorksheet(sheetName), sheetDefinitions[sheetName]),
  );
  const mappingsBySheet = new Map(mappings.map((mapping) => [mapping.sheetName, mapping]));

  mappings.forEach((mapping) => {
    if (mapping.missingRequired.length > 0) {
      warnings.push({
        detail: `Missing required columns: ${mapping.missingRequired.join(', ')}`,
        sheetName: mapping.sheetName,
      });
    }
  });

  REQUIRED_SHEETS.filter((sheetName) => !workbook.getWorksheet(sheetName)).forEach((sheetName) => {
    warnings.push({ detail: 'Required sheet is missing.', sheetName });
  });

  const ownershipByPermit = getAllActiveOwnershipByPermit(workbook, mappingsBySheet.get('All Active Central')!);
  const portfolioSkus = readPortfolioSkus(workbook, mappingsBySheet.get('ETOHIO Portfolio')!, failedRows);
  const accountRows = readAccountRows(workbook, mappingsBySheet, ownershipByPermit, failedRows).map((row) => ({
    ...row,
    missingCategories: calculateMissingCategories(row, portfolioSkus),
  }));
  const chainRows = readChainRows(workbook, mappingsBySheet.get('Chain Opportunities')!, failedRows);
  const researchQueueRows = readResearchQueueRows(workbook, mappingsBySheet.get('Research Queue')!);

  return {
    accountRows,
    chainRows,
    failedRows,
    mappings,
    portfolioSkus,
    researchQueueRows,
    sourceWorkbookHash: getWorkbookHash(buffer),
    summary: {
      sheetNames: workbook.worksheets.map((worksheet) => worksheet.name),
      sheets: workbook.worksheets.map((worksheet) => ({
        dimension: getWorksheetDimension(worksheet),
        formulaCount: getFormulaCount(worksheet),
        name: worksheet.name,
      })),
    },
    warnings,
  };
};
