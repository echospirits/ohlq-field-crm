import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import {
  DEFAULT_OHLQ_REPORT_RETENTION_DAYS,
  OHLQ_PERMANENT_SALES_VENDOR_ID,
  getOhlqReportRetentionDays,
  getOhlqRetentionCutoffDate,
  pruneOhlqAnnualSalesRows,
} from '../lib/ohlqAnnualSalesRetention';

const ECHO = 'Z90399001';
type Row = { id: string; reportDate: Date; vendor: string; brand: string; agencyId: string; retailBottlesSold: number; wholesaleBottlesSold: number };
type Tables = { annual: Row[]; wholesale: Row[] };
type DeleteWhere = Record<string, Record<string, unknown>>;
const row = (id: string, date: string, vendor: string, brand = '2802B', quantity = 1): Row => ({
  id, reportDate: new Date(`${date}T00:00:00Z`), vendor, brand, agencyId: '90399', retailBottlesSold: quantity, wholesaleBottlesSold: quantity,
});

// Evaluate deletion against stored rows, with lazy transaction operations like
// Prisma. Assertions below concern surviving facts, not a prescribed query shape.
function retentionDb(initial: Tables) {
  let tables: Tables = structuredClone(initial);
  let transactions = 0, deleteCalls = 0;
  const matches = (record: Row, where: DeleteWhere) => Object.entries(where).every(([field, condition]) =>
    Object.entries(condition).every(([operator, value]) => {
      const actual = record[field as keyof Row];
      if (operator === 'not') return actual !== value;
      if (operator === 'lt') {
        assert(actual instanceof Date && value instanceof Date);
        return actual.getTime() < value.getTime();
      }
      throw new Error(`Unsupported fixture operator: ${operator}`);
    }));
  const model = (table: keyof Tables) => ({ deleteMany: ({ where }: { where: DeleteWhere }) => {
    deleteCalls++;
    return (draft: Tables) => {
      const before = draft[table].length;
      draft[table] = draft[table].filter(record => !matches(record, where));
      return { count: before - draft[table].length };
    };
  } });
  const db = {
    ohlqAnnualSalesRow: model('annual'),
    ohlqAnnualSalesByWholesaleRow: model('wholesale'),
    $transaction: async (operations: Array<(draft: Tables) => { count: number }>) => {
      transactions++;
      const draft = structuredClone(tables);
      const result = operations.map(operation => operation(draft));
      tables = draft;
      return result;
    },
  } as unknown as PrismaClient;
  return { db, rows: () => structuredClone(tables), calls: () => ({ transactions, deleteCalls }) };
}

