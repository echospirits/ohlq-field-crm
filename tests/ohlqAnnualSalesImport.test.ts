import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  importOhlqAnnualSalesCsv,
  importOhlqAnnualSalesByWholesaleCsv,
  parseOhlqAnnualSalesByWholesaleCsv,
  parseOhlqAnnualSalesCsv,
  syncOhlqAnnualSalesByWholesalePurchaseStateCsv,
} from '../lib/ohlqAnnualSalesImport';
import type { WholesaleOrderReconciliationResult } from '../lib/wholesaleOrderReconciliation';

const emptyReconciliation = (): WholesaleOrderReconciliationResult => ({
  ambiguousEvidenceKeys: [],
  ambiguousOrderIds: [],
  checkedOrders: 0,
  filedOrders: 0,
  matches: [],
  stillOutstandingOrders: 0,
});

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

  it('rejects malformed quantities and conflicting duplicate evidence', () => {
    assert.throws(
      () => parseOhlqAnnualSalesByWholesaleCsv(wholesaleCsv.replace(',2,67.68,', ',2junk,67.68,'), '2026-05-11'),
      /invalid wholesale bottle quantity/i,
    );
    assert.throws(
      () => parseOhlqAnnualSalesByWholesaleCsv(`${wholesaleCsv}\n${wholesaleCsv.split('\n')[1].replace(',2,67.68,', ',3,67.68,')}`, '2026-05-11'),
      /conflicting duplicate rows/i,
    );
    assert.equal(
      parseOhlqAnnualSalesByWholesaleCsv(`${wholesaleCsv}\n${wholesaleCsv.split('\n')[1]}`, '2026-05-11').rows.length,
      1,
    );
  });
});

const echoWholesaleCsv = [
  'District,Agency_Id,Agency_Name,DimVendor_VendorNumber_,Brand,Name,Category,Permit_Number,Wholesaler,Doing_Business_As,Wholesale_Bottles_Sold,Wholesale_Amount,Wholesale_Tax',
  'GPT,10113,CENTERVILLE LIQUOR & WINE,Z90399001,2804B,ECHO SPIRITS DISTILLING CO BOURBON WHISKEY,Bourbon,00072045-1,ADRIENNES WHITE RABBIT INC,ADRIENNES WHITE RABBIT LOUNGE,2,67.68,0.00',
].join('\n');

