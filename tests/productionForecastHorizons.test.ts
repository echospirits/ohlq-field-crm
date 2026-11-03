import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { backtest, createForecastComputationContext, forecastProduct, forecastProductHorizons, predict, scoreFolds, selectCoherentModel, selectModel, valuesKnownAt, type HorizonBacktests } from '../lib/productionForecasting/engine';
import { days, forecastHorizons, forecastRules, methods, parseForecastHorizon, rounded, shift, sum, type DemandSeries, type ForecastHorizon, type StoredProductForecast } from '../lib/productionForecasting/model';
import { evaluateHorizonActuals, getProductionDashboard, getProductionProduct, refreshProductionForecast, selectForecastHorizon, selectSummaryHorizon, storedSummaryFor } from '../lib/productionForecasting/service';

const asOf = '2026-10-26';
const product = { id: 'p', market: 'OH', code: 'RUM', name: 'Rum' };
function series(through = asOf): DemandSeries {
  return { market: 'OH', itemCode: 'RUM', location: { code: 'GPT', name: 'Groveport' }, coverage: [{ start: '2024-01-01', end: through }], observations: days('2024-01-01', through).map(date => ({ date, availableOn: date, cases: 2, classification: 'BAILMENT' })) };
}
const forecast = (horizon: ForecastHorizon, input = series()) => forecastProduct(product, [input], [], asOf, null, { ...forecastRules, horizonDays: horizon });
function stored(): StoredProductForecast {
  return { ...forecast(30), horizons: { 60: forecast(60), 90: forecast(90) } };
}

test('horizon query accepts only supported single values and defaults safely', () => {
  for (const h of forecastHorizons) assert.equal(parseForecastHorizon(String(h)), h);
  for (const invalid of [undefined, null, '120', '60junk', ['90'], {}, '0', 0]) assert.equal(parseForecastHorizon(invalid), 30);
});

test('each cumulative horizon has its own exact dates, prior year, compact buckets and total', () => {
  for (const h of forecastHorizons) {
    const result = forecast(h);
    assert.equal(result.horizonDays, h);
    assert.equal(result.end, shift(result.start, h - 1));
    assert.equal(result.point, h * 2);
    assert.equal(result.priorYear, h * 2);
    assert.equal(result.buckets.length, h === 30 ? 5 : h / 30);
    assert.equal(result.buckets.at(-1)?.end, result.end);
    assert.ok(Math.abs(sum(result.buckets.map(b => b.cases)) - result.point!) < 0.01);
  }
});

test('seasonal demand is predicted over the full horizon instead of multiplying a 30-day total', () => {
  const input = series();
  input.observations = input.observations.map(o => ({ ...o, cases: o.date.slice(5, 7) === '12' ? 20 : 2 }));
  const known = valuesKnownAt(input, asOf), start = shift(asOf, 1);
  const thirty = sum(predict('seasonal-naive', known, asOf, start, 30)!);
  const ninety = sum(predict('seasonal-naive', known, asOf, start, 90)!);
  assert.ok(ninety > thirty * 3);
  assert.equal(forecast(90, input).priorYear, ninety);
});

test('backtests evaluate complete nonoverlapping horizons and scale errors for the actual horizon', () => {
  for (const horizon of forecastHorizons) {
    const scores = backtest(series(), asOf, { ...forecastRules, horizonDays: horizon });
    const folds = scores.find(s => s.method === 'recent-mean')!.folds;
    assert.equal(folds.length, 8);
    for (let i = 0; i < folds.length; i++) {
      assert.equal(folds[i].actual, horizon * 2);
      assert.equal(folds[i].predicted, horizon * 2);
      assert.ok(shift(folds[i].origin, horizon) <= asOf);
      if (i) assert.equal(shift(folds[i - 1].origin, horizon), folds[i].origin);
    }
  }
  const fold = [{ origin: '2026-01-01', predicted: 180, actual: 90, error: -90, scale: 2 }];
  assert.equal(scoreFolds('recent-mean', fold, 90).mase, 0.5);
  assert.equal(scoreFolds('recent-mean', fold, 30).mase, 1.5);
});

test('late postings and future observations cannot influence any earlier horizon', () => {
  const original = series(), changed = series();
  changed.observations.push({ date: '2026-01-01', availableOn: '2026-10-27', cases: 1000000, classification: 'BAILMENT' });
  changed.observations.push({ date: '2027-01-01', availableOn: '2027-01-01', cases: 1000000, classification: 'BAILMENT' });
  for (const horizon of forecastHorizons) {
    assert.deepEqual(backtest(original, asOf, { ...forecastRules, horizonDays: horizon }), backtest(changed, asOf, { ...forecastRules, horizonDays: horizon }));
  }
  assert.deepEqual(forecastProductHorizons(product, [original], [], asOf), forecastProductHorizons(product, [changed], [], asOf), 'future postings cannot influence the shared model selection');
});

