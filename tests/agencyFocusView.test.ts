import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Prisma, PrismaClient } from '@prisma/client';
import { getDeadInventorySales90 } from '../lib/agencyFocusSales';
import { agencyFocusHref, agencyFocusPageNumber } from '../lib/agencyFocusView';
import { formatDateOnly } from '../lib/dateTime';
import { ECHO_VENDOR_ID, getOhlqWindowStartDate } from '../lib/ohlqSalesData';

test('source report dates do not shift backward in Eastern time', () => {
  assert.equal(formatDateOnly(new Date('2026-09-18T00:00:00Z')), '9/18/2026');
  assert.match(readFileSync('app/agency-focus/page.tsx', 'utf8'), /formatDateOnly\(item.asOfDate\)/);
});

test('agency action filter URLs retain account and search context with safe encoding', () => {
  const query = { agencyId: 'agency-1', q: 'Rum & rye', state: 'RESTOCK' };
  const filtered = new URL(agencyFocusHref(query), 'https://example.com');
  assert.equal(filtered.searchParams.get('agencyId'), 'agency-1');
  assert.equal(filtered.searchParams.get('q'), 'Rum & rye');
  assert.equal(filtered.searchParams.get('state'), 'RESTOCK');
  assert.equal(agencyFocusHref({ ...query, state: undefined }), '/agency-focus?agencyId=agency-1&q=Rum+%26+rye');
  assert.equal(agencyFocusHref({ q: ' ' }), '/agency-focus');
});

test('agency focus exposes comparison facts and the decisive reason while preserving action context', () => {
  const source = readFileSync('app/agency-focus/page.tsx', 'utf8');
  assert.match(source, /requireFeatureForUser\(currentUser, 'AGENCY_INTELLIGENCE'\)/);
  assert.match(source, /<table className="comparison-table intelligence-comparison-table retail-intelligence-table"/);
  for (const label of ['Account / product', 'Next action', 'On hand / min', 'Evidence', 'Actions']) {
    assert.ok(source.includes(`>${label}</th>`));
  }
  assert.match(source, /const showSales90 = state === AgencyProductOpportunityState\.DEAD_INVENTORY/);
  assert.match(source, /showSales90 \? 'Sales · 7 \/ 30 \/ 90d' : 'Sales · 7 \/ 30d'/);
  assert.match(source, /\{salesLabel\}<\/th>/);
  assert.match(source, /data-label=\{salesLabel\}/);
  for (const value of ['item.onHand', 'item.minimum', 'item.retailSales7', 'item.retailSales30', 'item.fitScore', 'item.peerCarryPercent']) assert.ok(source.includes(value));
  assert.match(source, /aria-label="Recommendation evidence"/);
  assert.match(source, /Why this recommendation\?/);
  assert.match(source, /className="intelligence-key-reason agency-focus-key-reason"/);
  assert.doesNotMatch(source, /View evidence|opportunity-evidence/);
  assert.match(source, /reason: stringList\(item.reasons\).join\(' '\), returnTo,/);
  assert.match(source, /take: AGENCY_FOCUS_PAGE_SIZE \+ 1/);
  assert.match(source, /skip: \(page - 1\) \* AGENCY_FOCUS_PAGE_SIZE/);
  assert.match(source, /\{ id: 'asc' \}/);
  assert.match(source, /Next page/);
  assert.match(source, /Previous page/);
  assert.match(source, /AgencyFocusSearch value=\{search\}/);
  assert.match(readFileSync('app/agency-focus/AgencyFocusSearch.tsx', 'utf8'), /LiveFilterForm/);
  assert.match(source, /No matching retail actions/);
});

