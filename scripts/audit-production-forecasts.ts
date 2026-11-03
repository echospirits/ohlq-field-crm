// Read-only diagnostics: never creates runs, imports, sessions or actuals.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnvironmentFile } from '../lib/environmentFile';
import type { BacktestFold, Classification, ForecastHorizon, ForecastProduct, GuidanceObservation, LocationForecast, StoredProductForecast } from '../lib/productionForecasting/model';

const allowedArguments = new Set(['environment', 'env-file', 'organization', 'as-of', 'holdout-folds', 'output']);
const argumentsByName = new Map<string, string>();
for (const argument of process.argv.slice(2)) {
  const match = /^--([^=]+)=(.+)$/.exec(argument);
  if (!match || !allowedArguments.has(match[1]) || argumentsByName.has(match[1])) {
    throw new Error('Use explicit --environment=test --env-file=<file> --organization=<id>; optional --as-of=YYYY-MM-DD, --holdout-folds=1..8 and --output=output/<file>.json.');
  }
  argumentsByName.set(match[1], match[2]);
}

function scores(folds: Pick<BacktestFold, 'actual' | 'predicted' | 'error'>[]) {
  const actual = folds.reduce((total, fold) => total + Math.abs(fold.actual), 0);
  const absoluteError = folds.reduce((total, fold) => total + Math.abs(fold.error), 0);
  return {
    folds: folds.length,
    mae: folds.length ? absoluteError / folds.length : null,
    wape: actual > 0 ? absoluteError / actual : null,
    bias: actual > 0 ? folds.reduce((total, fold) => total + fold.predicted - fold.actual, 0) / actual : null,
  };
}

function selectedScore(location: LocationForecast) {
  return location.backtests.find(score => score.method === location.method);
}

function combinedFolds(locations: LocationForecast[]) {
  const selected = locations.map(selectedScore);
  if (!selected.length || selected.some(score => !score)) return [];
  const first = selected[0]!;
  return first.folds.flatMap(fold => {
    const matching = selected.map(score => score!.folds.find(candidate => candidate.origin === fold.origin));
    if (matching.some(candidate => !candidate)) return [];
    const predicted = matching.reduce((total, candidate) => total + candidate!.predicted, 0);
    const actual = matching.reduce((total, candidate) => total + candidate!.actual, 0);
    return [{ origin: fold.origin, predicted, actual, error: actual - predicted }];
  });
}

