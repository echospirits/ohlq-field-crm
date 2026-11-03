import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { applyPlanningExclusions, matchesDemandExclusion, parseDemandExclusions, type DemandExclusion, type DemandExclusionHistoryRow } from '../lib/productionForecasting/exclusions';
import { demandIdentity } from '../lib/productionForecasting/reconciliation';
import { loadForecastSources, refreshProductionForecast, storedSummaryFor } from '../lib/productionForecasting/service';
import { forecastProductHorizons } from '../lib/productionForecasting/engine';
import { days, type DemandSeries, type ForecastProduct } from '../lib/productionForecasting/model';

const asOf = '2026-11-02';
const organizationId = 'org_echo_spirits';
const badLine = demandIdentity('fixture-erroneous-line', '2021-10-05');
const rule: DemandExclusion = {
  market: 'OH', itemCode: 'OLD', date: '2021-10-05', sourceLineId: badLine,
  locationCode: 'DIRECT:EXAMPLE', reason: 'Owner-approved exclusion of a suspected erroneous historical fixture.',
  approvedAt: '2026-11-03T15:00:00.000Z',
};
const settings = (rules: unknown = [rule]) => ({ productionForecasting: { demandExclusions: rules } });
const product: ForecastProduct = { id: 'old-product', market: 'OH', code: 'OLD', name: 'Historical fixture product' };
const anotherProduct: ForecastProduct = { id: 'rum', market: 'OH', code: 'RUM', name: 'Fixture rum' };
function history(overrides: Partial<DemandExclusionHistoryRow> = {}): DemandExclusionHistoryRow {
  return { id: 'erroneous-line', ...rule, availableOn: rule.date, cases: 5, classification: 'A3A_BAIL', transactionStatus: 'POSTED', importedAt: '2026-10-28T12:00:00.000Z', ...overrides };
}
function coverage(itemCode: string): DemandExclusionHistoryRow {
  return history({ id: `coverage-${itemCode}`, itemCode, sourceLineId: demandIdentity(`coverage:${itemCode}:${rule.locationCode}`, '2019-01-01'), date: '2019-01-01', availableOn: '2019-01-01', cases: 0, sourceEvidence: { original: null } });
}
function source(itemCode = product.code, locationCode = 'GPT', value = 2): DemandSeries {
  return { market: 'OH', itemCode, location: { code: locationCode, name: locationCode }, classification: 'A3A_BAIL', coverage: [{ start: '2024-01-01', end: asOf }], observations: value === 0 ? [] : days('2024-01-01', asOf).map(date => ({ date, availableOn: date, cases: value, classification: 'A3A_BAIL' })) };
}

test('demand exclusions require complete, auditable exact rules and reject a broad or malformed policy', () => {
  assert.deepEqual(parseDemandExclusions(undefined), []);
  assert.deepEqual(parseDemandExclusions({}), []);
  assert.deepEqual(parseDemandExclusions(settings()), [rule]);
  for (const invalid of [null, {}, 'EXAMPLE', [{ ...rule, sourceLineId: '*' }], [{ ...rule, date: '2021-02-29' }], [{ ...rule, locationCode: '' }], [{ ...rule, reason: '' }], [{ ...rule, approvedAt: 'yesterday' }], [{ ...rule, approvedAt: '2026-02-30T12:00:00Z' }]]) {
    assert.throws(() => parseDemandExclusions(settings(invalid)));
  }
  const { itemCode: _itemCode, ...withoutProduct } = rule;
  assert.throws(() => parseDemandExclusions(settings([withoutProduct])), 'An agency-only exclusion must not be accepted.');
  assert.throws(() => parseDemandExclusions(settings([rule, { ...rule, reason: 'A conflicting duplicate rule.' }])));
});

test('exclusions match the canonical source line together with market, product, movement date and location', () => {
  const row = history();
  assert.equal(matchesDemandExclusion(row, rule), true);
  for (const changed of [
    { market: 'FL' }, { itemCode: 'RUM' }, { date: '2021-10-06' },
    { locationCode: 'DIRECT:OTHER' }, { sourceLineId: demandIdentity('a-different-invoice', rule.date) },
  ]) assert.equal(matchesDemandExclusion({ ...row, ...changed }, rule), false);
  const rawIdentity = 'a-retained-original-invoice-line';
  assert.equal(matchesDemandExclusion({ ...row, sourceLineId: rawIdentity }, { ...rule, sourceLineId: demandIdentity(rawIdentity, rule.date) }), true, 'Legacy original identities and their canonical stored versions share the same exact match.');
});

