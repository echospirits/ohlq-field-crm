import assert from 'node:assert/strict';
import { fixture, filters } from './fixtures/analytics';
import test from 'node:test';
import { analyticsHref, comparisonRange, coverageFor, dates, parseFilters, summarize, type AnalyticsData, type Filters } from '../lib/analytics/model';
import { analyticsCsv } from '../lib/analytics/csv';
import { loadAnalytics } from '../lib/analytics/service';
import { ohioAdapter, retainedDays, type AnalyticsDb, type MarketAdapter } from '../lib/analytics/ohio';

test('date presets, leap year, custom validation and previous/prior-year comparisons', () => {
  assert.deepEqual(comparisonRange(filters()), { start: '2026-08-25', end: '2026-08-31' });
  assert.deepEqual(comparisonRange(filters({ start: '2024-02-29', end: '2024-02-29', comparison: 'year' })), { start: '2023-02-28', end: '2023-02-28' });
  assert.equal(comparisonRange(filters({ comparison: 'none' })), null);
  assert.equal(parseFilters({ preset: '7' }, '2026-09-19').start, '2026-09-12');
  assert.equal(parseFilters({ preset: 'mtd' }, '2026-09-19').start, '2026-09-01');
  assert.equal(parseFilters({ preset: 'qtd' }, '2026-09-19').start, '2026-07-01');
  assert.equal(parseFilters({ preset: 'ytd' }, '2026-09-19').start, '2026-01-01');
  assert.equal(parseFilters({ preset: '12m' }, '2026-09-19').start, '2025-09-19');
  for (const [start, end] of [['2026-02-30', '2026-03-01'], ['2025-01-01', '2026-09-01'], ['2026-09-19', '2026-09-20']]) assert.throws(() => parseFilters({ preset: 'custom', start, end }, '2026-09-19'));
});
test('daily quantities, channel/product/date filters and exact metric drill-downs', () => {
  const result = summarize(fixture(), filters());
  assert.equal(result.quantity, 18); assert.equal(result.previousQuantity, 2);
  assert.equal(result.groupCounts.purchasing, 3); assert.equal(result.groupCounts.new, 2);
  assert.equal(result.groupCounts.multiple, 1); assert.equal(result.groupCounts.lapsed, 1);
  assert.equal(result.products.find(p => p.key === 'OH:A')?.accounts, 3);
  for (const group of ['purchasing', 'new', 'lapsed', 'after', 'multiple', 'single', 'work', 'untouched']) assert.equal(summarize(fixture(), filters({ group })).filtered.length, result.groupCounts[group]);
  const retail = summarize(fixture(), filters({ channel: 'retail', product: 'OH:A' }));
  assert.equal(retail.quantity, 9); assert.equal(retail.groupCounts.purchasing, 2);
  assert.equal(summarize(fixture(), filters({ product: 'OTHER_TENANT:secret' })).quantity, null);
});
test('distribution counts positive purchase observations, retains negative corrections, excludes unresolved identities', () => {
  const data = fixture(); data.accounts[1].matched = false;
  data.sales.push({ ...data.sales[1], quantity: -10 });
  const r = summarize(data, filters());
  assert.equal(r.quantity, 8); assert.equal(r.groupCounts.purchasing, 2); assert.equal(r.products[0].accounts, 2);
  assert.equal(r.rows.find(a => a.key === 'a')?.change, null);
});
test('visits use strictly later purchase dates and give first/reorder context without attribution', () => {
  let r = summarize(fixture(), filters());
  assert.equal(r.groupCounts.after, 1); assert.equal(r.groupCounts.pending, 1);
  assert.equal(r.rows.find(a => a.key === 'a')?.daysToPurchase, 2);
  assert.equal(r.rows.find(a => a.key === 'a')?.purchaseKind, 'Reorder in retained history');
  const data = fixture(); data.activity.push({ account: 'b', date: '2026-09-05', id: 'same-day', kind: 'visit' });
  r = summarize(data, filters()); assert.equal(r.groupCounts.after, 1);
  data.activity[2].date = '2026-09-04';
  assert.equal(summarize(data, filters()).rows.find(a => a.key === 'b')?.purchaseKind, 'First observed purchase');
});
test('no subsequent purchase requires a fully elapsed, covered 30-day window; missing/future windows remain unknown', () => {
  const f = filters({ end: '2026-10-01' });
  const data = fixture();
  assert.equal(summarize(data, f).groupCounts.without, 1);
  data.coverage[0].days = data.coverage[0].days.filter(d => d !== '2026-09-22');
  assert.equal(summarize(data, f).groupCounts.without, 0); assert.equal(summarize(data, f).groupCounts.pending, 1);
});
test('retention gaps disable lapse and comparisons, never manufacture zero sales', () => {
  const data = fixture(); data.coverage.forEach(c => { c.days = dates({ start: '2026-09-01', end: '2026-09-07' }); });
  const r = summarize(data, filters()); assert.equal(r.groupCounts.lapsed, null); assert.equal(r.groupCounts.growing, null); assert.equal(r.previousQuantity, null);
  const old = summarize(data, filters({ start: '2025-01-01', end: '2025-01-07' })); assert.equal(old.quantity, null); assert.equal(old.groupCounts.purchasing, null); assert.equal(old.products[0].accounts, null);
  data.sales = []; assert.equal(summarize(data, filters()).quantity, 0);
});
test('prior-year comparison works only with complete comparable windows', () => {
  const data = fixture(); data.coverage.forEach(c => c.days.push(...dates({ start: '2025-09-01', end: '2025-09-07' })));
  data.sales.push({ ...data.sales[0], date: '2025-09-02', quantity: 10 });
  assert.equal(summarize(data, filters({ comparison: 'year' })).previousQuantity, 10);
  data.coverage[0].days = data.coverage[0].days.filter(d => d !== '2025-09-04');
  assert.equal(summarize(data, filters({ comparison: 'year' })).previousQuantity, null);
});
test('All Markets does not sum incompatible units; comparable bottle markets do combine', () => {
  const data = fixture(); data.products.push({ key: 'KY:A', market: 'KY', name: 'Kentucky', code: 'A' });
  data.coverage.push({ market: 'KY', channel: 'retail', source: 'KY', unit: 'cases', days: dates(filters()) });
  data.sales.push({ ...data.sales[0], market: 'KY', product: 'KY:A', quantity: 100, date: '2026-09-02' });
  assert.equal(summarize(data, filters()).quantity, null);
  data.coverage[2].unit = 'bottles'; assert.equal(summarize(data, filters()).quantity, 118);
  assert.equal(coverageFor([], filters()).complete, false);
});
test('CSV exports share filtered result rows, preserve context and neutralize formula cells', () => {
  const data = fixture(); data.accounts[0].name = '=HYPERLINK("bad")';
  const f = filters({ channel: 'retail', group: 'purchasing', product: 'OH:B', q: 'HYPERLINK' });
  const csv = analyticsCsv(summarize(data, f), f, 'org-a', 'accounts');
  assert.equal(csv.split('\r\n').length, 2); assert.ok(csv.includes('"org-a"')); assert.ok(csv.includes("'=HYPERLINK")); assert.ok(!csv.includes('Account d'));
  const url = analyticsHref(f, { page: 2 }); assert.ok(url.includes('product=OH%3AB')); assert.ok(url.includes('channel=retail'));
});
test('server product scope is Organization-owned/represented, with no tenant fallback; unknown selections never load adapters', async () => {
  const seen: string[] = [];
  const db = { organizationProduct: { findMany: async (args: any) => { assert.deepEqual(args.where.status, { in: ['OWNED', 'REPRESENTED'] }); assert.ok(!args.where.active); return [{ market: 'OH', externalItemCode: args.where.organizationId, displayName: args.where.organizationId }]; } } } as unknown as AnalyticsDb;
  const adapter: MarketAdapter = { market: 'OH', load: async (_db, org, products) => { seen.push(org); assert.deepEqual(products.map(p => p.code), [org]); return { ...fixture(), products, sales: [] }; } };
  const a = await loadAnalytics('org-a', filters(), db, [adapter]);
  const b = await loadAnalytics('org-b', filters(), db, [adapter]);
  assert.deepEqual(a.availableProducts.map(p => p.key), ['OH:org-a']); assert.deepEqual(b.availableProducts.map(p => p.key), ['OH:org-b']);
  const denied = await loadAnalytics('org-a', filters({ product: 'OH:org-b' }), db, [adapter]);
  assert.equal(denied.quantity, null); assert.deepEqual(seen, ['org-a', 'org-b']);
  await assert.rejects(() => loadAnalytics('', filters(), db, [adapter]));
});
test('coverage verifies physical retained counts against source-specific completed imports', async () => {
  const db = { $queryRaw: async (sql: any) => { assert.ok(sql.sql.includes('COUNT(*)')); assert.ok(sql.sql.includes('COALESCE')); assert.ok(sql.sql.includes('"skippedRows" = 0')); assert.ok(sql.values.includes('ANNUAL_SALES_SUMMARY')); return [{ reportDate: new Date('2026-09-01') }]; } } as unknown as AnalyticsDb;
  assert.deepEqual(await retainedDays(db, 'retail', '2026-09-01', '2026-09-07'), ['2026-09-01']);
});
test('organizations with no configured products still see their CRM activity, with sales unavailable', async () => {
  const db = { organizationProduct: { findMany: async () => [] } } as unknown as AnalyticsDb;
  const adapter: MarketAdapter = { market: 'OH', load: async (_db, org, products) => {
    assert.equal(org, 'org-no-products'); assert.deepEqual(products, []);
    const data = fixture(); data.products = []; data.sales = []; data.coverage.forEach(c => c.days = []); return data;
  } };
  const r = await loadAnalytics('org-no-products', filters(), db, [adapter]);
  assert.equal(r.visits, 2); assert.equal(r.visitedAccounts, 2); assert.equal(r.quantity, null); assert.equal(r.groupCounts.purchasing, null); assert.equal(r.groupCounts.lapsed, null);
  const exported = analyticsCsv(r, filters(), 'org-no-products', 'accounts').split('\r\n');
  assert.ok(exported[1].includes('"Unavailable","Unavailable","Unavailable","Unavailable"')); // bottles, prior, change, product count
});
test('Ohio adapter scopes every CRM query, uses only selected item codes, and rejects ambiguous permits', async () => {
  const scope = (args: any) => assert.equal(args.where.organizationId, 'org-a');
  const db = {
    $queryRaw: async () => [{ reportDate: new Date('2026-09-02') }],
    ohlqAnnualSalesRow: { groupBy: async (args: any) => { assert.deepEqual(args.where.brand.in, ['A']); return []; } },
    ohlqAnnualSalesByWholesaleRow: { groupBy: async (args: any) => { assert.deepEqual(args.where.brand.in, ['A']); return [{ permitNumber: '123', brand: 'A', reportDate: new Date('2026-09-02'), _sum: { wholesaleBottlesSold: 7 } }]; } },
    loggedVisit: { findMany: async (args: any) => { scope(args); return [{ id: 'v', agencyId: 'agency', wholesaleAccountId: null, visitAt: new Date('2026-09-03T02:00:00Z') }]; } },
    worklistItem: { findMany: async (args: any) => { scope(args); return []; } },
    salesOpportunity: { findMany: async (args: any) => { scope(args); return []; } },
    agency: { findMany: async () => [{ id: 'agency', agencyId: '100', name: 'Public agency', city: null }] },
    wholesaleAccount: { findMany: async (args: any) => args.select.licenseeId ? [{ id: 'w1', licenseeId: '123', licenseeIds: [] }, { id: 'w2', licenseeId: '123-0001', licenseeIds: [] }] : [] },
  } as unknown as AnalyticsDb;
  const data = await ohioAdapter.load(db, 'org-a', [fixture().products[0]], filters());
  assert.equal(data.sales[0].quantity, 7); assert.ok(data.sales[0].account.includes('unmatched'));
  assert.equal(data.activity[0].date, '2026-09-02'); assert.ok(data.warnings[0].includes('1 sales identities'));
});