test('Dead Inventory totals use the visible Echo agency and SKU windows, preserving signed quantities and missing history', async () => {
  const asOfDate = new Date('2026-11-20T00:00:00Z');
  const olderDate = new Date('2026-11-19T00:00:00Z');
  const recommendations = [
    { id: 'sold', agency: { agencyId: ' 01234 ' }, itemCode: 'A', asOfDate: new Date('2026-11-21T00:00:00Z') },
    { id: 'zero', agency: { agencyId: '06543' }, itemCode: 'A', asOfDate },
    { id: 'partial', agency: { agencyId: '05678' }, itemCode: 'A', asOfDate: olderDate },
    { id: 'unknown', agency: { agencyId: '07890' }, itemCode: 'A', asOfDate: olderDate },
    { id: 'outside-scope', agency: { agencyId: '01234' }, itemCode: 'B', asOfDate },
    { id: 'unknown-vendor', agency: { agencyId: '01234' }, itemCode: 'C', asOfDate },
  ];
  const db = {
    organization: { findUnique: async ({ where }: Prisma.OrganizationFindUniqueArgs) => {
      assert.deepEqual(where, { id: 'echo-test' });
      return { products: [{ externalItemCode: 'A' }, { externalItemCode: 'C' }], vendorIdentifiers: [] };
    } },
    ohlqReportImportStatus: { groupBy: async ({ where, having }: Prisma.OhlqReportImportStatusGroupByArgs) => {
      assert.equal(where?.status, 'COMPLETED');
      assert.deepEqual(where?.dataSource, { in: ['ANNUAL_SALES_SUMMARY', 'ANNUAL_SALES_SUMMARY_BY_WHOLESALE'] });
      assert.deepEqual(having, { dataSource: { _count: { equals: 2 } } });
      return [{ reportDate: asOfDate }, { reportDate: olderDate }];
    } },
    ohlqAnnualSalesRow: { groupBy: async ({ where, _sum }: Prisma.OhlqAnnualSalesRowGroupByArgs) => {
      assert.equal(where?.vendor, ECHO_VENDOR_ID);
      assert.deepEqual(_sum, { retailBottlesSold: true, wholesaleBottlesSold: true });
      assert.deepEqual(where?.OR, [
        { agencyId: '01234', brand: 'A', reportDate: { gte: new Date('2026-08-23T00:00:00Z'), lte: asOfDate } },
        { agencyId: '06543', brand: 'A', reportDate: { gte: new Date('2026-08-23T00:00:00Z'), lte: asOfDate } },
        { agencyId: '05678', brand: 'A', reportDate: { gte: new Date('2026-08-22T00:00:00Z'), lte: olderDate } },
        { agencyId: '07890', brand: 'A', reportDate: { gte: new Date('2026-08-22T00:00:00Z'), lte: olderDate } },
        { agencyId: '01234', brand: 'C', reportDate: { gte: new Date('2026-08-23T00:00:00Z'), lte: asOfDate } },
      ]);
      return [
        { agencyId: '01234', brand: 'A', _sum: { retailBottlesSold: 7, wholesaleBottlesSold: -2 } },
        { agencyId: '05678', brand: 'A', _sum: { retailBottlesSold: -3, wholesaleBottlesSold: 1 } },
      ];
    } },
    echoBottleSalesDayCoverage: { findMany: async () => Array.from({ length: 90 }, (_, index) => ({
      reportDate: getOhlqWindowStartDate(asOfDate, index + 1),
    })) },
    ohlqAgencyInventoryCurrent: { findMany: async ({ where }: Prisma.OhlqAgencyInventoryCurrentFindManyArgs) => {
      assert.equal(where?.organizationId, 'echo-test');
      assert.equal(where?.vendorId, ECHO_VENDOR_ID);
      return [{ agencyNumber: '06543', itemCode: 'A' }];
    } },
    $transaction: (reads: Promise<unknown>[], options: { isolationLevel: string }) => {
      assert.equal(options.isolationLevel, 'RepeatableRead');
      return Promise.all(reads);
    },
  } as unknown as PrismaClient;

  const totals = await getDeadInventorySales90('echo-test', recommendations, db);
  assert.deepEqual(totals.get('sold'), { bottles: 5, complete: true, through: asOfDate });
  assert.deepEqual(totals.get('zero'), { bottles: 0, complete: true, through: asOfDate });
  assert.deepEqual(totals.get('partial'), { bottles: -2, complete: false, through: olderDate });
  assert.deepEqual(totals.get('unknown'), { bottles: null, complete: false, through: olderDate });
  assert.equal(totals.has('outside-scope'), false);
  assert.deepEqual(totals.get('unknown-vendor'), { bottles: null, complete: false, through: asOfDate });
});

test('pagination preserves filters, validates input, and search resets to the first page', () => {
  const next = new URL(agencyFocusHref({ agencyId: 'a1', q: '3135B', state: 'STOCKOUT', page: 2 }), 'https://example.com');
  assert.equal(next.searchParams.get('page'), '2');
  assert.equal(next.searchParams.get('q'), '3135B');
  assert.equal(next.searchParams.get('agencyId'), 'a1');
  assert.equal(next.searchParams.get('state'), 'STOCKOUT');
  for (const value of [undefined, '', 'no', '-1', '0', '1.5', 'Infinity']) assert.equal(agencyFocusPageNumber(value), 1);
  assert.equal(agencyFocusHref({ page: 1 }), '/agency-focus');
  assert.equal(agencyFocusPageNumber('2'), 2);
  assert.match(readFileSync('app/agency-focus/AgencyFocusSearch.tsx', 'utf8'), /name="page" type="hidden" value="1"/);
});

test('shared Intelligence navigation group appears on desktop and mobile without replacing primary tabs', () => {
  const source = readFileSync('app/components/AppNavigation.tsx', 'utf8');
  assert.equal((source.match(/<IntelligenceMenu /g) ?? []).length, 2, 'desktop and mobile share the authorized Intelligence destinations');
  assert.doesNotMatch(source, /<SidebarDisclosure label="Intelligence"/, 'frequent desktop intelligence links are visible without expansion');
  assert.match(source, /getIntelligenceNavigationItems\(enabledFeatures, isAdmin, isPlatformAdmin\)/);
  assert.match(source, /label: 'Intelligence', items/);
  assert.match(source, /event.currentTarget.open = false/);
  assert.match(source, /prefix: '\/agency-focus'.*label: 'Retail Intelligence'/);
});
