import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  BAILMENT_REPORTING_HEADERS,
  BailmentReportingParseError,
  MAX_BAILMENT_REPORTING_BYTES,
  parseBailmentReportingCsv,
  type BailmentReportingParseErrorCode,
} from '../lib/ohlqBailmentReportingParser';

const sample = (): string[] => [
  'ETOHIO LLC', 'BROKER', '11/18/2026', 'a000123', '11/17/2026',
  'PO000123', '', '00100', '', '00860001939804', '3150B',
  'Rum', 'Rum', 'GPT', '3', '', 'C12', '$257.40', '$0.00', '$772.20', '',
];
const cell = (value: string) => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
const makeCsv = (rows: string[][], options: { bom?: boolean; newline?: string; suffix?: string } = {}) => {
  const newline = options.newline ?? '\r\n';
  return Buffer.from(`${options.bom ? '\uFEFF' : ''}${[Array.from(BAILMENT_REPORTING_HEADERS), ...rows]
    .map(row => row.map(cell).join(',')).join(newline)}${options.suffix ?? newline}`, 'utf8');
};
const fails = (buffer: Buffer, code: BailmentReportingParseErrorCode) => {
  assert.throws(() => parseBailmentReportingCsv(buffer), (error: unknown) => {
    assert.ok(error instanceof BailmentReportingParseError);
    assert.equal(error.code, code);
    assert.equal(error.message, `Bailment reporting source failed validation (${code}).`);
    return true;
  });
};

test('native BOM/CRLF, quoted multiline text and source identifiers survive typed reporting', () => {
  const row = sample();
  row[0] = '  ETOHIO LLC  ';
  row[11] = 'Queen\'s "Share", Rum\r\nBatch 1';
  row[19] = '$1,234.50';
  row[20] = '1/2/2027';
  const csv = makeCsv([row], { bom: true, suffix: '\r\n\r\n' });
  const result = parseBailmentReportingCsv(csv);
  assert.equal(result.rowCount, 1);
  assert.equal(result.contentHash, createHash('sha256').update(Uint8Array.from(csv)).digest('hex'));
  assert.deepEqual(result.lines[0].sourceValues, row);
  assert.equal(result.lines[0].vendorName, '  ETOHIO LLC  ');
  assert.equal(result.lines[0].name, row[11]);
  assert.equal(result.lines[0].agency, '00100');
  assert.equal(result.lines[0].upcCode, '00860001939804');
  assert.equal(result.lines[0].invoiceNumber, 'a000123');
  assert.equal(result.lines[0].brand, '3150B', 'forecasting exclusions are not applied');
  assert.equal(result.lines[0].quotedCasePrice, '257.40');
  assert.equal(result.lines[0].total, '1234.50');
  assert.equal(result.lines[0].invoiceDate?.toISOString(), '2026-11-18T00:00:00.000Z');
  assert.equal(result.lines[0].datePaid?.toISOString(), '2027-01-02T00:00:00.000Z');
  assert.deepEqual(result.invoiceMonthCounts, { '2026-11': 1 });
});

test('duplicate invoice lines, negative adjustments, zero and unknown values stay distinct', () => {
  const row = sample();
  const adjustment = sample();
  adjustment[14] = '-0.25';
  adjustment[15] = '0';
  adjustment[17] = '';
  adjustment[18] = '($1.25)';
  adjustment[19] = '-$64.35';
  const result = parseBailmentReportingCsv(makeCsv([row, row, adjustment]));
  assert.equal(result.rowCount, 3);
  assert.deepEqual(result.lines.map(line => line.sourceLineNumber), [1, 2, 3]);
  assert.deepEqual(result.lines[0].sourceValues, result.lines[1].sourceValues);
  assert.equal(result.lines[2].cases, '-0.25');
  assert.equal(result.lines[2].oddBottles, '0');
  assert.equal(result.lines[0].oddBottles, null);
  assert.equal(result.lines[2].quotedCasePrice, null);
  assert.equal(result.lines[2].discount, '-1.25');
  assert.equal(result.lines[2].total, '-64.35');
  assert.equal(result.lines[2].datePaid, null);
});

test('a full-width empty source row is preserved but terminal physical blank lines are not rows', () => {
  const blank = BAILMENT_REPORTING_HEADERS.map(() => '');
  const result = parseBailmentReportingCsv(makeCsv([sample(), blank], { newline: '\n', suffix: '\n\n\n' }));
  assert.equal(result.rowCount, 2);
  assert.equal(result.lines[1].sourceLineNumber, 2);
  assert.equal(result.lines[1].cases, null);
  assert.equal(result.lines[1].invoiceDate, null);
  assert.deepEqual(result.lines[1].sourceValues, blank);
});

