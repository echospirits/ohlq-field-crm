import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import Papa from 'papaparse';

export const BAILMENT_REPORTING_SCHEMA_VERSION = 'ohlq-bailment-reporting-v1';
export const MAX_BAILMENT_REPORTING_BYTES = 32 * 1024 * 1024;

export const BAILMENT_REPORTING_HEADERS = [
  'Vendor_Name', 'Broker_Name', 'Invoice_Date', 'Invoice_Number', 'PO_Create_Date',
  'PO_Number', 'Transfer_Order_Number', 'Agency', 'Transfer_Order_Ship_Date',
  'UPC_Code', 'Brand', 'Name', 'Category', 'DC_Name', 'Cases', 'Odd_Bottles',
  'Cases_Bottles', 'Quoted_Case_Price', 'Discount', 'Total', 'Date_Paid',
] as const;

export type BailmentReportingParseErrorCode =
  | 'empty-export'
  | 'oversized-export'
  | 'invalid-encoding'
  | 'invalid-csv'
  | 'schema-change'
  | 'invalid-date'
  | 'invalid-number';

/** These messages are safe for job status: they never include a source field. */
export class BailmentReportingParseError extends Error {
  constructor(readonly code: BailmentReportingParseErrorCode) {
    super(`Bailment reporting source failed validation (${code}).`);
    this.name = 'BailmentReportingParseError';
  }
}

export type BailmentReportingLineInput = {
  vendorName: string | null;
  brokerName: string | null;
  invoiceDate: Date | null;
  invoiceNumber: string | null;
  poCreateDate: Date | null;
  poNumber: string | null;
  transferOrderNumber: string | null;
  agency: string | null;
  transferOrderShipDate: Date | null;
  upcCode: string | null;
  brand: string | null;
  name: string | null;
  category: string | null;
  dcName: string | null;
  cases: string | null;
  oddBottles: string | null;
  casesBottles: string | null;
  quotedCasePrice: string | null;
  discount: string | null;
  total: string | null;
  datePaid: Date | null;
  /** One-based CSV data-record ordinal, including legitimate duplicate lines. */
  sourceLineNumber: number;
  /** Original unescaped cell values, before typed reporting conversions. */
  sourceValues: string[];
};

export type ParsedBailmentReportingReport = {
  contentHash: string;
  schemaVersion: string;
  rowCount: number;
  lines: BailmentReportingLineInput[];
  invoiceMonthCounts: Record<string, number>;
};

const fail = (code: BailmentReportingParseErrorCode): never => {
  throw new BailmentReportingParseError(code);
};

/** Papa handles field extraction; this rejects permissive, non-CSV quote use. */
function validateQuoteStructure(csv: string) {
  let state: 'start' | 'unquoted' | 'quoted' | 'closed' = 'start';
  for (let index = 0; index < csv.length; index++) {
    const char = csv[index];
    if (char === '\0') fail('invalid-csv');
    if (state === 'quoted') {
      if (char === '"') state = 'closed';
      continue;
    }
    if (state === 'closed' && char === '"') {
      state = 'quoted';
      continue;
    }
    if (char === ',' || char === '\r' || char === '\n') {
      state = 'start';
      if (char === '\r' && csv[index + 1] === '\n') index++;
      continue;
    }
    if (state === 'closed') fail('invalid-csv');
    if (char === '"') {
      if (state !== 'start') fail('invalid-csv');
      state = 'quoted';
    } else {
      state = 'unquoted';
    }
  }
  if (state === 'quoted') fail('invalid-csv');
}

const sourceText = (value: string): string | null => value === '' ? null : value;

/** Native US date-only fields and explicit ISO dates are the supported formats. */
function sourceDate(raw: string): Date | null {
  const value = raw.trim();
  if (value === '') return null;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!us && !iso) return fail('invalid-date');
  const [year, month, day] = us
    ? [Number(us[3]), Number(us[1]), Number(us[2])]
    : [Number(iso![1]), Number(iso![2]), Number(iso![3])];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return fail('invalid-date');
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return fail('invalid-date');
  }
  return date;
}