test('the exact historical exclusion removes only its now-unfounded planning route, preserving the original data and zero coverage for actual settlement', () => {
  const series = [source(), source(product.code, rule.locationCode, 0), source(anotherProduct.code, rule.locationCode, 0), source(product.code, 'DIRECT:OTHER', 0)];
  const rows = [history(), coverage(anotherProduct.code)];
  const before = JSON.stringify({ series, rows });
  const result = applyPlanningExclusions(series, [rule], rows, asOf);
  assert.deepEqual(result.series.map(value => value.location.code), ['GPT', 'DIRECT:OTHER']);
  assert.equal(result.actualSeries.filter(value => value.location.code === rule.locationCode).length, 2, 'Older saved forecasts still need the complete covered zero series to settle actuals.');
  assert.equal(JSON.stringify({ series, rows }), before, 'The overlay must not mutate retained observations or their coverage.');
  assert.equal(applyPlanningExclusions(series, [rule], [], asOf).series.length, series.length, 'A rule that has never matched a retained source line cannot prune an agency.');
});

test('another genuine invoice for the same agency reactivates planning, while future or not-yet-known demand cannot reactivate a past forecast', () => {
  const series = [source(), source(product.code, rule.locationCode, 0), source(anotherProduct.code, rule.locationCode, 0)];
  const valid = history({ id: 'genuine-new-line', sourceLineId: demandIdentity('genuine-new-line', '2026-10-01'), date: '2026-10-01', availableOn: '2026-10-01', cases: 3 });
  assert.equal(applyPlanningExclusions(series, [rule], [history(), coverage(anotherProduct.code), valid], asOf).series.length, 3);
  for (const notKnown of [
    { ...valid, date: '2026-11-03', availableOn: '2026-11-03' },
    { ...valid, availableOn: '2026-11-03' },
  ]) assert.equal(applyPlanningExclusions(series, [rule], [history(), coverage(anotherProduct.code), notKnown], asOf).series.length, 1);
});

test('route existence uses the latest known correction and ignores zero, cancelled or excluded-classification movements', () => {
  const series = [source(), source(product.code, rule.locationCode, 0), source(anotherProduct.code, rule.locationCode, 0)];
  const valid = history({ id: 'v1', sourceLineId: demandIdentity('another-invoice', '2026-10-01'), date: '2026-10-01', availableOn: '2026-10-01', cases: 3 });
  for (const correction of [{ cases: 0 }, { transactionStatus: 'CANCELLED' }, { classification: 'A3A_DIST' as const }]) {
    const latest = { ...valid, ...correction, id: 'v2', importedAt: '2026-10-29T12:00:00.000Z' };
    const result = applyPlanningExclusions(series, [rule], [history(), coverage(anotherProduct.code), latest, valid], asOf);
    assert.equal(result.series.some(value => value.itemCode === anotherProduct.code && value.location.code === rule.locationCode), false, 'An older positive version must not resurrect derived planning scopes after the invoice was effectively removed.');
  }
  const restored = { ...valid, id: 'v3', importedAt: '2026-10-30T12:00:00.000Z' };
  assert.equal(applyPlanningExclusions(series, [rule], [history(), coverage(anotherProduct.code), { ...valid, id: 'v2', cases: 0 }, restored], asOf).series.length, 3);
});

