import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { prisma } from '../lib/prisma';
import { getWeeklyDigestSales } from '../lib/weeklyDigestSales';
import { getWeeklyDigestWindow } from '../lib/weeklyDigest';
function stub(t: TestContext, target: any, method: string, fn: (...args: any[]) => any) { const original = target[method]; target[method] = fn; t.after(() => { target[method] = original; }); }
const window = getWeeklyDigestWindow(new Date('2026-09-18T13:00:00Z'));

test('sales use all configured item codes regardless of active, excluded, discontinued or distribution status', async (t) => {
  stub(t, prisma.organizationProduct, 'findMany', async (args) => {
    assert.deepEqual(args.where, { organizationId: 'tenant-a', market: 'OH' });
    return [{ externalItemCode: 'ACTIVE' }, { externalItemCode: 'DELISTED' }, { externalItemCode: 'NO-DISTRIBUTION' }, { externalItemCode: 'EXCLUDED' }, { externalItemCode: 'ACTIVE' }];
  });
  stub(t, prisma.ohlqReportImportStatus, 'findMany', async (args) => {
    assert.equal(args.where.status, 'COMPLETED'); assert.equal(args.where.dataSource, 'ANNUAL_SALES_SUMMARY');
    if (args.where.reportDate.gte.toISOString() === '2026-09-04T00:00:00.000Z') return [];
    assert.equal(args.where.reportDate.gte.toISOString(), '2026-09-11T00:00:00.000Z');
    assert.equal(args.where.reportDate.lt.toISOString(), '2026-09-18T00:00:00.000Z');
    return Array.from({ length: 7 }, (_, i) => ({ reportDate: new Date(`2026-09-${11 + i}T00:00:00Z`) }));
  });
  stub(t, prisma.ohlqAnnualSalesRow, 'aggregate', async (args) => {
    assert.deepEqual(args.where.brand.in, ['ACTIVE', 'DELISTED', 'NO-DISTRIBUTION', 'EXCLUDED']);
    assert.equal(args.where.reportDate.in.length, 7);
    return { _sum: { retailBottlesSold: 70, wholesaleBottlesSold: 35 } };
  });
  stub(t, prisma.ohlqAnnualSalesRow, 'groupBy', async () => []);
  const sales = await getWeeklyDigestSales('tenant-a', window);
  assert.equal(sales.status, 'complete'); assert.equal(sales.retailBottles, 70); assert.equal(sales.wholesaleBottles, 35); assert.equal(sales.configuredItems, 4);
});

test('missing days are partial; zero sales from a covered day remains a real zero', async (t) => {
  stub(t, prisma.organizationProduct, 'findMany', async () => [{ externalItemCode: 'A' }]);
  stub(t, prisma.ohlqReportImportStatus, 'findMany', async () => [{ reportDate: new Date('2026-09-11T00:00:00Z') }]);
  stub(t, prisma.ohlqAnnualSalesRow, 'aggregate', async () => ({ _sum: { retailBottlesSold: null, wholesaleBottlesSold: -1 } }));
  stub(t, prisma.ohlqAnnualSalesRow, 'groupBy', async () => []);
  const sales = await getWeeklyDigestSales('tenant', window);
  assert.equal(sales.status, 'partial'); assert.equal(sales.coveredDays, 1); assert.equal(sales.retailBottles, 0); assert.equal(sales.wholesaleBottles, -1);
});