test('one shared daily trajectory prevents a seeded independent-model inversion and every error score uses its exact prefix', () => {
  const input = series();
  let state = 3;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  input.observations = input.observations.map((observation, i) => {
    const hit = random() < [0.03, 0.12, 0.02, 0.2][Math.floor(i / 75) % 4];
    return { ...observation, cases: hit ? Math.ceil(random() * 15) : 0 };
  });
  const context = createForecastComputationContext(), values = valuesKnownAt(input, asOf, context), start = shift(asOf, 1);
  const eligible = methods.filter(method => predict(method, values, asOf, start, 90) !== null);
  const independent = forecastHorizons.map(horizon => {
    const scores = backtest(input, asOf, { ...forecastRules, horizonDays: horizon }, context);
    const method = selectModel(scores, eligible, horizon);
    return sum(predict(method, values, asOf, start, 90)!.slice(0, horizon));
  });
  assert.ok(independent[1] < independent[0], 'fixture must reproduce the independent-model cumulative inversion');
  const bundle = forecastProductHorizons(product, [input], [], asOf, null, forecastRules, context);
  const selected = [bundle, bundle.horizons![60]!, bundle.horizons![90]!];
  assert.ok(selected[0].point! <= selected[1].point! && selected[1].point! <= selected[2].point!);
  assert.equal(new Set(selected.map(result => result.locations[0].method)).size, 1);
  for (const result of selected) {
    const location = result.locations[0], horizon = result.horizonDays!;
    const trajectory = predict(location.method!, values, asOf, start, 90)!;
    assert.equal(result.point, rounded(sum(trajectory.slice(0, horizon))));
    for (const fold of location.backtests.find(score => score.method === location.method)!.folds) {
      const training = valuesKnownAt(input, fold.origin, context);
      assert.equal(fold.predicted, sum(predict(location.method!, training, fold.origin, shift(fold.origin, 1), 90)!.slice(0, horizon)));
    }
  }
  assert.equal(bundle.horizons![60]!.buckets[0].cases, bundle.point);
  assert.equal(bundle.horizons![90]!.buckets[0].cases, bundle.point);
});

test('shared selection gives each horizon equal daily-error weight and excludes lucky insufficient-fold candidates', () => {
  const scores = Object.fromEntries(forecastHorizons.map(horizon => [horizon, [
    scoreFolds('recent-mean', [1, 2, 3].map(i => ({ origin: `2025-01-0${i}`, predicted: 100, actual: 100 + (horizon === 30 ? 90 : 0), error: horizon === 30 ? 90 : 0, scale: 1 })), horizon),
    scoreFolds('weighted-mean', [1, 2, 3].map(i => ({ origin: `2025-01-0${i}`, predicted: 100, actual: 100 + (horizon === 90 ? 180 : 0), error: horizon === 90 ? 180 : 0, scale: 1 })), horizon),
    scoreFolds('seasonal-naive', [{ origin: '2025-01-01', predicted: 100, actual: 100, error: 0, scale: 1 }], horizon),
  ]])) as HorizonBacktests;
  assert.equal(selectCoherentModel(scores, ['recent-mean', 'weighted-mean', 'seasonal-naive']), 'weighted-mean');
  const insufficient = Object.fromEntries(forecastHorizons.map(h => [h, scores[h].map(score => ({ ...score, folds: score.folds.slice(0, 2) }))])) as HorizonBacktests;
  assert.equal(selectCoherentModel(insufficient, ['recent-mean', 'weighted-mean']), 'weighted-mean');
});

test('change compares matching horizons only, and unavailable locations withhold every total', () => {
  const earlier = forecast(30);
  assert.equal(forecastProduct(product, [series()], [], asOf, earlier, { ...forecastRules, horizonDays: 90 }).change, null);
  for (const horizon of forecastHorizons) {
    const unknown = { ...series(), location: { code: 'GRN', name: 'Green' }, coverage: [], observations: [] };
    assert.equal(forecastProduct(product, [series(), unknown], [], asOf, null, { ...forecastRules, horizonDays: horizon }).point, null);
  }
});

test('bundled summary stays small, selects exact horizons, and never relabels legacy forecasts', () => {
  const detail = stored(), before = JSON.stringify(detail), summary = storedSummaryFor(detail);
  assert.equal(selectSummaryHorizon(summary, 90)?.point, 180);
  assert.equal(selectForecastHorizon(detail, 60)?.point, 120);
  assert.equal('horizons' in selectForecastHorizon(detail, 30)!, false);
  assert.equal('locations' in summary, false);
  assert.equal('history' in summary.horizons![90]!, false);
  assert.equal(selectSummaryHorizon(storedSummaryFor(forecast(30)), 90), null);
  assert.equal(selectForecastHorizon(forecast(30), 60), null);
  assert.equal(JSON.stringify(detail), before);
});

