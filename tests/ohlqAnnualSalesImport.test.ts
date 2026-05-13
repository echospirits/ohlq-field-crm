import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseOhlqAnnualSalesByWholesaleCsv,
  parseOhlqAnnualSalesCsv,
} from '../lib/ohlqAnnualSalesImport';

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
    assert.equal(result.rows[0].wholesaleBottlesSold, 0);
    assert.equal(new Date(result.rows[0].reportDate).toISOString(), '2026-05-11T00:00:00.000Z');
    assert.equal('id' in result.rows[0], false);
    assert.equal('createdAt' in result.rows[0], false);
    assert.equal('updatedAt' in result.rows[0], false);
    assert.equal('retailAmount' in result.rows[0], false);
    assert.equal('agencyName' in result.rows[0], false);
  });

  it('fails loudly when required headers are missing', () => {
    assert.throws(
      () => parseOhlqAnnualSalesCsv('District,Agency_Id\nGPT,10100', '2026-05-11'),
      /missing required header/i,
    );
  });
});

const wholesaleCsv = [
  '﻿District,Agency_Id,Agency_Name,DimVendor_VendorNumber_,Brand,Name,Category,Permit_Number,Wholesaler,Doing_Business_As,Wholesale_Bottles_Sold,Wholesale_Amount,Wholesale_Tax',
  'GPT,10113,CENTERVILLE LIQUOR & WINE,000000090,0281L,JAMESON,Irish,00072045-1,ADRIENNES WHITE RABBIT INC,ADRIENNES WHITE RABBIT LOUNGE,2,67.68,0.00',
].join('\n');

describe('parseOhlqAnnualSalesByWholesaleCsv', () => {
  it('normalizes wholesale rows with report date and permit details', () => {
    const result = parseOhlqAnnualSalesByWholesaleCsv(wholesaleCsv, '2026-05-11');

    assert.equal(result.rows.length, 1);
    assert.equal(result.skippedRows, 0);
    assert.equal(result.rows[0].agencyId, '10113');
    assert.equal(result.rows[0].vendor, '000000090');
    assert.equal(result.rows[0].permitNumber, '00072045-1');
    assert.equal(result.rows[0].wholesaleBottlesSold, 2);
    assert.equal(new Date(result.rows[0].reportDate).toISOString(), '2026-05-11T00:00:00.000Z');
    assert.equal('id' in result.rows[0], false);
    assert.equal('createdAt' in result.rows[0], false);
    assert.equal('updatedAt' in result.rows[0], false);
    assert.equal('wholesaler' in result.rows[0], false);
    assert.equal('doingBusinessAs' in result.rows[0], false);
  });
});
