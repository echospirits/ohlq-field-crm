import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseOhlqAnnualSalesCsv } from '../lib/ohlqAnnualSalesImport';

const csv = [
  'District,Agency_Id,Agency_Name,Vendor,Brand,Name,Category,Retail_Bottles_Sold,Retail_Amount,Retail_Tax,Wholesale_Bottles_Sold,Wholesale_Amount,Wholesale_Tax',
  'GPT,10100,JUNGLE JIMS,000000932,0026D,OLD THOMPSON AMERICAN WHISKEY,American Whiskey,1,14.00,0.95,0,0.00,0.00',
  'GPT,10100,JUNGLE JIMS,000000932,0026D,OLD THOMPSON AMERICAN WHISKEY,American Whiskey,2,28.00,1.90,0,0.00,0.00',
].join('\n');

describe('parseOhlqAnnualSalesCsv', () => {
  it('normalizes rows and deduplicates by report date, agency, vendor, and brand', () => {
    const result = parseOhlqAnnualSalesCsv(csv, '2026-05-11');

    assert.equal(result.rows.length, 1);
    assert.equal(result.skippedRows, 0);
    assert.equal(result.rows[0].agencyId, '10100');
    assert.equal(result.rows[0].brand, '0026D');
    assert.equal(result.rows[0].retailBottlesSold, 2);
    assert.equal(result.rows[0].retailAmount, '28.00');
    assert.equal(new Date(result.rows[0].reportDate).toISOString(), '2026-05-11T00:00:00.000Z');
  });

  it('fails loudly when required headers are missing', () => {
    assert.throws(
      () => parseOhlqAnnualSalesCsv('District,Agency_Id\nGPT,10100', '2026-05-11'),
      /missing required header/i,
    );
  });
});