/** Convert with strings only: PostgreSQL Decimal(24,6) must not round input. */
function sourceDecimal(raw: string, allowCurrency: boolean): string | null {
  let value = raw.trim();
  if (value === '') return null;
  let negative = false;
  let parenthesized = false;
  let signed = false;
  if (value.startsWith('(') && value.endsWith(')')) {
    parenthesized = true;
    negative = true;
    value = value.slice(1, -1).trim();
  }
  if (/^[+-]/.test(value)) {
    if (parenthesized) return fail('invalid-number');
    signed = true;
    negative = value[0] === '-';
    value = value.slice(1);
  }
  if (value.startsWith('$')) {
    if (!allowCurrency) return fail('invalid-number');
    value = value.slice(1).trimStart();
    if (/^[+-]/.test(value)) {
      if (signed || parenthesized) return fail('invalid-number');
      negative = value[0] === '-';
      value = value.slice(1);
    }
  }
  // Commas must be genuine thousands separators; exponents/percentages are not quantities.
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value)) return fail('invalid-number');
  const [rawInteger, fraction] = value.replace(/,/g, '').split('.');
  const integer = rawInteger.replace(/^0+(?=\d)/, '');
  if (integer.length > 18 || (fraction?.length ?? 0) > 6) return fail('invalid-number');
  if (integer === '0' && (!fraction || /^0+$/.test(fraction))) negative = false;
  return `${negative ? '-' : ''}${integer}${fraction === undefined ? '' : `.${fraction}`}`;
}

export function parseBailmentReportingCsv(csvBuffer: Buffer): ParsedBailmentReportingReport {
  if (!Buffer.isBuffer(csvBuffer) || csvBuffer.length === 0) return fail('empty-export');
  if (csvBuffer.length > MAX_BAILMENT_REPORTING_BYTES) return fail('oversized-export');
  const sourceBytes = Uint8Array.from(csvBuffer);
  let csv: string;
  try {
    csv = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(sourceBytes);
  } catch {
    return fail('invalid-encoding');
  }
  if (csv.startsWith('\uFEFF')) csv = csv.slice(1);
  if (/^\s*<(?:!doctype|html|\?xml)\b/i.test(csv)) return fail('invalid-csv');
  validateQuoteStructure(csv);
  // Native exports end with physical blank lines. Do not drop an explicit "" record
  // or a full-width empty row, and do not skip any interior blank/short records.
  csv = csv.replace(/(?:\r\n|\r|\n)+$/, '');
  if (!csv) return fail('empty-export');

  const parsed = Papa.parse(csv, {
    header: false,
    delimiter: ',',
    dynamicTyping: false,
    skipEmptyLines: false,
    fastMode: false,
    comments: false,
  }) as { data: string[][]; errors: unknown[]; meta: { aborted?: boolean; truncated?: boolean } };
  if (parsed.errors.length || parsed.meta.aborted || parsed.meta.truncated) return fail('invalid-csv');
  const [header, ...records] = parsed.data;
  if (!header || header.length !== BAILMENT_REPORTING_HEADERS.length
    || header.some((value, index) => value !== BAILMENT_REPORTING_HEADERS[index])) {
    return fail('schema-change');
  }
  if (!records.length) return fail('empty-export');

  const invoiceMonthCounts: Record<string, number> = {};
  const lines = records.map((row, index): BailmentReportingLineInput => {
    if (row.length !== BAILMENT_REPORTING_HEADERS.length || row.some(value => typeof value !== 'string')) {
      return fail('invalid-csv');
    }
    const invoiceDate = sourceDate(row[2]);
    if (invoiceDate) {
      const month = invoiceDate.toISOString().slice(0, 7);
      invoiceMonthCounts[month] = (invoiceMonthCounts[month] ?? 0) + 1;
    }
    return {
      vendorName: sourceText(row[0]),
      brokerName: sourceText(row[1]),
      invoiceDate,
      invoiceNumber: sourceText(row[3]),
      poCreateDate: sourceDate(row[4]),
      poNumber: sourceText(row[5]),
      transferOrderNumber: sourceText(row[6]),
      agency: sourceText(row[7]),
      transferOrderShipDate: sourceDate(row[8]),
      upcCode: sourceText(row[9]),
      brand: sourceText(row[10]),
      name: sourceText(row[11]),
      category: sourceText(row[12]),
      dcName: sourceText(row[13]),
      cases: sourceDecimal(row[14], false),
      oddBottles: sourceDecimal(row[15], false),
      casesBottles: sourceText(row[16]),
      quotedCasePrice: sourceDecimal(row[17], true),
      discount: sourceDecimal(row[18], true),
      total: sourceDecimal(row[19], true),
      datePaid: sourceDate(row[20]),
      sourceLineNumber: index + 1,
      sourceValues: row.slice(),
    };
  });
  return {
    contentHash: createHash('sha256').update(sourceBytes).digest('hex'),
    schemaVersion: BAILMENT_REPORTING_SCHEMA_VERSION,
    rowCount: lines.length,
    lines,
    invoiceMonthCounts,
  };
}