async function main() {
  const startedAt = Date.now();
  const output = argumentsByName.get('output');
  let outputTarget: string | null = null;
  if (output) {
    const root = path.resolve('output'), target = path.resolve(output), relative = path.relative(root, target);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative) || path.extname(target) !== '.json') throw new Error('Output must be a JSON file inside this worktree output directory.');
    if (existsSync(target)) throw new Error('Choose a new output filename; audits never overwrite prior evidence.');
    outputTarget = target;
  }
  const envFile = argumentsByName.get('env-file'), organizationId = argumentsByName.get('organization');
  const holdoutFolds = Number(argumentsByName.get('holdout-folds') ?? 3);
  if (!Number.isInteger(holdoutFolds) || holdoutFolds < 1 || holdoutFolds > 8) throw new Error('Holdout folds must be an integer from 1 to 8.');
  if (argumentsByName.get('environment') !== 'test' || !envFile || !organizationId) {
    throw new Error('An explicit test environment, environment file and organization are required.');
  }
  // Load the named file independently: a preexisting shell credential cannot
  // silently override the selected database identity.
  const loaded: Record<string, string | undefined> = {};
  loadEnvironmentFile(path.resolve(envFile), { environment: loaded });
  if (loaded.APP_ENV !== 'test' || loaded.DATABASE_ENVIRONMENT !== 'test' || loaded.DATABASE_TARGET_ID !== 'neon-neat-tst' || !loaded.DATABASE_URL || !loaded.EXPECTED_DATABASE_HOST || new URL(loaded.DATABASE_URL).hostname !== loaded.EXPECTED_DATABASE_HOST) {
    throw new Error('The named file must identify verified neon-neat-tst and its matching test database host.');
  }
  Object.assign(process.env, loaded);
  const { validateRuntimeEnvironment } = await import('../lib/appEnvironment');
  validateRuntimeEnvironment();
  const { PrismaClient } = await import('@prisma/client');
  const { forecastAccess } = await import('../lib/productionForecasting/import');
  const { configuredProducts, loadForecastSources, selectForecastHorizon } = await import('../lib/productionForecasting/service');
  const { parseDemandExclusions } = await import('../lib/productionForecasting/exclusions');
  const { forecastProductHorizons, createForecastComputationContext, valuesKnownAt, predict } = await import('../lib/productionForecasting/engine');
  const { MODEL_VERSION, forecastConfiguration, forecastHorizons, shift, validDay, days, sum, completeSum, dayCount, dateOnly } = await import('../lib/productionForecasting/model');
  const { formatDateInputValue } = await import('../lib/dateTime');
  const db = new PrismaClient();
  try {
    const input = await db.$transaction(async tx => {
      // PostgreSQL enforces read-only access for every query below, including
      // any future additions to the shared source-loading functions.
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const organization = await forecastAccess(tx, organizationId);
      const yesterday = shift(formatDateInputValue(new Date(), organization.timezone), -1);
      const asOf = argumentsByName.get('as-of') ?? yesterday;
      if (!validDay(asOf) || asOf > yesterday) throw new Error('As-of must be a completed date, no later than yesterday in the organization timezone.');
      const products = await configuredProducts(tx, organizationId, organization.enabledStates);
      const demandExclusions = parseDemandExclusions(organization.settings);
      const sources = await loadForecastSources(tx, organizationId, products, asOf, demandExclusions);
      // Dashboard loading intentionally reads only latest guidance. Historical
      // evaluation needs the location identities established at each cutoff.
      const guidanceRows = products.length ? await tx.productionGuidanceObservation.findMany({ where: { organizationId, OR: products.map(product => ({ market: product.market, itemCode: product.code })), observedOn: { lte: new Date(shift(asOf, 1)) }, classification: { not: 'A3A_DIST' }, sourceImport: { status: 'COMPLETE' } }, orderBy: [{ observedOn: 'desc' }, { id: 'desc' }], select: { market: true, itemCode: true, locationCode: true, locationName: true, observedOn: true, minimum: true, maximum: true, classification: true } }) : [];
      const guidanceHistory: GuidanceObservation[] = guidanceRows.map(row => ({ market: row.market, itemCode: row.itemCode, location: { code: row.locationCode, name: row.locationName }, date: dateOnly(row.observedOn), minimum: row.minimum === null ? null : Number(row.minimum), maximum: row.maximum === null ? null : Number(row.maximum), classification: row.classification as Classification }));
      const savedRuns = await tx.productionForecastRun.aggregate({ where: { organizationId }, _count: true, _min: { generatedAt: true, horizonEnd: true }, _max: { generatedAt: true, horizonEnd: true } });
      const evaluatedSnapshots = await tx.productionForecastSnapshot.count({ where: { organizationId, actualEvaluatedAt: { not: null } } });
      return { asOf, products, sources, guidanceHistory, settings: organization.settings, demandExclusions, savedRuns, evaluatedSnapshots };
    }, { isolationLevel: 'RepeatableRead', timeout: 60000 });
    const config = forecastConfiguration(input.settings);
    const guidanceAt = (origin: string) => {
      const latest = new Map<string, GuidanceObservation>();
      for (const observation of input.guidanceHistory) {
        if (observation.date > shift(origin, 1)) continue;
        const key = JSON.stringify([observation.market, observation.itemCode, observation.location.code]);
        if (!latest.has(key)) latest.set(key, observation);
      }
      return [...latest.values()];
    };
    const context = createForecastComputationContext();
    const bundles = new Map<string, StoredProductForecast>();
    const forecastAt = (product: ForecastProduct, origin: string, horizon: ForecastHorizon) => {
      const key = JSON.stringify([product.id, origin]);
      let bundle = bundles.get(key);
      if (!bundle) {
        bundle = forecastProductHorizons(product, input.sources.series, guidanceAt(origin), origin, null, config, context);
        bundles.set(key, bundle);
      }
      const forecast = selectForecastHorizon(bundle, horizon);
      if (!forecast) throw new Error('The current model did not produce every supported horizon.');
      return forecast;
    };
    const horizons = forecastHorizons.map(horizonDays => {
      const products = input.products.map(product => {
        const horizonConfig = { ...config, horizonDays };
        const forecast = forecastAt(product, input.asOf, horizonDays);
        const folds = combinedFolds(forecast.locations);
        const series = input.sources.series.filter(source => source.market === product.market && source.itemCode === product.code);
        const knownActuals = new Map(series.map(source => [source.location.code, valuesKnownAt(source, input.asOf)]));
        // The outer test window is never used to select this fold's model.
        // Each historical call repeats the complete inner model-selection path.
        const outerFolds = Array.from({ length: holdoutFolds }, (_, index) => {
          const origin = shift(input.asOf, -(holdoutFolds - index) * horizonDays);
          const start = shift(origin, 1), end = shift(origin, horizonDays);
          const historical = forecastAt(product, origin, horizonDays);
          const actual = completeSum(historical.locations.map(location => {
            const values = knownActuals.get(location.location.code);
            return values ? completeSum(days(start, end).map(date => values.get(date) ?? null)) : null;
          }));
          const baseline = (method: 'weighted-mean' | 'seasonal-naive') => completeSum(historical.locations.map(location => {
            const source = series.find(candidate => candidate.location.code === location.location.code);
            if (!source) return null;
            const training = valuesKnownAt(source, origin), through = [...training.keys()].sort().at(-1);
            if (!through || dayCount(through, origin) - 1 > config.maxStaleDays) return null;
            const prediction = predict(method, training, through, start, horizonDays, horizonConfig);
            return prediction ? sum(prediction) : null;
          }));
          const selected = historical.point, weightedMean = baseline('weighted-mean'), seasonalNaive = baseline('seasonal-naive');
          return {
            origin, start, end, actual, selected, weightedMean, seasonalNaive,
            selectedError: actual === null || selected === null ? null : actual - selected,
            weightedMeanError: actual === null || weightedMean === null ? null : actual - weightedMean,
            seasonalNaiveError: actual === null || seasonalNaive === null ? null : actual - seasonalNaive,
            selectedMethods: historical.locations.map(location => ({ location: location.location.code, method: location.method })),
          };
        });
        const commonFolds = outerFolds.filter(fold => fold.actual !== null && fold.selected !== null && fold.weightedMean !== null && fold.seasonalNaive !== null);
        const outerScores = (method: 'selected' | 'weightedMean' | 'seasonalNaive', commonOnly: boolean) => {
          const available = (commonOnly ? commonFolds : outerFolds).filter(fold => fold.actual !== null && fold[method] !== null);
          return scores(available.map(fold => ({ predicted: fold[method]!, actual: fold.actual!, error: fold.actual! - fold[method]! })));
        };
        return {
          product: { id: product.id, market: product.market, code: product.code, name: product.name },
          start: forecast.start, end: forecast.end, point: forecast.point,
          lower: forecast.lower, upper: forecast.upper, target: forecast.target,
          confidence: forecast.confidence, reasons: forecast.reasons,
          combinedLocationBacktest: { ...scores(folds), observations: folds },
          historicalPipelineHoldout: {
            requestedFolds: holdoutFolds,
            selected: outerScores('selected', false),
            comparisonOnCommonOrigins: { selected: outerScores('selected', true), weightedMean: outerScores('weightedMean', true), seasonalNaive: outerScores('seasonalNaive', true) },
            observations: outerFolds,
          },
          locations: forecast.locations.map(location => ({
            location: location.location, point: location.point, confidence: location.confidence,
            method: location.method, dataThrough: location.dataThrough,
            historyDays: location.signals.historyDays, nonzeroDays: location.signals.nonzeroDays,
            volatility: location.signals.volatility, reasons: location.reasons,
            selectedMethodBacktest: selectedScore(location) ?? null,
          })),
        };
      });
      const locations = products.flatMap(product => product.locations);
      const locationFolds = locations.flatMap(location => location.selectedMethodBacktest?.folds ?? []);
      const holdoutObservations = products.flatMap(product => product.historicalPipelineHoldout.observations);
      const commonHoldouts = holdoutObservations.filter(fold => fold.actual !== null && fold.selected !== null && fold.weightedMean !== null && fold.seasonalNaive !== null);
      const aggregateHoldoutScore = (method: 'selected' | 'weightedMean' | 'seasonalNaive') => scores(commonHoldouts.map(fold => ({ predicted: fold[method]!, actual: fold.actual!, error: fold.actual! - fold[method]! })));
      const countConfidence = (values: { confidence: string }[]) => Object.fromEntries(['High', 'Medium', 'Low'].map(confidence => [confidence, values.filter(value => value.confidence === confidence).length]));
      const result = {
        horizonDays,
        aggregate: {
          products: products.length, forecastableProducts: products.filter(product => product.point !== null).length,
          productConfidence: countConfidence(products), locationConfidence: countConfidence(locations),
          zeroOnlyLocations: locations.filter(location => location.historyDays > 0 && location.nonzeroDays === 0).length,
          locationFoldScores: scores(locationFolds),
          holdoutComparisonOnCommonOrigins: { selected: aggregateHoldoutScore('selected'), weightedMean: aggregateHoldoutScore('weightedMean'), seasonalNaive: aggregateHoldoutScore('seasonalNaive') },
        },
        products,
      };
      console.error(JSON.stringify({ phase: 'historical-forecast-audit', completedHorizonDays: horizonDays, elapsedMilliseconds: Date.now() - startedAt }));
      return result;
    });
    const cumulativeReversals = input.products.flatMap(product => {
      const points = horizons.map(horizon => horizon.products.find(candidate => candidate.product.id === product.id)?.point ?? null);
      return points.every(point => point !== null) && (points[1]! < points[0]! || points[2]! < points[1]!) ? [{ productId: product.id, itemCode: product.code, points }] : [];
    });
    const report = {
      environment: 'test', databaseTarget: loaded.DATABASE_TARGET_ID, organizationId,
      generatedAt: new Date().toISOString(), asOf: input.asOf, modelVersion: MODEL_VERSION,
      elapsedMilliseconds: Date.now() - startedAt,
      computedProductOriginBundles: bundles.size,
      readOnly: true, sourceSummary: input.sources.sourceSummary,
      demandExclusions: input.demandExclusions,
      cumulativeReversals,
      savedRuns: input.savedRuns, evaluatedSavedSnapshots: input.evaluatedSnapshots,
      caveats: [
        'Diagnostic reconstructions use the current configured portfolio and retained source availability rules; they are not immutable forecasts saved at historical origins.',
        'Candidate selection and reported backtest scores use the same historical folds. These scores are model-selection diagnostics, not an independent holdout accuracy claim.',
        'Historical pipeline holdouts refit and select using only each outer origin and compare with later actuals. Each horizon uses nonoverlapping outer windows. Baselines are compared only on common available product/origin windows.',
        'Each origin selects one coherent 90-day daily trajectory per location; 30- and 60-day predictions are prefixes. Confidence and backtest error remain specific to each horizon.',
        'Historical reconstructions use the same bounded source read as the audit, so older fits can have fewer than 1,096 training days. Historical source and portfolio knowledge cannot be fully reconstructed.',
        'Current owner-approved exact source exclusions are applied as a retrospective correction policy; immutable historical forecast documents are not rewritten.',
        'Native availability is inferred from invoice and shipment chronology, not a reconstructed historical report-receipt timestamp. Retained corrections respect their recorded detection dates.',
        'Product confidence is the lowest location confidence. Zero-only actuals have undefined WAPE; undefined metrics do not establish high confidence.',
        'Combined-location scores sum selected location predictions on common origins. They are diagnostic product errors and do not replace the existing location confidence rules.',
        'WAPE and bias are fractions. Error is actual minus predicted; positive bias means overforecasting. Planning ranges are not guaranteed probability intervals.',
      ],
      horizons,
    };
    if (outputTarget) {
      mkdirSync(path.dirname(outputTarget), { recursive: true });
      writeFileSync(outputTarget, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
      console.log(JSON.stringify({ output: outputTarget, databaseTarget: loaded.DATABASE_TARGET_ID, asOf: input.asOf, readOnly: true, elapsedMilliseconds: report.elapsedMilliseconds, computedProductOriginBundles: bundles.size, cumulativeReversals, horizons: horizons.map(horizon => ({ horizonDays: horizon.horizonDays, ...horizon.aggregate })) }));
    } else console.log(JSON.stringify(report, null, 2));
  } finally { await db.$disconnect(); }
}

main().catch(() => { console.error('Read-only forecast audit failed. Verify the explicit test identity, completed as-of date, output path and database access. No credentials or raw source rows are logged.'); process.exitCode = 1; });
