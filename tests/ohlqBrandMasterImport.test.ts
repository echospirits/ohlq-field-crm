import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  importOhlqBrandMasterCsv,
  parseOhlqBrandMasterCsv,
} from '../lib/ohlqBrandMasterImport';

const csv = [
  'RetailPrice,WholesalePrice,VENDOR,BROKER,itemnumber,searchname,productcategoryname,purchaseunitsymbol,productvolume,solitemstatuscode,BottleLimit',
  '"15.990000","15.040000","SERRALLES USA LLC","RNDC","2740l","DON Q LIMON RUM","Rum","C12","33.800000","7","0"',
  '"21.990000","20.680000","MOET HENNESSY USA INC","COASTAL","3676B","GLENMORANGIE EMBLM & GLASSES","Scotch","C6","25.400000","7","2"',
  '"16.990000","15.970000","UPDATED VENDOR","RNDC","2740L","DON Q LIMON RUM UPDATED","Rum","C12","33.800000","7","0"',
].join('\n');

describe('parseOhlqBrandMasterCsv', () => {
  it('normalizes item codes and maps OHLQ brand master lookup fields', () => {
    const result = parseOhlqBrandMasterCsv(csv);

    assert.equal(result.rows.length, 2);
    assert.equal(result.skippedRows, 0);
    assert.equal(result.rows[0].itemCode, '2740L');
    assert.equal(result.rows[0].name, 'DON Q LIMON RUM UPDATED');
    assert.equal(result.rows[0].vendor, 'UPDATED VENDOR');
    assert.equal(result.rows[0].category, 'Rum');
    assert.equal(result.rows[0].retailPrice?.toString(), '16.99');
    assert.equal(result.rows[1].itemCode, '3676B');
    assert.equal(result.rows[1].bottleLimit, 2);
  });

  it('fails loudly when required headers are missing', () => {
    assert.throws(
      () => parseOhlqBrandMasterCsv('itemnumber,searchname\n2740L,DON Q LIMON RUM'),
      /missing required header/,
    );
  });
});

describe('importOhlqBrandMasterCsv', () => {
  it('fully replaces the destination table before loading the new rows', async () => {
    const calls: string[] = [];
    const db = {
      $transaction: async (callback: (tx: unknown) => Promise<{ deletedRows: number; importedRows: number }>) =>
        callback({
          ohlqBrandMasterItem: {
            createMany: async ({ data }: { data: unknown[] }) => {
              calls.push(`create:${data.length}`);
              return { count: data.length };
            },
            deleteMany: async () => {
              calls.push('delete');
              return { count: 12 };
            },
          },
        }),
    } as unknown as PrismaClient;

    const result = await importOhlqBrandMasterCsv({ csv, db });

    assert.deepEqual(calls, ['delete', 'create:2']);
    assert.equal(result.deletedRows, 12);
    assert.equal(result.importedRows, 2);
    assert.equal(result.parsedRows, 2);
  });
});