describe('retained daily sales report replacement', () => {
  for (const kind of ['annual', 'wholesale'] as const) {
    it(`${kind} replays and signed corrections replace one date, while a failed transaction preserves history`, async () => {
      type Row = {
        reportDate: Date; agencyId: string; vendor: string; brand: string;
        retailBottlesSold?: number; wholesaleBottlesSold: number; permitNumber?: string;
      };
      type Delegate = {
        deleteMany: (input: { where: { reportDate: Date } }) => Promise<{ count: number }>;
        createMany: (input: { data: Row[] }) => Promise<{ count: number }>;
      };
      type Transaction = {
        $executeRaw: () => Promise<number>;
        ohlqAnnualSalesRow: Delegate;
        ohlqAnnualSalesByWholesaleRow: Delegate;
      };
      const original = [
        { reportDate: new Date('2025-01-01'), agencyId: '10113', vendor: 'Z90399001', brand: '2804B', wholesaleBottlesSold: 7 },
        { reportDate: new Date('2026-11-19'), agencyId: '10113', vendor: 'Z90399001', brand: 'OLD', wholesaleBottlesSold: 9 },
      ].map(row => ({ ...row, ...(kind === 'annual' ? { retailBottlesSold: 0 } : { permitNumber: '00072045-1' }) }));
      let stored: Row[] = structuredClone(original);
      let failInsert = false, reconciliations = 0;
      const db = {
        $transaction: async (callback: (tx: Transaction) => Promise<unknown>) => {
          let draft = structuredClone(stored);
          const delegate: Delegate = {
            deleteMany: async ({ where }) => {
              const previous = draft.length;
              draft = draft.filter(row => row.reportDate.getTime() !== where.reportDate.getTime());
              return { count: previous - draft.length };
            },
            createMany: async ({ data }) => {
              if (failInsert) throw new Error('simulated insert failure');
              draft.push(...structuredClone(data));
              return { count: data.length };
            },
          };
          const result = await callback({ $executeRaw: async () => 1, ohlqAnnualSalesRow: delegate, ohlqAnnualSalesByWholesaleRow: delegate });
          stored = draft;
          return result;
        },
        account: { findMany: async () => [] },
        ohlqBrandMasterItem: { findMany: async () => [] },
        wholesaleAccount: { findMany: async () => [] },
      } as unknown as PrismaClient;
      const reportCsv = (quantity: number) => kind === 'annual'
        ? [
          'Agency_Id,Vendor,Brand,Retail_Bottles_Sold,Wholesale_Bottles_Sold',
          `10113,Z90399001,2804B,${quantity},${quantity}`,
          '10113,000000090,0281L,5,2',
        ].join('\n')
        : [
          'Agency_Id,DimVendor_VendorNumber_,Brand,Permit_Number,Wholesale_Bottles_Sold',
          `10113,Z90399001,2804B,00072045-1,${quantity}`,
          '10113,000000090,0281L,00072045-1,2',
        ].join('\n');
      const load = (quantity: number) => kind === 'annual'
        ? importOhlqAnnualSalesCsv({ csv: reportCsv(quantity), db, reportDate: '2026-11-19' })
        : importOhlqAnnualSalesByWholesaleCsv({
          csv: reportCsv(quantity), db, reportDate: '2026-11-19',
          reconcileWholesaleOrders: async () => { reconciliations++; return emptyReconciliation(); },
        });

      assert.equal((await load(4)).importedRows, 2);
      const first = structuredClone(stored);
      assert.equal((await load(4)).deletedRows, 2);
      assert.deepEqual(stored, first, 'replay must replace the day rather than accumulate bottles');

      await load(-2);
      assert.equal(stored.length, 3);
      assert.deepEqual(stored[0], original[0], 'older permanently retained history must be untouched');
      assert.equal(stored.some(row => row.brand === 'OLD'), false, 'a removed source row must not survive replacement');
      const corrected = stored.find(row => row.reportDate.toISOString().startsWith('2026-11-19') && row.vendor === 'Z90399001')!;
      assert.equal(corrected.wholesaleBottlesSold, -2);
      if (kind === 'annual') assert.equal(corrected.retailBottlesSold, -2);

      const beforeFailure = structuredClone(stored), reconciledBeforeFailure = reconciliations;
      failInsert = true;
      await assert.rejects(load(99), /simulated insert failure/);
      assert.deepEqual(stored, beforeFailure, 'a failed insert must not commit its preceding delete');
      assert.equal(reconciliations, reconciledBeforeFailure, 'failed raw replacement must not start reconciliation');
    });
  }
});