test('payment-only and financial-only changes produce a different source identity', () => {
  const initial = parseBailmentReportingCsv(makeCsv([sample()]));
  const paid = sample();
  paid[20] = '11/19/2026';
  const paidResult = parseBailmentReportingCsv(makeCsv([paid]));
  assert.notEqual(paidResult.contentHash, initial.contentHash);
  assert.equal(paidResult.lines[0].cases, initial.lines[0].cases);
  for (const field of [17, 18, 19]) {
    const changed = sample();
    changed[field] = '$10.01';
    assert.notEqual(parseBailmentReportingCsv(makeCsv([changed])).contentHash, initial.contentHash);
  }
  assert.equal(parseBailmentReportingCsv(makeCsv([sample()])).contentHash, initial.contentHash);
});

test('dates are strict calendar dates independent of timezone, including leap years and ISO', () => {
  const row = sample();
  row[2] = '2/29/2024';
  row[4] = '2024-02-28';
  row[8] = '03/01/2024';
  const result = parseBailmentReportingCsv(makeCsv([row]));
  assert.equal(result.lines[0].invoiceDate?.toISOString(), '2024-02-29T00:00:00.000Z');
  assert.equal(result.lines[0].poCreateDate?.toISOString(), '2024-02-28T00:00:00.000Z');
  assert.equal(result.lines[0].transferOrderShipDate?.toISOString(), '2024-03-01T00:00:00.000Z');
  for (const value of ['2/29/2025', '2/30/2024', '13/1/2026', '0/1/2026', '11/0/2026', '11/18/26', '0000-01-01', '2026-11-18T00:00:00Z']) {
    const invalid = sample();
    invalid[20] = value;
    fails(makeCsv([invalid]), 'invalid-date');
  }
});

test('decimal values retain exact precision beyond the safe JavaScript integer range', () => {
  const row = sample();
  row[14] = '00003.125000';
  row[15] = '(1)';
  row[17] = '$999,999,999,999,999,999.123456';
  row[18] = '$-0.75';
  row[19] = '+$0.000001';
  const result = parseBailmentReportingCsv(makeCsv([row]));
  assert.equal(result.lines[0].cases, '3.125000');
  assert.equal(result.lines[0].oddBottles, '-1');
  assert.equal(result.lines[0].quotedCasePrice, '999999999999999999.123456');
  assert.equal(result.lines[0].discount, '-0.75');
  assert.equal(result.lines[0].total, '0.000001');
  for (const value of ['$1,00.00', '$1.0000001', '$1000000000000000000', '$1e3', 'NaN', 'Infinity', '1%', '$--1', '(-1)', '$ 1 000', '$']) {
    const invalid = sample();
    invalid[19] = value;
    fails(makeCsv([invalid]), 'invalid-number');
  }
  const currencyQuantity = sample();
  currencyQuantity[14] = '$3';
  fails(makeCsv([currencyQuantity]), 'invalid-number');
});

test('source schema changes fail explicitly', () => {
  const csv = makeCsv([sample()]);
  fails(Buffer.from(csv.toString().replace('Date_Paid', 'Payment_Date')), 'schema-change');
  fails(Buffer.from(csv.toString().replace('Vendor_Name,Broker_Name', 'Broker_Name,Vendor_Name')), 'schema-change');
  fails(Buffer.from(csv.toString().replace('Date_Paid\r\n', 'Date_Paid,Extra\r\n')), 'schema-change');
});

test('invalid UTF-8, HTML, empty reports and oversized reports are rejected without source disclosure', () => {
  fails(Buffer.from([0xc3, 0x28]), 'invalid-encoding');
  fails(Buffer.from('<html>PRIVATE sign-in page</html>'), 'invalid-csv');
  fails(Buffer.alloc(0), 'empty-export');
  fails(makeCsv([]), 'empty-export');
  fails(Buffer.alloc(MAX_BAILMENT_REPORTING_BYTES + 1), 'oversized-export');
  const invalid = sample();
  invalid[19] = 'PRIVATE_FINANCIAL_VALUE';
  assert.throws(() => parseBailmentReportingCsv(makeCsv([invalid])), error => {
    assert.ok(error instanceof Error);
    assert.doesNotMatch(error.message, /PRIVATE|ETOHIO|a000123/);
    return true;
  });
});

test('malformed quotes, row shapes and interior blank lines do not become partial reports', () => {
  const header = BAILMENT_REPORTING_HEADERS.join(',');
  const line = sample().map(cell).join(',');
  for (const value of [
    `${header}\n${line}\n${line.slice(0, line.lastIndexOf(','))}`,
    `${header}\n${line}\n\n${line}`,
    `${header}\n${line}\n""\n`,
    `${header}\n"PRIVATE unfinished`,
    `${header}\n${line.replace('BROKER', 'BRO"KER')}`,
    `${header}\n${line.replace('BROKER', '"BROKER"extra')}`,
    `${header}\n${line.replace('BROKER', 'BRO\0KER')}`,
  ]) fails(Buffer.from(value), 'invalid-csv');
});