describe('OHLQ annual sales retention', () => {
  it('keeps all Echo history and the inclusive statewide window in both datasets', async () => {
    assert.equal(DEFAULT_OHLQ_REPORT_RETENTION_DAYS, 30);
    assert.equal(OHLQ_PERMANENT_SALES_VENDOR_ID, ECHO);
    const preserved = [
      row('echo-positive', '2019-01-01', ECHO, '2802B', 8),
      row('echo-return', '2020-01-01', ECHO, '2802B', -2),
      row('echo-zero', '2021-01-01', ECHO, '2802B', 0),
      ...['3150B', '3750B', '4359B', '4429B'].map(brand => row(`echo-${brand}`, '2022-01-01', ECHO, brand)),
      row('other-boundary', '2026-10-21', 'OTHER'),
      row('other-current', '2026-11-19', 'OTHER'),
      row('other-future', '2026-11-20', 'OTHER'),
    ];
    const expired = [
      row('other-same-brand', '2020-01-01', 'OTHER', '2802B'),
      row('other-before-boundary', '2026-10-20', 'OTHER'),
      row('lookalike-vendor', '2020-01-01', `${ECHO}-OTHER`),
      row('different-case-vendor', '2020-01-01', ECHO.toLowerCase()),
    ];
    const fixture = retentionDb({ annual: [...preserved, ...expired], wholesale: [...preserved, ...expired, row('other-wholesale-only', '2018-01-01', 'OTHER')] });
    const result = await pruneOhlqAnnualSalesRows({ db: fixture.db, reportDate: '2026-11-19' });
    assert.deepEqual(result, { cutoffDate: '2026-10-21', retentionDays: 30, deletedRows: { annualSalesSummary: 4, annualSalesSummaryByWholesale: 5 } });
    assert.deepEqual(fixture.rows(), { annual: preserved, wholesale: preserved });
    assert.deepEqual(fixture.calls(), { transactions: 1, deleteCalls: 2 });

    const replay = await pruneOhlqAnnualSalesRows({ db: fixture.db, reportDate: '2026-11-19' });
    assert.deepEqual(replay.deletedRows, { annualSalesSummary: 0, annualSalesSummaryByWholesale: 0 });
    assert.deepEqual(fixture.rows(), { annual: preserved, wholesale: preserved });

    await pruneOhlqAnnualSalesRows({ db: fixture.db, reportDate: '2026-11-20' });
    const nextDay = preserved.filter(record => record.id !== 'other-boundary');
    assert.deepEqual(fixture.rows(), { annual: nextDay, wholesale: nextDay });
  });

  it('applies a configured non-Echo window without narrowing permanent Echo history', async () => {
    const keep = [row('echo', '2019-01-01', ECHO), row('boundary', '2026-11-13', 'OTHER')];
    const initial = [...keep, row('expired', '2026-11-12', 'OTHER')];
    const fixture = retentionDb({ annual: initial, wholesale: initial });
    const result = await pruneOhlqAnnualSalesRows({ db: fixture.db, reportDate: '2026-11-19', retentionDays: 7 });
    assert.equal(result.cutoffDate, '2026-11-13');
    assert.deepEqual(fixture.rows(), { annual: keep, wholesale: keep });
  });

  it('uses exact UTC calendar boundaries across leap years, year changes and DST dates', () => {
    for (const [reportDate, days, expected] of [
      ['2026-05-14', 30, '2026-04-15'],
      ['2026-01-01', 30, '2025-12-03'],
      ['2024-03-01', 30, '2024-02-01'],
      ['2025-03-01', 30, '2025-01-31'],
      ['2026-03-09', 30, '2026-02-08'],
      ['2026-11-02', 30, '2026-10-04'],
      ['2026-11-19', 1, '2026-11-19'],
      ['0001-01-01', 1, '0001-01-01'],
      ['0100-01-01', 2, '0099-12-31'],
    ] as const) assert.equal(getOhlqRetentionCutoffDate(reportDate, days).toISOString(), `${expected}T00:00:00.000Z`, reportDate);
  });

  it('rejects invalid direct counts before constructing deletes or starting a transaction', async () => {
    for (const retentionDays of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER, 100_000_001]) {
      const initial = { annual: [row('annual', '2019-01-01', 'OTHER')], wholesale: [row('wholesale', '2019-01-01', 'OTHER')] };
      const fixture = retentionDb(initial);
      assert.throws(() => getOhlqRetentionCutoffDate('2026-11-19', retentionDays));
      await assert.rejects(pruneOhlqAnnualSalesRows({ db: fixture.db, reportDate: '2026-11-19', retentionDays }));
      assert.deepEqual(fixture.calls(), { transactions: 0, deleteCalls: 0 });
      assert.deepEqual(fixture.rows(), initial);
    }
  });

  it('rejects impossible report dates and cutoff underflow without modifying either dataset', async () => {
    for (const [reportDate, retentionDays] of [
      ['2026-02-29', 30], ['2026-02-30', 30], ['2026-13-01', 30], ['2026-00-10', 30],
      ['0000-01-01', 1], ['0001-01-01', 2], ['2026-11-19T00:00:00Z', 30], ['invalid', 30],
    ] as const) {
      const fixture = retentionDb({ annual: [], wholesale: [] });
      await assert.rejects(pruneOhlqAnnualSalesRows({ db: fixture.db, reportDate, retentionDays }));
      assert.deepEqual(fixture.calls(), { transactions: 0, deleteCalls: 0 });
    }
  });

  it('keeps empty environment defaults and validates configured values before any mutation', async () => {
    assert.equal(getOhlqReportRetentionDays(''), 30);
    assert.equal(getOhlqReportRetentionDays('  '), 30);
    assert.equal(getOhlqReportRetentionDays(' 7 '), 7);
    const previous = process.env.OHLQ_REPORT_RETENTION_DAYS;
    try {
      for (const value of ['0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992', '9007199254740991', '100000001']) {
        process.env.OHLQ_REPORT_RETENTION_DAYS = value;
        const fixture = retentionDb({ annual: [], wholesale: [] });
        await assert.rejects(pruneOhlqAnnualSalesRows({ db: fixture.db, reportDate: '2026-11-19' }));
        assert.deepEqual(fixture.calls(), { transactions: 0, deleteCalls: 0 });
      }
      process.env.OHLQ_REPORT_RETENTION_DAYS = '7';
      const keep = [row('echo', '2019-01-01', ECHO), row('boundary', '2026-11-13', 'OTHER')];
      const initial = [...keep, row('expired', '2026-11-12', 'OTHER')];
      const fixture = retentionDb({ annual: initial, wholesale: initial });
      await pruneOhlqAnnualSalesRows({ db: fixture.db, reportDate: '2026-11-19' });
      assert.deepEqual(fixture.rows(), { annual: keep, wholesale: keep });
    } finally {
      if (previous === undefined) delete process.env.OHLQ_REPORT_RETENTION_DAYS;
      else process.env.OHLQ_REPORT_RETENTION_DAYS = previous;
    }
  });
});
