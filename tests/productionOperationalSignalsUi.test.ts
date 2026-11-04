import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ForecastTable } from '../app/analytics/production/ForecastTable';
import { ForecastDetail } from '../app/analytics/production/ForecastDetail';
import { CurrentDemandSummary, DeliveryAvailability, type DemandRow } from '../app/analytics/production/OperationalSignals';
import { forecastProduct, forecastProductHorizons } from '../lib/productionForecasting/engine';
import { days, type DemandSeries } from '../lib/productionForecasting/model';
import { summaryFor } from '../lib/productionForecasting/service';
import { calculateCurrentDemand } from '../lib/productionForecasting/operationalSignals/demand';
import { calendarLeadDays, deliveryBaseline } from '../lib/productionForecasting/operationalSignals/delivery';

const product = { id: 'rum', market: 'OH', code: 'RUM', name: 'Rum' };
const asOf = '2026-11-02';
const sourceUpdatedAt = '2026-11-03T07:01:00.000Z';
const observedAt = '2026-11-03T13:00:00.000Z';
const forecast = { ...summaryFor(forecastProduct(product, [], [], asOf)), point: 34, lower: 20, upper: 48, target: 40, priorYear: 12, note: null };
const demand = (overrides: Partial<DemandRow> = {}): DemandRow => ({
  productId: 'rum', itemCode: 'RUM', productName: 'Rum', status: 'AVAILABLE', reason: null,
  businessDate: '2026-11-03', grossCases: 30, demandCases: 30, inboundCases: null, bottlesPerCase: 6, agencyCount: 3,
  byWarehouse: { GPT: 18, GRN: 12, UNASSIGNED: 0 }, sourceObservedAt: observedAt, sourceUpdatedAt,
  sourceUpdatedAtOrigin: 'OPS_PRODUCTS_FOOTNOTE', sourceUpdatedAtStatus: 'KNOWN', observedAgeMinutes: 0, sourceAgeMinutes: 359, sourceFreshness: 'CURRENT',
  checkedAt: observedAt, checkDate: '2026-11-03', stale: false, retained: false, method: 'OVERNIGHT_AGENCY_MIN_ESTIMATE', ...overrides,
});
const renderDemand = (row?: DemandRow, expanded = false) => renderToStaticMarkup(createElement(CurrentDemandSummary, { row, expanded, forecast30: forecast.point }));
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

