import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  importOhlqAgencyInventoryCsv,
  parseOhlqAgencyInventoryCsv,
} from '../lib/ohlqAgencyInventoryImport';
import {
  getOhlqAgencyInventoryReportConfig,
  OHLQ_AGENCY_INVENTORY_REPORT_ID,
} from '../lib/ohlqAnnualSalesReport';

const header =
  'Store,Store_Name,Brand,Brand_Name,Status,Detail_Code_Description,Coverage_Group,Minimum,On_Hand,Vendor,Vendor_Name,Broker,Broker_Name,District';
const row = ({
  brand = '2796B',
  brandName = 'ECHO SPIRITS ELUSIVE HERBAL LIQUEUR',
  detail = 'A3A Bailment',
  minimum = '3',
  onHand = '6',
  store = '10509',
  vendor = 'Z90399001',
}: {
  brand?: string;
  brandName?: string;
  detail?: string;
  minimum?: string;
  onHand?: string;
  store?: string;
  vendor?: string;
} = {}) =>
  [
    store,
    `STORE ${store}`,
    brand,
    brandName,
    'Active',
    detail,
    'MIN',
    minimum,
    onHand,
    vendor,
    'ETOHIO LLC',
    'BK47',
    'BEVERAGE DISTRIBUTORS INC',
    'GPT',
  ].join(',');

describe('parseOhlqAgencyInventoryCsv', () => {
  it('uses the confirmed report UUID and selects all brands without changing the preset vendor', () => {
    const config = getOhlqAgencyInventoryReportConfig();
    assert.equal(OHLQ_AGENCY_INVENTORY_REPORT_ID, '5079ab3f-ff48-4f50-a1b4-3264862af239');
    assert.equal(config.reportId, OHLQ_AGENCY_INVENTORY_REPORT_ID);
    assert.deepEqual(config.parameter, { name: 'Brand', values: 'all' });
  });

  it('maps values by header name rather than column position', () => {
    const reordered = [
      'Brand,Store,On_Hand,Minimum,Vendor,Brand_Name,Store_Name,Status,Detail_Code_Description,Coverage_Group,Vendor_Name,Broker,Broker_Name,District',
      '2796B,10509,6,3,Z90399001,ECHO SPIRITS ELUSIVE HERBAL LIQUEUR,STAGGERLEES CARRYOUT,Active,A3A Bailment,MIN,ETOHIO LLC,BK47,BEVERAGE DISTRIBUTORS INC,GPT',
    ].join('\n');
    const result = parseOhlqAgencyInventoryCsv(reordered, '2026-08-18', { minimumQualifyingRows: 1 });
    assert.equal(result.rows[0].agencyNumber, '10509');
    assert.equal(result.rows[0].itemCode, '2796B');
    assert.equal(result.rows[0].onHand, 6);
  });

  it('maps by header, preserves identifiers and names, and safely parses quantities', () => {
    const csv = [
      header,
      row(),
      row({ brand: '2806B', minimum: '', onHand: '0' }),
      row({ brand: '2847B', onHand: '-11' }),
    ].join('\n');
    const result = parseOhlqAgencyInventoryCsv(csv, '2026-08-18', { minimumQualifyingRows: 1 });

    assert.equal(result.rows.length, 3);
    assert.equal(result.rows[0].agencyNumber, '10509');
    assert.equal(result.rows[0].itemCode, '2796B');
    assert.equal(result.rows[0].itemName, 'ECHO SPIRITS ELUSIVE HERBAL LIQUEUR');
    assert.equal(result.rows[0].minimum, 3);
    assert.equal(result.rows[0].onHand, 6);
    assert.equal(result.rows[1].minimum, null);
    assert.equal(result.rows[1].onHand, 0);
    assert.equal(result.rows[2].onHand, -11);
  });

  it('applies vendor, item, and exact distillery-only exclusions with diagnostics', () => {
    const csv = [
      header,
      row(),
      row({ brand: '3150B' }),
      row({ brand: '3750B' }),
      row({ brand: '4359B' }),
      row({ brand: '2806B', detail: '  A3A Distillery Only  ' }),
      row({ brand: '2847B', detail: 'A3A Distillery Only Special' }),
      row({ brand: '9999Z', vendor: 'OTHER' }),
    ].join('\n');
    const result = parseOhlqAgencyInventoryCsv(csv, '2026-08-18', { minimumQualifyingRows: 1 });

    assert.deepEqual(result.rows.map((item) => item.itemCode), ['2796B', '2847B']);
    assert.equal(result.stats.rowsMatchingVendor, 6);
    assert.deepEqual(result.stats.excludedItemRows, { '3150B': 1, '3750B': 1, '4359B': 1 });
    assert.equal(result.stats.excludedDistilleryOnlyRows, 1);
  });

  it('counts malformed numeric rows and rejects empty, malformed, or unexpectedly sparse files', () => {
    const malformed = [header, row({ onHand: 'not-a-number' }), row()].join('\n');
    const result = parseOhlqAgencyInventoryCsv(malformed, '2026-08-18', { minimumQualifyingRows: 1 });
    assert.equal(result.stats.malformedNumericRows, 1);
    assert.equal(result.rows.length, 1);

    assert.throws(
      () => parseOhlqAgencyInventoryCsv(`${header}\n${row()}`, '2026-08-18', { minimumQualifyingRows: 2 }),
      /expected at least 2/i,
    );
    assert.throws(
      () => parseOhlqAgencyInventoryCsv('Store,Brand\n10509,2796B', '2026-08-18', { minimumQualifyingRows: 1 }),
      /missing required header/i,
    );
    assert.throws(
      () => parseOhlqAgencyInventoryCsv(header, '2026-08-18', { minimumQualifyingRows: 1 }),
      /no data rows/i,
    );
  });
});

