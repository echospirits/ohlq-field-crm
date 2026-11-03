import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ForecastTable } from '../app/analytics/production/ForecastTable';
import { ForecastDetail } from '../app/analytics/production/ForecastDetail';
import { ForecastHorizonSelector } from '../app/analytics/production/ForecastHorizonSelector';
import { ForecastConfidenceHelp } from '../app/analytics/production/ForecastConfidenceHelp';
import { forecastProduct } from '../lib/productionForecasting/engine';
import { days, forecastRules, type DemandSeries } from '../lib/productionForecasting/model';
import { summaryFor } from '../lib/productionForecasting/service';

const product = { id: 'rum', code: 'RUM', market: 'OH', name: 'Rum' };
const asOf = '2026-10-31';
const series: DemandSeries = { market: 'OH', itemCode: 'RUM', location: { code: 'GPT', name: 'Groveport' }, coverage: [{ start: '2024-01-01', end: asOf }], observations: days('2024-01-01', asOf).map(date => ({ date, availableOn: date, cases: 2, classification: 'BAILMENT' })) };

test('horizon links retain filters, tenant context and detail destination with one accessible current choice', () => {
  const html = renderToStaticMarkup(createElement(ForecastHorizonSelector, { horizon: 60, query: 'q=Rum&market=OH&confidence=Low&sort=name&organization=org_echo_spirits', path: '/analytics/production/rum' }));
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(html, /aria-current="page"[^>]*>60 days/);
  const links = html.match(/href="[^"]+"/g) ?? [];
  assert.equal(links.length, 3);
  for (const link of links) {
    assert.match(link, /\/analytics\/production\/rum\?/);
    for (const param of ['q=Rum', 'market=OH', 'confidence=Low', 'sort=name', 'organization=org_echo_spirits']) assert.ok(link.includes(param), param);
  }
});

test('selected 90-day summary and detail replace forecast labels without comparing 90-day bars with 30-day history', () => {
  const forecast = forecastProduct(product, [series], [], asOf, null, { ...forecastRules, horizonDays: 90 });
  const table = renderToStaticMarkup(createElement(ForecastTable, { rows: [summaryFor(forecast)], horizon: 90, organizationId: 'org_echo_spirits', initial: { q: 'Rum' } }));
  assert.match(table, /90-day forecast \/ range/);
  assert.match(table, /Comparable 90 days/);
  assert.match(table, /\/analytics\/production\/rum\?[^\"]*horizon=90/);
  assert.doesNotMatch(table, /30-day forecast/);
  const detail = renderToStaticMarkup(createElement(ForecastDetail, { forecast }));
  assert.match(detail, /90-day production planning summary/);
  assert.match(detail, /30-day segments sum to the selected forecast/);
  assert.match(detail, /Historical 90-day checks for the selected method/);
  assert.match(detail, /<th scope="col">Forecast<\/th><th scope="col">Actual<\/th>/);
  assert.match(detail, /The 90-day forecast is shown above/);
  assert.doesNotMatch(detail, /class="pf-forecast-bar"/);
  assert.equal(forecast.buckets.length, 3);
});

test('confidence explanation distinguishes a rating, weakest location and unavailable zero-demand percentage error', () => {
  const html = renderToStaticMarkup(createElement(ForecastConfidenceHelp));
  assert.match(html, /<details[^>]*>/);
  assert.doesNotMatch(html, /<details[^>]* open/);
  assert.match(html, /not a probability/);
  assert.match(html, /lowest-confidence location/);
  assert.match(html, /all actual demand is zero/);
  assert.match(html, /More history can help/);
});