test('forecast table renders 34 forecast cases and 30 current-demand cases independently with an unchanged 40-case target', () => {
  const html = renderToStaticMarkup(createElement(ForecastTable, { rows: [forecast], currentDemand: { rum: demand() }, organizationId: 'org_echo_spirits' }));
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
  const cells = body.match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/g) ?? [];
  assert.equal(cells.length, 8);
  assert.match(cells[1], /<strong>34<\/strong>/);
  assert.match(cells[2], /<strong>30 cases<\/strong>/);
  assert.match(cells[3], /<strong>40<\/strong>/);
  assert.match(text(html), /34 forecast cases · 40 planning target cases/);
  assert.match(text(html), /88% of the 30-day forecast · separate estimate/);
  assert.match(text(html), /not added to any forecast or planning target/);
  assert.doesNotMatch(html, />64(?: cases)?</, 'current demand must never be added to the statistical forecast');
  assert.match(cells[2], /data-label="Immediate demand estimate"/);
  assert.match(cells[1], /data-label="30-day forecast"/);
  assert.equal((html.match(/class="pf-current-demand/g) ?? []).length, 1, 'one record renders once for both viewport layouts');
});

test('table and expanded per-product summary agree on the current demand total and warehouse components', () => {
  const row = demand();
  const table = text(renderToStaticMarkup(createElement(ForecastTable, { rows: [forecast], currentDemand: { rum: row } })));
  const detail = text(renderDemand(row, true));
  assert.match(table, /Immediate demand estimate/);
  assert.match(table, /30 cases To agency MIN/);
  assert.match(detail, /^30 cases Agency replenishment to MIN/);
  assert.match(detail, /GPT: 18 · GRN: 12/);
  assert.equal(row.byWarehouse.GPT! + row.byWarehouse.GRN!, row.demandCases);
  assert.match(detail, /Each agency’s bottle gap is rounded up to whole cases before summing/);
  assert.match(detail, /in-transit stock is not independently reconciled/);
});

test('known zero, missing source, and a retained stale estimate remain visibly different states', () => {
  const zero = renderDemand(demand({ grossCases: 0, demandCases: 0, byWarehouse: { GPT: 0, GRN: 0, UNASSIGNED: 0 } }));
  assert.match(zero, /<strong>0 cases<\/strong>/); assert.match(zero, /No agency replenishment gap/);
  const missing = renderDemand();
  assert.match(missing, /<strong>Unavailable<\/strong>/); assert.doesNotMatch(missing, /<strong>0 cases<\/strong>/);
  const unavailable = renderDemand(demand({ status: 'UNAVAILABLE', demandCases: null, grossCases: null, reason: 'MISSING_QUANTITY' }), true);
  assert.match(unavailable, /Warehouse demand is unavailable until a complete source check succeeds/);
  assert.doesNotMatch(unavailable, /<strong>0 cases<\/strong>/);
  const retained = renderDemand(demand({ status: 'FAILED', stale: true, retained: true, reason: 'upstream-unavailable' }), true);
  assert.match(retained, /<strong>Stale estimate<\/strong>/); assert.match(retained, /Last estimate: 30 cases/);
  assert.match(text(retained), /Latest attempt: .*failed/);
  assert.doesNotMatch(retained, /<strong>30 cases<\/strong>/, 'the old estimate cannot masquerade as current');
});

test('pending source with no saved amount is unavailable rather than a stale or retained estimate', () => {
  const pending = demand({ status: 'PENDING', demandCases: null, grossCases: null, businessDate: null, sourceObservedAt: null, sourceUpdatedAt: null, sourceUpdatedAtOrigin: null, sourceUpdatedAtStatus: 'MISSING', sourceFreshness: 'UNKNOWN', sourceAgeMinutes: null, observedAgeMinutes: null, checkedAt: null, checkDate: null, stale: true, retained: false, agencyCount: null, bottlesPerCase: null, byWarehouse: { GPT: null, GRN: null, UNASSIGNED: null } });
  for (const expanded of [false, true]) {
    const html = renderDemand(pending, expanded);
    assert.match(html, /<strong>Unavailable<\/strong>/);
    assert.doesNotMatch(html, /Stale estimate|Last estimate:/);
  }
});

test('source-ineligible item explains exclusion without presenting a zero replenishment estimate', () => {
  const excluded = demand({ status: 'UNAVAILABLE', reason: 'SOURCE_INELIGIBLE', demandCases: null, grossCases: null, sourceObservedAt: null, sourceUpdatedAt: null, stale: true, retained: false, byWarehouse: { GPT: null, GRN: null, UNASSIGNED: null } });
  const compact = renderDemand(excluded);
  assert.match(compact, /<strong>Unavailable<\/strong>/);
  assert.match(compact, /Excluded by OPS status/);
  assert.doesNotMatch(compact, /0 cases|No agency replenishment gap|Stale estimate/);
  const expanded = text(renderDemand(excluded, true));
  assert.match(expanded, /OPS identifies this item as A-3a Dist or inactive\. It is excluded from immediate-demand totals/);
  assert.doesNotMatch(expanded, /Warehouse demand is unavailable until a complete source check succeeds|0 cases|No agency replenishment gap/);
});

test('publication time and observation time have separate labels; unknown publication time is explicit', () => {
  const detail = text(renderDemand(demand(), true));
  assert.match(detail, /Last successful observation: Nov 3, 2026, 8:00 AM EST/);
  assert.match(detail, /Coverage source as of: Nov 3, 2026, 2:01 AM EST/);
  const compact = text(renderDemand(demand()));
  assert.match(compact, /Source as of Nov 3, 2026, 2:01 AM EST/);
  const unknown = demand({ sourceUpdatedAt: null, sourceUpdatedAtOrigin: null, sourceUpdatedAtStatus: 'MISSING', sourceFreshness: 'UNKNOWN' });
  assert.match(text(renderDemand(unknown)), /Observed Nov 3, 2026, 8:00 AM EST · source refresh time unverified/);
  assert.match(text(renderDemand(unknown, true)), /Coverage source as of: Source refresh time could not be verified/);
  assert.doesNotMatch(text(renderDemand(unknown, true)), /Coverage source as of: Nov 3, 2026, 8:00 AM/);
  const evening = demand({ sourceUpdatedAt: '2026-11-04T03:01:00.000Z', sourceObservedAt: '2026-11-04T13:00:00.000Z', stale: true, retained: true, sourceFreshness: 'STALE' });
  assert.match(text(renderDemand(evening, true)), /Coverage source as of: Nov 3, 2026, 10:01 PM EST/);
  assert.doesNotMatch(text(renderDemand(evening, true)), /Inventory through|2:01 AM EST/);
});

test('product operational context follows the forecast summary and alerts before detailed forecast explanations', () => {
  const detail = { ...forecastProduct(product, [], [], asOf), point: 34, lower: 20, upper: 48, target: 40, alerts: ['Forecast changed'] };
  const operationalContext = createElement('div', { id: 'operational-context' },
    createElement('section', null, createElement('h2', null, 'Current Demand'), createElement(CurrentDemandSummary, { row: demand(), forecast30: 34, expanded: true })),
    createElement(DeliveryAvailability, { data: deliveryData(warehouse()), now: new Date(observedAt) }));
  const html = renderToStaticMarkup(createElement(ForecastDetail, { forecast: detail, operationalContext }));
  const summary = html.indexOf('aria-label="30-day production planning summary"');
  const alert = html.indexOf('Forecast changed');
  const current = html.indexOf('<h2>Current Demand</h2>');
  const delivery = html.indexOf('id="delivery-availability-heading"');
  const explanation = html.indexOf('Why this forecast?');
  assert.ok(summary >= 0 && summary < alert && alert < current && current < delivery && delivery < explanation);
  assert.match(html.slice(summary, current), /<strong>34 cases<\/strong>/);
  assert.match(html.slice(summary, current), /<strong>40 cases<\/strong>/);
  assert.match(html.slice(current, delivery), /<strong>30 cases<\/strong>/);
  assert.equal((html.match(/<h2>Current Demand<\/h2>/g) ?? []).length, 1);
  assert.doesNotMatch(html, />64 cases</);
});

test('operational source normalization leaves all three cumulative statistical forecasts unchanged', () => {
  const series: DemandSeries = { market: 'OH', itemCode: 'RUM', location: { code: 'GPT', name: 'Groveport' }, coverage: [{ start: '2024-01-01', end: asOf }], observations: days('2024-01-01', asOf).map(date => ({ date, availableOn: date, cases: 2, classification: 'BAILMENT' })) };
  const before = forecastProductHorizons(product, [series], [], asOf);
  const saved = JSON.stringify(before);
  const row = ['30221', 1, '30221', 'Agency', 'City', '43215', 'MIN', 14, null, 0, 100, 1, 2, false, null, ''];
  assert.equal(calculateCurrentDemand('RUM', { data: [row], inProcess: false, productName: 'Rum', statusCode: '70', detailCode: 'A3A BAIL', bpc: '6', cntMin: 1, cntManual: 0, cntRestricted: 0 }).status, 'ok');
  assert.equal(calendarLeadDays(observedAt, '2026-11-06T13:00:00Z', 'America/New_York'), 3);
  deliveryBaseline([], observedAt, 3, 'America/New_York');
  const after = forecastProductHorizons(product, [series], [], asOf);
  assert.equal(JSON.stringify(after), saved);
  assert.deepEqual([after.point, after.horizons?.[60]?.point, after.horizons?.[90]?.point], [60, 120, 180]);
  for (const horizon of [30, 60, 90] as const) {
    const selected = horizon === 30 ? after : after.horizons![horizon]!;
    const html = text(renderToStaticMarkup(createElement(ForecastTable, { rows: [summaryFor(selected)], horizon, currentDemand: { rum: demand() } })));
    assert.match(html, new RegExp(`${horizon}-day forecast`));
    assert.match(html, /Immediate demand estimate/);
    assert.match(html, /30 cases To agency MIN/);
    if (horizon !== 30) assert.doesNotMatch(html, /% of the 30-day forecast/);
  }
});

type DeliveryData = ComponentProps<typeof DeliveryAvailability>['data'];
type Warehouse = DeliveryData['warehouses'][number];
function warehouse(locationCode: 'GPT' | 'GRN' = 'GPT', overrides: Partial<Warehouse> = {}): Warehouse {
  const observation: NonNullable<Warehouse['latestObservation']> = {
    id: `observation-${locationCode}`, organizationId: 'org_echo_spirits', market: 'OH', locationCode,
    locationName: locationCode === 'GPT' ? 'Groveport' : 'Green', warehouseId: 'warehouse', loadTypeId: 'ltl', timezone: 'America/New_York', source: 'OPENDOCK',
    observedOn: '2026-11-03', observedAt, status: 'SUCCESS', earliestAvailableAt: '2026-11-06T14:00:00.000Z', earliestAvailableDate: '2026-11-06',
    rawEarliestAvailableAt: '2026-11-06T14:00:00Z', calendarDays: 3, businessDays: null, businessDayMethod: null, checkedThrough: '2026-12-03T13:00:00.000Z',
  };
  return {
    market: 'OH', locationCode, locationName: observation.locationName, timezone: observation.timezone, configured: true,
    latestObservation: observation, lastAvailableObservation: observation,
    latestCheck: { status: 'SUCCESS', attemptedAt: observedAt, diagnosticCode: null, checkedThrough: observation.checkedThrough, attemptCount: 1 },
    lastSuccessfulCheckAt: observedAt, freshness: 'current', ageDays: 0,
    baseline: { stage: 'INSUFFICIENT_HISTORY', classification: null, typicalDays: null, sampleDays: 1, toleranceDays: null },
    history: [observation], ...overrides,
  };
}
const deliveryData = (...warehouses: Warehouse[]): DeliveryData => ({ configuration: { configured: true, locations: [], issue: null }, warehouses });

test('delivery UI withholds a typical lead time until sufficient history and keeps warehouse states separate', () => {
  const configured = warehouse();
  const missing = warehouse('GRN', { configured: false, latestObservation: null, lastAvailableObservation: null, latestCheck: null, lastSuccessfulCheckAt: null, freshness: 'unavailable', ageDays: null, history: [] });
  const html = renderToStaticMarkup(createElement(DeliveryAvailability, { data: deliveryData(configured, missing), now: new Date(observedAt) }));
  assert.match(text(html), /GPT Groveport Next available: .*3 calendar days out/);
  assert.match(text(html), /GRN Green OpenDock is not configured/);
  assert.match(text(html), /Insufficient history for a typical lead time at either warehouse/);
  assert.doesNotMatch(html, /About average|More than average|Less than average|0 calendar days out/);
  assert.doesNotMatch(html, /operating business days/, 'missing source calendar must not invent business-day counts');
});

test('stale delivery availability and a failed latest attempt retain the last successful observation transparently', () => {
  const retained = warehouse('GPT', { freshness: 'stale', ageDays: 3, latestCheck: { status: 'AUTH_FAILED', attemptedAt: '2026-11-06T13:00:00.000Z', diagnosticCode: 'UPSTREAM_AUTHENTICATION', checkedThrough: null, attemptCount: 2 } });
  const html = renderToStaticMarkup(createElement(DeliveryAvailability, { data: deliveryData(retained), now: new Date('2026-11-06T13:00:00.000Z') }));
  assert.match(text(html), /Last observed availability: Nov 6, 2026, 9:00 AM EST/);
  assert.match(text(html), /3 calendar days out · stale observation/);
  assert.match(text(html), /Last successful check: Nov 3, 2026, 8:00 AM EST/);
  assert.match(html, /role="status"/);
  assert.match(text(html), /Latest check did not succeed .*The last successful observation is retained/);
  assert.doesNotMatch(html, /Next available: <\/span>/);
  assert.match(html, /GPT daily delivery history/);
});

test('delivery no-slot observation remains bounded and distinct from a known same-day appointment', () => {
  const noSlot = warehouse();
  noSlot.latestObservation = { ...noSlot.latestObservation!, status: 'NO_AVAILABILITY', earliestAvailableAt: null, calendarDays: null, businessDays: null };
  noSlot.latestCheck = { ...noSlot.latestCheck!, status: 'NO_AVAILABILITY' };
  const noSlotHtml = text(renderToStaticMarkup(createElement(DeliveryAvailability, { data: deliveryData(noSlot), now: new Date(observedAt) })));
  assert.match(noSlotHtml, /No appointments in the checked range through/);
  assert.doesNotMatch(noSlotHtml, /0 calendar days out|Latest check did not succeed/);
  const sameDay = warehouse();
  sameDay.latestObservation = { ...sameDay.latestObservation!, earliestAvailableAt: '2026-11-03T19:00:00.000Z', earliestAvailableDate: '2026-11-03', calendarDays: 0 };
  assert.match(text(renderToStaticMarkup(createElement(DeliveryAvailability, { data: deliveryData(sameDay), now: new Date(observedAt) }))), /0 calendar days out/);
});

test('a same-day observed appointment that has passed is historical availability, not the next available slot', () => {
  const sameDay = warehouse();
  sameDay.latestObservation = { ...sameDay.latestObservation!, earliestAvailableAt: '2026-11-03T19:00:00.000Z', earliestAvailableDate: '2026-11-03', calendarDays: 0 };
  const html = renderToStaticMarkup(createElement(DeliveryAvailability, { data: deliveryData(sameDay), now: new Date('2026-11-03T20:00:00.000Z') }));
  assert.match(text(html), /Last observed availability: Nov 3, 2026, 2:00 PM EST/);
  assert.match(text(html), /This observed slot has passed\. The next morning check will update availability/);
  assert.doesNotMatch(html, /<span>Next available: <\/span>/);
});

test('yesterday no-slot result is a stale bounded observation rather than a current unavailability claim', () => {
  const yesterday = warehouse('GPT', { freshness: 'delayed', ageDays: 1 });
  yesterday.latestObservation = { ...yesterday.latestObservation!, status: 'NO_AVAILABILITY', earliestAvailableAt: null, earliestAvailableDate: null, calendarDays: null, businessDays: null };
  yesterday.latestCheck = { ...yesterday.latestCheck!, status: 'NO_AVAILABILITY' };
  const html = renderToStaticMarkup(createElement(DeliveryAvailability, { data: deliveryData(yesterday), now: new Date('2026-11-04T13:00:00.000Z') }));
  assert.match(text(html), /Last observed: no appointments in the checked range through Dec 3, 2026, 8:00 AM EST · stale observation/);
  assert.doesNotMatch(html, /<p>No appointments in the checked range/);
  assert.doesNotMatch(html, /Latest check did not succeed|0 calendar days out/);
});