test('each saved horizon waits for complete actual coverage and freezes its first actual without changing predictions', () => {
  const detail = stored(), before = JSON.stringify(detail), summary = storedSummaryFor(detail);
  const now = new Date('2027-01-25T12:00:00Z');
  const partial = evaluateHorizonActuals(detail, summary, [series('2026-12-25')], '2026-12-25', now);
  assert.equal(partial.actuals?.[60]?.cases, 120);
  assert.equal(partial.actuals?.[90], undefined);
  assert.equal(partial.pendingActuals, true);
  assert.equal(partial.nextActualDue, detail.horizons![90]!.end);
  const gap = series('2027-01-24'); gap.coverage = [{ start: '2024-01-01', end: '2027-01-22' }, { start: '2027-01-24', end: '2027-01-24' }];
  assert.equal(evaluateHorizonActuals(detail, partial, [gap], '2027-01-24', now).actuals?.[90], undefined);
  const complete = evaluateHorizonActuals(detail, partial, [series('2027-01-24')], '2027-01-24', now);
  assert.equal(complete.actuals?.[90]?.cases, 180);
  assert.equal(complete.pendingActuals, false);
  assert.equal(complete.nextActualDue, null);
  const corrected = series('2027-01-24'); corrected.observations.forEach(o => { o.cases = 100; });
  assert.deepEqual(evaluateHorizonActuals(detail, complete, [corrected], '2027-01-24', now), complete);
  assert.equal(JSON.stringify(detail), before);
});

