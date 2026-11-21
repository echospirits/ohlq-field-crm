import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { parseOhlqAnnualSalesCsv } from '../lib/ohlqAnnualSalesImport';
import { ECHO_SALES_REPORT_ID, publishEchoSalesCoverage, validateEchoSalesEvidence } from '../lib/echoBottleSalesCoverage';

const date = '2026-09-01';
const header = 'Agency_Id,Vendor,Brand,Retail_Bottles_Sold,Wholesale_Bottles_Sold';
const evidence = {
  native: { reportIdentity: ECHO_SALES_REPORT_ID, scope: 'VENDOR_FILTERED' as const,
    requestedFrom: date, requestedTo: date, acquiredAt: '2026-10-01T12:00:00Z', exportCompleted: true as const },
  requestReference: 'fixture:1',
};

test('certification parses signed and zero quantities and rejects duplicates and partial numbers', () => {
  const row = '001,Z90399001,0001,-2,0';
  const parsed = parseOhlqAnnualSalesCsv(header + '\n' + row, date, true);
  assert.equal(parsed.rows[0].agencyId, '001');
  assert.equal(parsed.rows[0].retailBottlesSold, -2);
  assert.equal(parsed.rows[0].wholesaleBottlesSold, 0);
  assert.throws(() => parseOhlqAnnualSalesCsv(header + '\n' + row + '\n' + row, date, true), /Duplicate/);
  assert.throws(() => parseOhlqAnnualSalesCsv(header + '\n' + row.replace('-2','-2bad'), date, true), /Invalid signed/);
  assert.equal(parseOhlqAnnualSalesCsv(header, date, true).rows.length, 0);
  const decimals = parseOhlqAnnualSalesCsv(
    header + '\n001,Z90399001,0001,-2.000,0.00\n001,OTHER,0001,1.75,-0.25', date, true);
  assert.equal(decimals.rows[0].retailBottlesSold, -2);
  assert.equal(decimals.rows[1].retailBottlesSold, 1);
  assert.equal(Number(decimals.rows[1].wholesaleBottlesSold), -0);
  assert.throws(() => parseOhlqAnnualSalesCsv(header + '\n001,Z90399001,0001,1.75,0', date, true), /Echo/);
  assert.throws(() => validateEchoSalesEvidence(header, date, { ...evidence, native: {
    ...evidence.native, requestedTo: '2026-09-02',
  } }), /evidence/);
});

test('coverage writes only after source/persisted match and blocks conflicting stale sources', async () => {
  const clean = { rowCount: 0, retail: 0n, wholesale: 0n, hash: 'a'.repeat(64) };
  const source = validateEchoSalesEvidence(header, date, evidence);
  let previous: null | { sourceAcquiredAt: Date; expectedFactsSha256: string } = null;
  let calls = 0;
  let alternate = false;
  let writes = 0;
  const tx = {
    $queryRaw: async () => {
      calls += 1;
      return [alternate && calls % 2 === 0 ? { ...clean, hash: 'b'.repeat(64) } : clean];
    },
    echoBottleSalesDayCoverage: {
      findUnique: async () => previous,
      upsert: async () => { writes += 1; },
    },
  } as unknown as Prisma.TransactionClient;
  await publishEchoSalesCoverage(tx, date, [], source);
  assert.equal(writes, 1);
  previous = { sourceAcquiredAt: new Date('2026-10-02T12:00:00Z'), expectedFactsSha256: clean.hash };
  await publishEchoSalesCoverage(tx, date, [], source);
  assert.equal(writes, 1);
  previous.expectedFactsSha256 = 'b'.repeat(64);
  await assert.rejects(publishEchoSalesCoverage(tx, date, [], source), /Stale/);
  alternate = true;
  await assert.rejects(publishEchoSalesCoverage(tx, date, [], source), /do not match/);
  assert.equal(writes, 1);
});
