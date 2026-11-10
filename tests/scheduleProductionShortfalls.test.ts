import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { UserRole } from '@prisma/client';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { ECHO_ORGANIZATION_ID } from '../lib/echoAccess';
import { isAdminRole } from '../lib/userAccess';
import { caseBalance, caseQuantity, cases } from '../lib/productionForecasting/presentation';
import { addDaysToDateInputValue } from '../lib/dateTime';
import { getSchedulerWeekDates, isValidSchedulerDate } from '../lib/myDayWeekScheduler';

type Balance = { inventoryCases: number | null; demandCases: number | null; balanceCases: number | null; status: 'AVAILABLE' | 'STALE' | 'UNAVAILABLE' };
type Row = { productId: string; itemCode: string; productName: string; warehouses: { GPT: Balance; GRN: Balance }; demand: { status: 'AVAILABLE'; stale: boolean; businessDate: string; sourceFreshness: 'CURRENT'; byWarehouse: { UNASSIGNED: number | null } } };
type Node = ReactElement<Record<string, unknown>>;
const returnTo = '/?view=week&date=2026-11-10';
const ready = (balanceCases = -3): Balance => ({ inventoryCases: 7, demandCases: 10, balanceCases, status: 'AVAILABLE' });
const row = (code = '3150B', GPT = ready(), GRN = ready(0)): Row => ({ productId: `product-${code}`, itemCode: code, productName: code === '3150B' ? 'ESTHER RUM' : `Product ${code}`, warehouses: { GPT, GRN }, demand: { status: 'AVAILABLE', stale: false, businessDate: '2026-11-10', sourceFreshness: 'CURRENT', byWarehouse: { UNASSIGNED: 0 } } });
const data = (rows: Row[]) => ({ today: '2026-11-10', rows });
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function loadModule(path: string, dependencies: Record<string, unknown>) {
  const filename = resolve(path), nativeRequire = createRequire(filename);
  const exports: Record<string, (...args: any[]) => any> = {};
  const values = { ECHO_ORGANIZATION_ID, isAdminRole, caseBalance, caseQuantity, cases, EASTERN_TIME_ZONE: 'America/New_York', ...dependencies };
  runInNewContext(ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, URLSearchParams,
    require: (name: string) => {
      if (['@prisma/client', 'react', 'react/jsx-runtime'].includes(name)) return nativeRequire(name);
      if (name === 'next/link') return { default: ({ href, children, ...props }: { href: string; children: ReactNode }) => createElement('a', { ...props, href }, children) };
      return new Proxy(values, { get: (items, key: keyof typeof values) => items[key] ?? (() => null) });
    },
  });
  return exports;
}

function nodes(root: ReactNode): Node[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(root)) return [];
  return [root, ...nodes(root.props.children as ReactNode)];
}

function widget(fetch: (organizationId: string) => Promise<unknown> = async () => data([])) {
  return loadModule('app/components/ScheduleProductionShortfalls.tsx', { getWarehouseBalanceSignals: fetch });
}

test('schedule shortfall reads require the active Echo feature and Admin/Sales role, never a taster or foreign tenant', async () => {
  const reads: string[] = [], component = widget(async organizationId => { reads.push(organizationId); return data([]); });
  const props = { organizationId: ECHO_ORGANIZATION_ID, enabled: true, returnTo };
  for (const role of [UserRole.ADMIN, UserRole.USER, UserRole.PLATFORM_ADMIN]) {
    assert.ok(await component.ScheduleProductionShortfalls({ ...props, role }));
  }
  assert.deepEqual(reads, [ECHO_ORGANIZATION_ID, ECHO_ORGANIZATION_ID, ECHO_ORGANIZATION_ID]);
  for (const extra of [{ role: UserRole.TASTER }, { role: UserRole.ADMIN, enabled: false }, { role: UserRole.USER, organizationId: 'another-organization' }]) {
    assert.equal(await component.ScheduleProductionShortfalls({ ...props, ...extra }), null);
  }
  assert.equal(reads.length, 3, 'denied callers must not read persisted forecasting data');
});

test('the widget shows every current negative product/warehouse balance, including forecast-only 3150B, with stock and demand context', () => {
  const component = widget();
  const input = data([row('3150B', ready(-3), ready(-2)), row('ZERO', ready(0), ready(1)), row('STALE', { ...ready(-99), status: 'STALE' }, { ...ready(-99), status: 'UNAVAILABLE' })]);
  const before = JSON.stringify(input);
  const html = renderToStaticMarkup(component.ProductionShortfallList({ data: input, returnTo }));
  assert.match(text(html), /ESTHER RUM 3150B GPT 7 10 -3 Shortfall/);
  assert.match(text(html), /ESTHER RUM 3150B GRN 7 10 -2 Shortfall/);
  assert.doesNotMatch(html, /Product ZERO|Product STALE|-99/);
  assert.match(text(html), /2 warehouse balances are unavailable or stale; current shortfalls may be incomplete/);
  const links = [...html.matchAll(/href="([^"]*product-3150B[^"]*)"/g)];
  assert.equal(links.length, 2);
  const destination = new URL(links[0][1].replaceAll('&amp;', '&'), 'https://neat.example');
  assert.equal(destination.pathname, '/analytics/production/product-3150B');
  assert.equal(destination.searchParams.get('returnTo'), returnTo);
  assert.equal(destination.searchParams.get('horizon'), '30');
  assert.equal(JSON.stringify(input), before, 'presentation must not change the forecast-only product or source records');
});

test('all shortfalls remain visible without a display cap or manufactured total', () => {
  const component = widget();
  const html = renderToStaticMarkup(component.ProductionShortfallList({ data: data(Array.from({ length: 25 }, (_, index) => row(String(index), ready(-1), ready(-2)))), returnTo }));
  assert.equal((html.match(/class="numeric schedule-shortfall-balance"/g) ?? []).length, 50);
  assert.match(html, /Product 24/);
  assert.doesNotMatch(html, /show more|View all shortfalls|sales products/i);
});