test('refresh persists all horizons idempotently, reads summary only and evaluates actuals after the 30-day actual is already saved', async () => {
  const organizationId = 'org_echo_spirits';
  let through = asOf, latestRun: Record<string, any> | null = null;
  const runs: Array<Record<string, any>> = [], snapshots: Array<Record<string, any>> = [];
  const reads: Array<Record<string, any>> = [];
  const scoped = (args: Record<string, any>) => assert.equal(args.where.organizationId, organizationId);
  const db: Record<string, any> = {
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(db),
    $executeRaw: async () => 0,
    $queryRaw: async () => latestRun ? snapshots.filter(s => s.runId === latestRun!.id).map(s => ({ productId: s.productId, detail: s.detail })) : [],
    organization: { findFirst: async (args: { where: Record<string, any> }) => { assert.equal(args.where.id, organizationId); return { id: organizationId, enabledStates: ['OH'], settings: {}, timezone: 'America/New_York' }; } },
    organizationProduct: { findMany: async (args: { where: Record<string, any> }) => { scoped(args); return [{ id: product.id, market: 'OH', externalItemCode: product.code, displayName: product.name }]; } },
    ohlqAgencyInventoryCurrent: { findMany: async () => [] },
    ohlqTenantInventoryImportStatus: { findFirst: async () => null },
    ohlqBrandMasterItem: { findMany: async () => [] },
    productionSourceImport: { findMany: async (args: { where: Record<string, any> }) => { scoped(args); return [{ id: 'source', source: 'BAILMENT_PO_INVOICE', status: 'COMPLETE', observedOn: new Date(through), market: 'OH', coverageStart: new Date('2024-01-01'), coverageEnd: new Date(through), importedAt: new Date('2026-10-27T08:00:00Z'), rowCount: 1000, excludedRows: 0, summary: { scopes: [{ itemCode: product.code, locationCode: 'GPT', locationName: 'Groveport', classification: 'BAILMENT' }] } }]; } },
    productionDemandObservation: { findMany: async (args: { where: Record<string, any> }) => { scoped(args); return series(through).observations.map(o => ({ ...o, date: new Date(o.date), availableOn: new Date(o.availableOn), market: 'OH', itemCode: product.code, locationCode: 'GPT', locationName: 'Groveport', sourceImport: { importedAt: new Date('2026-10-27T08:00:00Z') } })); } },
    productionGuidanceObservation: { findMany: async (args: { where: Record<string, any> }) => { scoped(args); return []; } },
    productionForecastRun: {
      findUnique: async (args: { where: { organizationId_runKey: { organizationId: string; runKey: string } } }) => { assert.equal(args.where.organizationId_runKey.organizationId, organizationId); return runs.find(r => r.runKey === args.where.organizationId_runKey.runKey) ?? null; },
      findFirst: async (args: { where: Record<string, any> }) => { scoped(args); return latestRun; },
      create: async ({ data }: { data: Record<string, any> }) => { assert.equal(data.organizationId, organizationId); const run = { ...data, id: `run-${runs.length}` }; runs.push(run); latestRun = run; return run; },
    },
    productionForecastSnapshot: {
      findMany: async (args: Record<string, any>) => {
        scoped(args); reads.push(args);
        if (args.where.horizonEnd) {
          assert.deepEqual(args.where.OR, [{ actualEvaluatedAt: null }, { AND: [{ summary: { path: ['pendingActuals'], equals: true } }, { summary: { path: ['nextActualDue'], lt: args.where.horizonEnd.lt.toISOString().slice(0, 10) } }] }]);
          return snapshots.filter(s => s.horizonEnd < args.where.horizonEnd.lt && (!s.actualEvaluatedAt || s.summary.pendingActuals && s.summary.nextActualDue && s.summary.nextActualDue < args.where.OR[1].AND[1].summary.lt)).slice(0, args.take);
        }
        return snapshots.filter(s => !args.where.runId || s.runId === args.where.runId).map(s => ({ ...s, run: runs.find(r => r.id === s.runId) }));
      },
      findFirst: async (args: Record<string, any>) => { scoped(args); return snapshots.find(s => s.runId === args.where.runId && s.productId === args.where.productId) ?? null; },
      createMany: async ({ data }: { data: Array<Record<string, any>> }) => { data.forEach(s => { assert.equal(s.organizationId, organizationId); snapshots.push({ ...s, id: `snapshot-${snapshots.length}`, actualCases: null, actualEvaluatedAt: null }); }); },
      updateMany: async (args: Record<string, any>) => { scoped(args); assert.equal('detail' in args.data, false, 'prediction detail must never be rewritten'); Object.assign(snapshots.find(s => s.id === args.where.id)!, args.data); },
    },
  };
  const client = db as unknown as PrismaClient;
  const first = await refreshProductionForecast(organizationId, client, new Date('2026-10-27T12:00:00Z'));
  assert.equal((await refreshProductionForecast(organizationId, client, new Date('2026-10-27T12:00:00Z'))).id, first.id);
  assert.equal(snapshots.length, 1);
  const predictions = JSON.stringify(snapshots[0].detail);
  assert.equal(snapshots[0].summary.horizons[90].point, 180);
  const dashboard = await getProductionDashboard(organizationId, client, 90);
  assert.equal(dashboard.rows[0].point, 180); assert.equal(dashboard.run?.horizonEnd, '2027-01-24');
  const dashboardRead = reads.find(r => r.where.runId);
  assert.deepEqual(dashboardRead?.select, { productId: true, summary: true });
  // Simulate a previous refresh having already settled the legacy 30-day actual.
  snapshots[0].actualCases = 60; snapshots[0].actualEvaluatedAt = new Date('2026-11-26T12:00:00Z');
  const futureLongHorizons = Array.from({ length: 200 }, (_, i) => ({ ...snapshots[0], id: `not-due-${i}`, summary: structuredClone(snapshots[0].summary) }));
  const newlyDue = { ...snapshots[0], id: 'newly-due-30', horizonStart: new Date('2026-11-01'), horizonEnd: new Date('2026-11-30'), actualCases: null, actualEvaluatedAt: null, summary: { ...structuredClone(snapshots[0].summary), nextActualDue: '2026-12-30' } };
  snapshots.push(...futureLongHorizons, newlyDue);
  through = '2026-11-30';
  await refreshProductionForecast(organizationId, client, new Date('2026-12-01T12:00:00Z'));
  assert.equal(newlyDue.actualCases, 60, '200 older longer horizons that are not due must not starve a newer 30-day actual');
  assert.equal(Object.prototype.hasOwnProperty.call(snapshots[0].summary.actuals ?? {}, '60'), false);
  snapshots.splice(1); // End the queue fixture; retain the original saved forecast.
  through = '2027-01-24';
  await refreshProductionForecast(organizationId, client, new Date('2027-01-25T12:00:00Z'));
  assert.equal(snapshots[0].actualCases, 60);
  assert.equal(snapshots[0].summary.actuals[60].cases, 120);
  assert.equal(snapshots[0].summary.actuals[90].cases, 180);
  assert.equal(snapshots[0].summary.pendingActuals, false);
  assert.equal(JSON.stringify(snapshots[0].detail), predictions);
  const history = await getProductionProduct(organizationId, product.id, client, 90);
  assert.equal(history?.history.find(h => h.id === snapshots[0].id)?.actual, 180);
  // A legacy snapshot must never masquerade as a 90-day saved prediction.
  delete snapshots[1].summary.horizons; delete snapshots[1].detail.horizons;
  const legacy = await getProductionDashboard(organizationId, client, 90);
  assert.equal(legacy.rows[0].point, null); assert.equal(legacy.rows[0].horizonDays, 90);
  assert.match(legacy.rows[0].note ?? '', /90-day.*awaiting/);
});