test('retail leaders and declines use tenant products and complete comparable weeks, including a previous seller now at zero', async (t) => {
  stub(t, prisma.organizationProduct, 'findMany', async (args) => {
    assert.deepEqual(args.where, { organizationId: 'tenant-retail', market: 'OH' });
    return [{ externalItemCode: 'DELISTED' }, { externalItemCode: 'ACTIVE' }];
  });
  stub(t, prisma.ohlqReportImportStatus, 'findMany', async (args) => Array.from({ length: 7 }, (_, i) => ({ reportDate: new Date(args.where.reportDate.gte.getTime() + i * 86400000) })));
  stub(t, prisma.ohlqAnnualSalesRow, 'aggregate', async () => ({ _sum: { retailBottlesSold: 119, wholesaleBottlesSold: 40 } }));
  stub(t, prisma.ohlqAnnualSalesRow, 'groupBy', async (args) => {
    assert.deepEqual(args.where.brand.in, ['DELISTED', 'ACTIVE']);
    assert.deepEqual(args._sum, { retailBottlesSold: true });
    assert.equal(args.where.reportDate.in.length, 7);
    const rows = args.where.reportDate.in[0].toISOString().startsWith('2026-09-11') ? [['100', 100], ['200', 20], ['400', -1]] : [['100', 50], ['200', 40], ['300', 30], ['400', 10]];
    return rows.map(([agencyId, count]) => ({ agencyId, _sum: { retailBottlesSold: count } }));
  });
  stub(t, prisma.agency, 'findMany', async (args) => {
    assert.ok(!args.where.agencyId.in.includes('400')); // A correction is not a decline signal.
    return [{ id: 'agency-record', agencyId: '100', name: 'Invented Store', city: 'Demo City' }];
  });
  const result = await getWeeklyDigestSales('tenant-retail', window);
  assert.equal(result.retail?.comparable, true);
  assert.equal(result.retail?.sellingAgencies, 2);
  assert.equal(result.retail?.highlights.find((row) => row.agencyNumber === '100')?.change, 50);
  assert.equal(result.retail?.highlights.find((row) => row.agencyNumber === '100')?.href, '/agencies/agency-record');
  const stopped = result.retail?.highlights.find((row) => row.agencyNumber === '300');
  assert.equal(stopped?.bottles, 0); assert.equal(stopped?.change, -30);
  assert.equal(stopped?.name, 'Agency 300'); assert.equal(stopped?.href, null);
});

test('partial prior coverage retains retail leaders but never computes sales declines', async (t) => {
  stub(t, prisma.organizationProduct, 'findMany', async () => [{ externalItemCode: 'A' }]);
  stub(t, prisma.ohlqReportImportStatus, 'findMany', async (args) => Array.from({ length: args.where.reportDate.gte.toISOString().startsWith('2026-09-11') ? 7 : 6 }, (_, i) => ({ reportDate: new Date(args.where.reportDate.gte.getTime() + i * 86400000) })));
  stub(t, prisma.ohlqAnnualSalesRow, 'aggregate', async () => ({ _sum: { retailBottlesSold: 7, wholesaleBottlesSold: 2 } }));
  stub(t, prisma.ohlqAnnualSalesRow, 'groupBy', async (args) => {
    assert.ok(args.where.reportDate.in[0].toISOString().startsWith('2026-09-11'));
    return [{ agencyId: '100', _sum: { retailBottlesSold: 7 } }];
  });
  stub(t, prisma.agency, 'findMany', async () => []);
  const result = await getWeeklyDigestSales('tenant-retail', window);
  assert.equal(result.retail?.comparable, false); assert.equal(result.retail?.previousCoveredDays, 6);
  assert.equal(result.retail?.highlights[0].change, null); assert.equal(result.retail?.highlights[0].previousBottles, null);
});

test('no imports and no configured products never fall back to vendor or other tenant sales', async (t) => {
  let products: any[] = [{ externalItemCode: 'A' }];
  stub(t, prisma.organizationProduct, 'findMany', async () => products);
  stub(t, prisma.ohlqReportImportStatus, 'findMany', async () => []);
  stub(t, prisma.ohlqAnnualSalesRow, 'aggregate', async () => { assert.fail('must not query sales without coverage or items'); });
  assert.equal((await getWeeklyDigestSales('tenant', window)).status, 'unavailable');
  products = [];
  const result = await getWeeklyDigestSales('tenant', window);
  assert.equal(result.status, 'no-products'); assert.equal(result.retailBottles, null);
});