test('a small fractional shortfall never rounds to a displayed zero balance', () => {
  const component = widget();
  const html = renderToStaticMarkup(component.ProductionShortfallList({ data: data([row('FRACTION', ready(-0.0001), ready(0))]), returnTo }));
  assert.match(html, /<strong>-0\.0001<\/strong>/);
  assert.doesNotMatch(html, /<strong>-?0<\/strong>/);
});

test('fractional DC inventory keeps source precision alongside its exact balance', () => {
  const component = widget(), inventory = { inventoryCases: 1.25, demandCases: 10, balanceCases: -8.75, status: 'AVAILABLE' as const };
  const html = renderToStaticMarkup(component.ProductionShortfallList({ data: data([row('FRACTION', inventory, ready(0))]), returnTo }));
  assert.match(text(html), /GPT 1\.25 10 -8\.75 Shortfall/);
  assert.doesNotMatch(html, />1\.3</);
});

test('known positive unassigned demand is disclosed without allocation, while unknown, zero and stale amounts add no note', () => {
  const component = widget(), first = row('FIRST', ready(1), ready(1)), second = row('SECOND', ready(1), ready(1));
  first.demand.byWarehouse.UNASSIGNED = 2;
  second.demand.byWarehouse.UNASSIGNED = 3;
  const html = renderToStaticMarkup(component.ProductionShortfallList({ data: data([first, second]), returnTo }));
  assert.match(text(html), /Known demand without a warehouse assignment: 5 cases/);
  assert.doesNotMatch(html, /schedule-shortfall-balance/, 'unassigned demand must not become a warehouse shortfall');
  first.demand.byWarehouse.UNASSIGNED = null;
  second.demand.stale = true;
  const unavailable = renderToStaticMarkup(component.ProductionShortfallList({ data: data([first, second, row('ZERO')]), returnTo }));
  assert.doesNotMatch(unavailable, /without a warehouse assignment/);
});

test('known zero, unavailable coverage, empty portfolio, loading and read failure have distinct honest states', async () => {
  const component = widget();
  const known = text(renderToStaticMarkup(component.ProductionShortfallList({ data: data([row('ZERO', ready(0), ready(1))]), returnTo })));
  assert.match(known, /No warehouse shortfalls/);
  const unknown = text(renderToStaticMarkup(component.ProductionShortfallList({ data: data([row('UNKNOWN', { ...ready(), balanceCases: null, status: 'UNAVAILABLE' }, ready(0))]), returnTo })));
  assert.match(unknown, /No current shortfalls confirmed/);
  assert.match(unknown, /1 warehouse balance is unavailable or stale/);
  const empty = text(renderToStaticMarkup(component.ProductionShortfallList({ data: data([]), returnTo })));
  assert.match(empty, /No eligible forecasting products/);
  const loading = renderToStaticMarkup(component.ScheduleProductionShortfallsLoading());
  assert.match(loading, /aria-busy="true"/); assert.match(loading, /role="status"/);
  const failed = widget(async () => { throw new Error('PRIVATE PROVIDER OR DATABASE ERROR'); });
  const html = renderToStaticMarkup(await failed.ScheduleProductionShortfalls({ organizationId: ECHO_ORGANIZATION_ID, role: UserRole.USER, enabled: true, returnTo }));
  assert.match(text(html), /Warehouse balances are unavailable/);
  assert.doesNotMatch(html, /PRIVATE|No warehouse shortfalls/);
});

test('My Schedule places the authorized widget before the scheduler and keeps date/view in its detail-return context', async () => {
  const component = widget();
  const ScheduleProductionShortfalls = () => null, WorklistScheduler = () => null;
  const empty = { count: async () => 0, findMany: async () => [], groupBy: async () => [] };
  for (const role of [UserRole.ADMIN, UserRole.USER, UserRole.PLATFORM_ADMIN, UserRole.TASTER]) {
    for (const enabled of [true, false]) {
      const page = loadModule('app/page.tsx', {
        requireUser: async () => ({ id: 'trusted-user', role, organizationId: ECHO_ORGANIZATION_ID }),
        requireOrganizationContext: async () => ({ organizationId: ECHO_ORGANIZATION_ID }),
        getOrganizationFeatures: async () => new Set(enabled ? ['PRODUCTION_FORECASTING'] : []),
        getSchedulerWeekDates, isValidSchedulerDate, addDaysToDateInputValue,
        getUserDisplayName: () => 'Trusted user',
        formatEasternDateInputValue: () => '2026-11-10',
        getWorklistLocations: async () => new Map(),
        canViewScheduleProductionShortfalls: component.canViewScheduleProductionShortfalls,
        ScheduleProductionShortfalls, WorklistScheduler,
        prisma: { worklistItem: empty, loggedVisit: empty, visitPhoto: empty, menuPlacement: empty, user: empty },
      });
      const tree = nodes(await page.default({ searchParams: Promise.resolve({ view: 'week', date: '2026-11-10' }) }));
      const widgetIndex = tree.findIndex(node => node.type === ScheduleProductionShortfalls);
      if (role === UserRole.TASTER || !enabled) {
        assert.equal(widgetIndex, -1);
      } else {
        assert.ok(widgetIndex >= 0);
        assert.ok(widgetIndex < tree.findIndex(node => node.type === WorklistScheduler));
        assert.equal(tree[widgetIndex].props.organizationId, ECHO_ORGANIZATION_ID);
        assert.equal(tree[widgetIndex].props.returnTo, returnTo);
      }
    }
  }
});