test('warehouse coverage, genuine native zero invoices and manual zero evidence cannot be pruned as synthetic direct artifacts', () => {
  const gptRule = { ...rule, locationCode: 'GPT' };
  const gptSeries = source(product.code, 'GPT', 0);
  gptSeries.observations.push({ date: rule.date, availableOn: rule.date, sourceLineId: badLine, cases: 5, classification: 'A3A_BAIL' });
  const physical = applyPlanningExclusions([gptSeries, source(anotherProduct.code, 'GPT', 0)], [gptRule], [history({ locationCode: 'GPT' })], asOf);
  assert.equal(physical.series.length, 2, 'The physical warehouse exists independently of the excluded invoice.');
  assert.equal(physical.series[0].observations.length, 0, 'The exact bad observation is still excluded.');
  const zeroSeries = [source(product.code, rule.locationCode, 0), source(anotherProduct.code, rule.locationCode, 0)];
  const manualZero = history({ id: 'manual-zero', itemCode: anotherProduct.code, sourceLineId: demandIdentity('manual-zero', '2026-10-01'), date: '2026-10-01', availableOn: '2026-10-01', cases: 0 });
  const nativeZero = { ...manualZero, sourceEvidence: { original: { Invoice_Number: 'genuine-zero-native-invoice' } } };
  for (const retained of [manualZero, nativeZero]) {
    const result = applyPlanningExclusions(zeroSeries, [rule], [history(), retained], asOf);
    assert.equal(result.series.some(value => value.itemCode === anotherProduct.code), true, 'A genuine/manual zero series retains its evidence instead of being guessed away.');
  }
});

test('the original excluded product need not remain eligible for its provable derivative scopes to be removed', () => {
  const onlyEligible = [source(anotherProduct.code, rule.locationCode, 0)];
  const result = applyPlanningExclusions(onlyEligible, [rule], [history(), coverage(anotherProduct.code)], asOf);
  assert.equal(result.series.length, 0);
  assert.equal(result.actualSeries.length, 1);
  assert.equal(result.summary.matchedRules, 1);
});

test('every version of the exact approved line is excluded without filtering another line at the same agency', () => {
  const otherLine = demandIdentity('another-invoice-at-the-same-agency', rule.date);
  const input = source(product.code, rule.locationCode, 0);
  input.observations = [
    { date: rule.date, availableOn: rule.date, sourceLineId: badLine, versionAt: '2026-10-28T12:00:00Z', cases: 5, classification: 'A3A_BAIL' },
    { date: rule.date, availableOn: '2026-10-29', sourceLineId: badLine, versionAt: '2026-10-29T12:00:00Z', cases: 6, classification: 'A3A_BAIL' },
    { date: rule.date, availableOn: rule.date, sourceLineId: otherLine, cases: 7, classification: 'A3A_BAIL' },
  ];
  const before = JSON.stringify(input);
  const result = applyPlanningExclusions([input], [rule], [history(), history({ id: 'correction', cases: 6, availableOn: '2026-10-29', importedAt: '2026-10-29T12:00:00.000Z' }), history({ id: 'other-line', sourceLineId: otherLine, cases: 7 })], asOf);
  assert.equal(result.series.length, 1);
  assert.deepEqual(result.series[0].observations.map(row => row.sourceLineId), [otherLine]);
  assert.equal(result.summary.excludedObservationVersions, 2);
  assert.equal(JSON.stringify(input), before);
});