describe('syncOhlqAnnualSalesByWholesalePurchaseStateCsv', () => {
  it('updates Echo purchase state without importing raw wholesale rows', async () => {
    const updates: unknown[] = [];
    const phases: string[] = [];
    const db = {
      account: {
        findMany: async () => {
          phases.push('purchase-state');
          return [];
        },
      },
      ohlqBrandMasterItem: {
        findMany: async () => [{ itemCode: '2804B', name: 'Echo Bourbon' }],
      },
      wholesaleAccount: {
        findMany: async () => [
          {
            address: '123 N Main St',
            city: 'Columbus',
            id: 'wholesale-1',
            licenseeId: '72045',
            licenseeIds: [],
            name: 'Adriennes White Rabbit',
            officialAccountId: null,
            state: 'OH',
            zip: '43215',
          },
        ],
        updateMany: async ({ data }: { data: unknown }) => {
          updates.push(data);
          return { count: 1 };
        },
      },
    } as unknown as PrismaClient;

    const result = await syncOhlqAnnualSalesByWholesalePurchaseStateCsv({
      csv: echoWholesaleCsv,
      db,
      reconcileWholesaleOrders: async ({ incomingReportDate, incomingRows }) => {
        phases.push('reconcile');
        assert.equal(incomingReportDate?.toISOString(), '2026-05-11T00:00:00.000Z');
        assert.equal(incomingRows?.length, 1);
        return emptyReconciliation();
      },
      reportDate: '2026-05-11',
    });

    assert.equal(result.parsedRows, 1);
    assert.equal(result.skippedRows, 0);
    assert.equal(result.echoPurchaseState.updatedAccounts, 1);
    assert.equal(result.echoPurchaseState.matchedPermitNumbers, 1);
    assert.equal(updates.length, 1);
    assert.equal(phases[0], 'reconcile');

    const update = updates[0] as {
      ohlqLastEchoPurchaseDate: Date;
      ohlqLastEchoPurchaseItemCode: string;
      ohlqLastEchoPurchaseItemName: string;
    };
    assert.equal(update.ohlqLastEchoPurchaseDate.toISOString(), '2026-05-11T00:00:00.000Z');
    assert.equal(update.ohlqLastEchoPurchaseItemCode, '2804B');
    assert.equal(update.ohlqLastEchoPurchaseItemName, 'Echo Bourbon');
  });

  it('rejects an incomplete purchase-state-only report before matching or account updates', async () => {
    const incompleteCsv = `${wholesaleCsv}\nGPT,,CENTERVILLE LIQUOR & WINE,000000090,0281L,JAMESON,Irish,00072045-1,NAME,DBA,2,67.68,0.00`;
    let reconciled = false;
    await assert.rejects(
      syncOhlqAnnualSalesByWholesalePurchaseStateCsv({
        csv: incompleteCsv,
        db: {} as PrismaClient,
        reconcileWholesaleOrders: async () => {
          reconciled = true;
          return emptyReconciliation();
        },
        reportDate: '2026-05-11',
      }),
      /wholesale CSV is incomplete/i,
    );
    assert.equal(reconciled, false);
  });
});

describe('importOhlqAnnualSalesByWholesaleCsv reconciliation integration', () => {
  it('commits the replacement before reconciling, then updates purchase state', async () => {
    const phases: string[] = [];
    const tx = {
      $executeRaw: async () => {
        phases.push('lock');
        return 1;
      },
      ohlqAnnualSalesByWholesaleRow: {
        createMany: async () => ({ count: 1 }),
        deleteMany: async () => ({ count: 0 }),
      },
    };
    const db = {
      $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => {
        const result = await callback(tx);
        phases.push('committed');
        return result;
      },
      account: { findMany: async () => [] },
      ohlqBrandMasterItem: { findMany: async () => [] },
      wholesaleAccount: { findMany: async () => [] },
    } as unknown as PrismaClient;

    const result = await importOhlqAnnualSalesByWholesaleCsv({
      csv: wholesaleCsv,
      db,
      reconcileWholesaleOrders: async ({ incomingRows }) => {
        phases.push('reconcile');
        assert.equal(incomingRows?.length ?? 0, 0, 'persisted full imports must reconcile from committed rows');
        assert.equal(phases.at(-3), 'lock');
        assert.equal(phases.at(-2), 'committed');
        return { ...emptyReconciliation(), checkedOrders: 2, filedOrders: 1, stillOutstandingOrders: 1 };
      },
      reportDate: '2026-05-11',
    });

    assert.equal(result.wholesaleOrderReconciliation.filedOrders, 1);
    assert.deepEqual(phases.slice(0, 3), ['lock', 'committed', 'reconcile']);
  });

  it('rejects an incomplete full report before replacing retained rows or reconciling', async () => {
    const incompleteCsv = `${wholesaleCsv}\nGPT,,CENTERVILLE LIQUOR & WINE,000000090,0281L,JAMESON,Irish,00072045-1,NAME,DBA,2,67.68,0.00`;
    let wroteRows = false;
    let reconciled = false;
    const db = {
      $transaction: async () => {
        wroteRows = true;
        throw new Error('transaction must not start');
      },
    } as unknown as PrismaClient;

    await assert.rejects(
      importOhlqAnnualSalesByWholesaleCsv({
        csv: incompleteCsv,
        db,
        reconcileWholesaleOrders: async () => {
          reconciled = true;
          return emptyReconciliation();
        },
        reportDate: '2026-05-11',
      }),
      /wholesale CSV is incomplete/i,
    );
    assert.equal(wroteRows, false);
    assert.equal(reconciled, false);
  });
});
