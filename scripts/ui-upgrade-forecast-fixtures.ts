// Render actual forecasting components with synthetic, deterministic records.
// No database reads, provider calls or server actions are used.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createElement as h, type ReactNode } from 'react';
import ts from 'typescript';
import { forecastProduct } from '../lib/productionForecasting/engine';
import { days, type DemandSeries } from '../lib/productionForecasting/model';

function load(path: string, mocks: Record<string, unknown>, revision?: string) {
  const filename = resolve(path), nativeRequire = createRequire(filename), exports: Record<string, any> = {};
  const source = revision ? execFileSync('git', ['show', `${revision}:${path}`], { encoding: 'utf8' }) : readFileSync(filename, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, { exports, process, URLSearchParams, Date, require: (name: string) => name in mocks ? mocks[name] : nativeRequire(name) });
  return exports;
}

export function buildForecastFixtures(revision?: string): Record<string, ReactNode> {
  const link = { default: ({ children, scroll: _scroll, ...props }: any) => h('a', props, children) };
  const chrome = load('app/components/PageChrome.tsx', {}, revision);
  const signals = load('app/analytics/production/OperationalSignals.tsx', { 'next/link': link }, revision);
  const horizon = load('app/analytics/production/ForecastHorizonSelector.tsx', { 'next/link': link }, revision);
  const confidence = load('app/analytics/production/ForecastConfidenceHelp.tsx', {}, revision);
  const table = load('app/analytics/production/ForecastTable.tsx', { 'next/link': link, '../../components/PageChrome': chrome, './ForecastHorizonSelector': horizon, './OperationalSignals': signals }, revision);
  const detail = load('app/analytics/production/ForecastDetail.tsx', { '../../components/PageChrome': chrome, './ForecastConfidenceHelp': confidence }, revision);
  const rows = ['White Rum', 'Straight Rye Whiskey', 'Coffee Liqueur', 'Spiced Rum', 'Summer Gin', 'Aged Rum', 'Special Release with a deliberately long product name', 'Seasonal Cordial'].map((name, index) => ({
    product: { id: `fixture-product-${index}`, name, code: `FX-${100 + index}`, market: 'OH' },
    point: index === 6 ? null : 22 + index * 7, lower: 18 + index * 5, upper: 35 + index * 8,
    target: index === 6 ? null : 27 + index * 8, safetyFactor: .2, priorYear: 18 + index * 6,
    yoy: index === 4 ? null : .12 - index * .02, recentTrend: -.04 + index * .01,
    guidanceMinimum: index * 2, guidanceMaximum: 12 + index * 4, guidanceThrough: index === 5 ? null : '2026-11-04',
    confidence: index === 6 ? 'Low' : index % 2 ? 'Medium' : 'High', change: index === 0 ? null : .04,
    alerts: index === 6 ? ['Incomplete outbound history'] : [], note: 'Insufficient verified source history for this horizon.',
  }));
  const currentDemand = Object.fromEntries(rows.map((row, index) => [row.product.id, {
    product: row.product, demandCases: index === 5 ? null : index === 2 ? 0 : 9 + index * 2,
    grossCases: index === 5 ? null : 9 + index * 2, byWarehouse: { GPT: 6, GRN: 3, UNASSIGNED: 0 },
    status: index === 4 ? 'FAILED' : index === 5 ? 'UNAVAILABLE' : 'AVAILABLE',
    reason: index === 4 ? 'STALE_SOURCE' : index === 5 ? 'MISSING_CASE_PACK' : null,
    stale: index === 4, retained: index === 4, sourceObservedAt: '2026-11-04T12:30:00Z',
    sourceUpdatedAt: index === 4 ? '2026-11-02T07:00:00Z' : '2026-11-04T07:00:00Z', checkedAt: '2026-11-04T12:30:00Z',
  }]));
  const warehouse = (locationCode: string, calendarDays: number) => ({
    locationCode, locationName: locationCode === 'GPT' ? 'Groveport' : 'Green', timezone: 'America/New_York', configured: true,
    latestObservation: { id: `fixture-${locationCode}`, status: 'SUCCESS', observedOn: '2026-11-04', observedAt: '2026-11-04T12:30:00Z', earliestAvailableAt: locationCode === 'GPT' ? '2026-11-10T11:00:00Z' : '2026-11-06T11:00:00Z', calendarDays, businessDays: null, checkedThrough: '2026-12-04T23:59:59Z' },
    latestCheck: null, lastSuccessfulCheckAt: '2026-11-04T12:30:00Z', freshness: 'current',
    baseline: { typicalDays: null, sampleDays: 1, classification: null, stage: 'INSUFFICIENT' }, history: [],
  });
  const delivery = h(signals.DeliveryAvailability, { data: { configuration: {}, warehouses: [warehouse('GPT', 6), warehouse('GRN', 2)] }, now: new Date('2026-11-04T17:00:00Z') });
  const series: DemandSeries = { market: 'OH', itemCode: 'FX-100', location: { code: 'GPT', name: 'Groveport' }, coverage: [{ start: '2024-01-01', end: '2026-11-03' }], observations: days('2024-01-01', '2026-11-03').map(date => ({ date, availableOn: date, cases: 2, classification: 'BAILMENT' })) };
  const forecast = forecastProduct(rows[0].product, [series], [], '2026-11-03');
  return {
    forecast: h('div', { className: 'pf-page' }, h(chrome.PageHeader, { title: 'Production Forecasting' }), h('div', { className: 'pf-freshness' }, h('strong', null, 'Nov 4 – Dec 3, 2026'), h('span', null, 'Forecast data through Nov 3 · Synthetic fixture')), delivery, h(table.ForecastTable, { rows, currentDemand, horizon: 30 })),
    'forecast-detail': h('div', { className: 'pf-page' }, h(detail.ForecastDetail, { forecast, operationalContext: h(signals.CurrentDemandSummary, { row: currentDemand['fixture-product-0'], forecast30: forecast.point, expanded: true }) })),
    'forecast-states': h('div', { className: 'pf-page' }, h(chrome.PageHeader, { title: 'Data availability states' }), h('dl', { className: 'read-summary' }, ...[0, 2, 4, 5].map(index => h('div', { key: index }, h('dt', null, ['Current estimate', '', 'Known zero', '', 'Retained stale estimate', 'Unavailable source'][index]), h('dd', null, h(signals.CurrentDemandSummary, { row: currentDemand[`fixture-product-${index}`], forecast30: rows[index].point }))))), h('p', { role: 'alert', className: 'notice danger' }, 'Unable to save. Your entries are preserved.'), h('p', { role: 'status', className: 'toast-notice' }, 'Visit saved. Follow-up added to Worklist.'), h('div', { 'aria-busy': true, role: 'status' }, 'Loading account details…'), h('button', { disabled: true }, 'Save visit'), h(chrome.EmptyState, { title: 'No matching work', description: 'Clear filters to see all work.', action: h('button', { type: 'button', className: 'secondary' }, 'Clear filters') })),
  };
}