type InventoryRecord = Record<string, unknown> & {
  agencyNumber: string;
  itemCode: string;
  snapshotDate: Date;
};

function createInventoryDb() {
  const current = new Map<string, InventoryRecord>();
  const snapshots = new Map<string, InventoryRecord>();
  const key = (record: { agencyNumber: string; itemCode: string }) => `${record.agencyNumber}:${record.itemCode}`;
  const snapshotKey = (record: InventoryRecord) => `${record.snapshotDate.toISOString().slice(0, 10)}:${key(record)}`;
  const asRows = (data: unknown) => (Array.isArray(data) ? data : [data]) as InventoryRecord[];

  const tx = {
    ohlqAgencyInventoryCurrent: {
      createMany: async ({ data }: { data: unknown }) => {
        for (const record of asRows(data)) current.set(key(record), { ...record });
        return { count: asRows(data).length };
      },
      deleteMany: async () => {
        const count = current.size;
        current.clear();
        return { count };
      },
    },
    ohlqAgencyInventorySnapshot: {
      createMany: async ({ data }: { data: unknown }) => {
        for (const record of asRows(data)) snapshots.set(snapshotKey(record), { ...record });
        return { count: asRows(data).length };
      },
      deleteMany: async ({ where }: { where: { snapshotDate: Date } }) => {
        const prefix = `${where.snapshotDate.toISOString().slice(0, 10)}:`;
        const keys = Array.from(snapshots.keys()).filter((item) => item.startsWith(prefix));
        keys.forEach((item) => snapshots.delete(item));
        return { count: keys.length };
      },
    },
  };

  const db = {
    $transaction: async (callback: (transaction: typeof tx) => unknown) => callback(tx),
    agency: {
      findMany: async () => [{ agencyId: '10509', id: 'agency-10509' }],
    },
    ohlqAgencyInventoryCurrent: {
      findMany: async () => Array.from(current.values()).map(({ agencyNumber, itemCode }) => ({ agencyNumber, itemCode })),
    },
  } as unknown as PrismaClient;

  return { current, db, snapshots };
}

describe('importOhlqAgencyInventoryCsv', () => {
  it('is idempotent by day, preserves prior snapshots, and retains unmatched agencies without creating them', async () => {
    const state = createInventoryDb();
    const firstCsv = [header, row(), row({ brand: '2806B', store: '99999' })].join('\n');
    const first = await importOhlqAgencyInventoryCsv({
      csv: firstCsv,
      db: state.db,
      minimumQualifyingRows: 1,
      reportDate: '2026-08-18',
    });
    assert.equal(first.diagnostics.currentRecordsInserted, 2);
    assert.deepEqual(first.diagnostics.unmatchedAgencyNumbers, ['99999']);
    assert.equal(state.current.get('10509:2796B')?.agencyId, 'agency-10509');
    assert.equal(state.current.get('99999:2806B')?.agencyId, null);

    const repeated = await importOhlqAgencyInventoryCsv({
      csv: firstCsv,
      db: state.db,
      minimumQualifyingRows: 1,
      reportDate: '2026-08-18',
    });
    assert.equal(repeated.diagnostics.currentRecordsInserted, 0);
    assert.equal(repeated.diagnostics.currentRecordsUpdated, 2);
    assert.equal(state.snapshots.size, 2);

    const tomorrowCsv = [header, row({ onHand: '2' }), row({ brand: '2847B' })].join('\n');
    await importOhlqAgencyInventoryCsv({
      csv: tomorrowCsv,
      db: state.db,
      minimumQualifyingRows: 1,
      reportDate: '2026-08-19',
    });
    assert.equal(state.snapshots.size, 4);
    assert.equal(state.current.get('10509:2796B')?.onHand, 2);
    assert.equal(state.snapshots.get('2026-08-18:10509:2796B')?.onHand, 6);
  });

  it('does not mutate current state when validation fails', async () => {
    const state = createInventoryDb();
    await importOhlqAgencyInventoryCsv({
      csv: [header, row()].join('\n'),
      db: state.db,
      minimumQualifyingRows: 1,
      reportDate: '2026-08-18',
    });
    const before = Array.from(state.current.entries());

    await assert.rejects(
      importOhlqAgencyInventoryCsv({
        csv: header,
        db: state.db,
        minimumQualifyingRows: 1,
        reportDate: '2026-08-19',
      }),
      /no data rows/i,
    );
    assert.deepEqual(Array.from(state.current.entries()), before);
  });
});