type FixtureRecord = Record<string, any>;
function databaseFixture(seedOld = false) {
  let configuredRules: DemandExclusion[] = [];
  const products = [product, anotherProduct];
  const historyRows: DemandExclusionHistoryRow[] = [history(), coverage(anotherProduct.code), ...products.flatMap(p => source(p.code).observations.map((row, index) => history({ id: `${p.id}-${index}`, itemCode: p.code, locationCode: 'GPT', sourceLineId: demandIdentity(`${p.code}-${row.date}`, row.date), date: row.date, availableOn: row.availableOn, cases: row.cases })))];
  const scopes = products.flatMap(p => ['GPT', rule.locationCode].map(locationCode => ({ itemCode: p.code, locationCode, locationName: locationCode, classification: 'A3A_BAIL' })));
  const imports = [{ id: 'complete-source', source: 'BAILMENT_PO_INVOICE', status: 'COMPLETE', market: 'OH', coverageStart: new Date('2019-01-01'), coverageEnd: new Date(asOf), importedAt: new Date('2026-11-03T08:00:00Z'), rowCount: historyRows.length, excludedRows: 0, summary: { scopes } }];
  const runs: FixtureRecord[] = [];
  const snapshots: FixtureRecord[] = [];
  const queries: FixtureRecord[] = [];
  const scoped = (args: FixtureRecord) => assert.equal(args.where.organizationId, organizationId, 'Every source and snapshot query must retain the target tenant.');
  const nativeRows = () => historyRows.map(row => ({ ...row, locationName: row.locationCode, date: new Date(row.date), availableOn: new Date(row.availableOn), sourceImport: { importedAt: new Date(row.importedAt) } }));
  const latest = () => runs.at(-1) ?? null;
  const db: FixtureRecord = {
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(db),
    $executeRaw: async () => 0,
    $queryRaw: async () => snapshots.filter(snapshot => snapshot.runId === latest()?.id).map(snapshot => ({ productId: snapshot.productId, detail: snapshot.detail })),
    organization: { findFirst: async (args: FixtureRecord) => { assert.equal(args.where.id, organizationId); return { id: organizationId, enabledStates: ['OH'], timezone: 'America/New_York', settings: settings(configuredRules) }; } },
    organizationProduct: { findMany: async (args: FixtureRecord) => { scoped(args); return products.map(p => ({ id: p.id, market: p.market, externalItemCode: p.code, displayName: p.name })); } },
    ohlqAgencyInventoryCurrent: { findMany: async () => [] },
    ohlqTenantInventoryImportStatus: { findFirst: async () => null },
    ohlqBrandMasterItem: { findMany: async () => [] },
    productionSourceImport: { findMany: async (args: FixtureRecord) => { scoped(args); queries.push(args); return imports; } },
    productionDemandObservation: { findMany: async (args: FixtureRecord) => {
      scoped(args); queries.push(args);
      assert.equal(args.where.sourceImport.status, 'COMPLETE');
      assert.ok(args.where.date.lte instanceof Date);
      assert.ok(args.where.availableOn.lte instanceof Date);
      return nativeRows().filter(row => row.date <= args.where.date.lte && (!args.where.date.gte || row.date >= args.where.date.gte) && row.availableOn <= args.where.availableOn.lte && args.where.OR.some((condition: FixtureRecord) => Object.entries(condition).every(([key, value]) => (row as FixtureRecord)[key] === value)));
    } },
    productionGuidanceObservation: { findMany: async (args: FixtureRecord) => { scoped(args); queries.push(args); return []; } },
    productionForecastRun: {
      findUnique: async (args: FixtureRecord) => { assert.equal(args.where.organizationId_runKey.organizationId, organizationId); return runs.find(run => run.runKey === args.where.organizationId_runKey.runKey) ?? null; },
      create: async ({ data }: FixtureRecord) => { assert.equal(data.organizationId, organizationId); const run = { ...data, id: `run-${runs.length}` }; runs.push(run); return run; },
    },
    productionForecastSnapshot: {
      findMany: async (args: FixtureRecord) => { scoped(args); return snapshots.filter(snapshot => snapshot.horizonEnd < args.where.horizonEnd.lt && (!snapshot.actualEvaluatedAt || snapshot.summary.pendingActuals && snapshot.summary.nextActualDue < args.where.horizonEnd.lt.toISOString().slice(0, 10))).slice(0, args.take); },
      createMany: async ({ data }: FixtureRecord) => { for (const snapshot of data) { assert.equal(snapshot.organizationId, organizationId); snapshots.push({ ...snapshot, id: `snapshot-${snapshots.length}`, actualCases: null, actualEvaluatedAt: null }); } },
      updateMany: async ({ where, data }: FixtureRecord) => { scoped({ where }); assert.equal('detail' in data, false, 'An exclusion must never rewrite a saved prediction document.'); Object.assign(snapshots.find(snapshot => snapshot.id === where.id)!, data); },
    },
  };
  if (seedOld) {
    const old = forecastProductHorizons(product, [source(), source(product.code, rule.locationCode, 0)], [], '2026-07-31');
    runs.push({ id: 'old-run', runKey: 'old-run-key', generatedAt: new Date('2026-08-01T12:00:00Z') });
    snapshots.push({ id: 'old-snapshot', organizationId, runId: 'old-run', productId: product.id, market: product.market, itemCode: product.code, horizonStart: new Date(old.start), horizonEnd: new Date(old.end), point: old.point, summary: storedSummaryFor(old), detail: old, actualCases: null, actualEvaluatedAt: null });
  }
  return { db: db as unknown as PrismaClient, products, historyRows, imports, runs, snapshots, queries, setRules: (rules: DemandExclusion[]) => { configuredRules = rules; } };
}

test('source loading scopes exclusion provenance to the tenant and affected location, including an excluded product that is no longer eligible', async () => {
  const f = databaseFixture();
  const before = JSON.stringify({ history: f.historyRows, imports: f.imports });
  const untouched = await loadForecastSources(f.db, organizationId, f.products, asOf);
  assert.equal(untouched.series.length, 4);
  const overlaid = await loadForecastSources(f.db, organizationId, f.products, asOf, [rule]);
  assert.deepEqual(overlaid.series.map(series => series.location.code), ['GPT', 'GPT']);
  assert.equal(overlaid.actualSeries.length, 4);
  const ineligibleOriginal = await loadForecastSources(f.db, organizationId, [anotherProduct], asOf, [rule]);
  assert.equal(ineligibleOriginal.series.length, 1);
  assert.equal(ineligibleOriginal.series[0].itemCode, anotherProduct.code);
  const provenanceQueries = f.queries.filter(query => query.select?.sourceEvidence);
  assert.equal(provenanceQueries.length, 2);
  assert.deepEqual(provenanceQueries[1].where.OR, [{ market: rule.market, locationCode: rule.locationCode }], 'Retained provenance cannot be limited to the current active product list.');
  assert.equal(provenanceQueries[1].where.date.gte, undefined, 'The erroneous transaction is older than the bounded fitting window.');
  assert.equal(JSON.stringify({ history: f.historyRows, imports: f.imports }), before);
});

test('changing only the approved exclusion creates a new same-day run with persisted policy and replay-safe audit metadata', async () => {
  const f = databaseFixture();
  const before = JSON.stringify({ history: f.historyRows, imports: f.imports });
  const first = await refreshProductionForecast(organizationId, f.db, new Date('2026-11-03T12:00:00Z'));
  const originalPredictions = f.snapshots.map(snapshot => JSON.stringify(snapshot.detail));
  assert.ok(f.snapshots.every(snapshot => snapshot.detail.locations.some((location: FixtureRecord) => location.location.code === rule.locationCode)));
  f.setRules([rule]);
  const second = await refreshProductionForecast(organizationId, f.db, new Date('2026-11-03T13:00:00Z'));
  assert.notEqual(second.id, first.id);
  assert.notEqual(f.runs[0].runKey, f.runs[1].runKey, 'The source import IDs and day are unchanged; the exclusion policy must invalidate the run key.');
  assert.deepEqual(f.runs[1].configuration.demandExclusions, [rule]);
  assert.deepEqual(f.runs[1].sourceSummary.demandExclusions, { configuredRules: 1, matchedRules: 1, unmatchedRules: 0, excludedObservationVersions: 0, prunedSeries: 2, prunedLocations: [{ market: rule.market, locationCode: rule.locationCode }] });
  const newSnapshots = f.snapshots.filter(snapshot => snapshot.runId === second.id);
  assert.equal(newSnapshots.length, 2);
  assert.ok(newSnapshots.every(snapshot => snapshot.detail.locations.every((location: FixtureRecord) => location.location.code !== rule.locationCode)));
  const replay = await refreshProductionForecast(organizationId, f.db, new Date('2026-11-03T14:00:00Z'));
  assert.equal(replay.id, second.id);
  assert.equal(replay.replay, true);
  assert.equal(f.runs.length, 2);
  assert.deepEqual(f.snapshots.slice(0, 2).map(snapshot => JSON.stringify(snapshot.detail)), originalPredictions);
  assert.equal(JSON.stringify({ history: f.historyRows, imports: f.imports }), before);
});

test('old forecasts still settle every complete horizon when the excluded direct location survives only as covered actual zeroes', async () => {
  const f = databaseFixture(true);
  const old = f.snapshots[0];
  const prediction = JSON.stringify(old.detail);
  f.setRules([rule]);
  await refreshProductionForecast(organizationId, f.db, new Date('2026-11-03T12:00:00Z'));
  assert.equal(old.actualCases, 60, 'The 30-day actual must not remain pending because planning pruned a formerly expected location.');
  assert.equal(old.summary.actuals[60].cases, 120);
  assert.equal(old.summary.actuals[90].cases, 180);
  assert.equal(old.summary.pendingActuals, false);
  assert.equal(old.point, 60);
  assert.equal(JSON.stringify(old.detail), prediction);
});
