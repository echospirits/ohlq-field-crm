import {
  type BacktestScore, type Confidence, type DemandSeries, type ForecastBucket, type ForecastConfig,
  type ForecastHorizon, type ForecastProduct, type GuidanceObservation, type LocationForecast, type Method, type ProductForecast,
  type Signals, type StoredProductForecast, clamp, completeSum, dayCount, days, forecastHorizons, forecastRules, includedInDemand, mean, methods,
  percentChange, previousYear, priorYearDays, rounded, shift, sum,
} from './model';

/** One bounded computation owns its caches. Inputs/configuration must remain
 * unchanged during that refresh or audit; nothing is retained globally. */
export type ForecastComputationContext = {
  values: WeakMap<DemandSeries, Map<string, Map<string, number>>>;
  predictions: WeakMap<DemandSeries, Map<string, number[] | null>>;
  backtests: WeakMap<DemandSeries, Map<string, BacktestScore[]>>;
};
export const createForecastComputationContext = (): ForecastComputationContext => ({ values: new WeakMap(), predictions: new WeakMap(), backtests: new WeakMap() });

/** Only source-covered dates are zeros. Unknown dates remain absent. Availability
 * is source posting time, independent of the later receipt/import timestamp. */
export function valuesKnownAt(series: DemandSeries, origin: string, context?: ForecastComputationContext) {
  const cached = context?.values.get(series)?.get(origin);
  if (cached) return cached;
  const values = new Map<string, number>();
  for (const coverage of series.coverage) for (const date of days(coverage.start, coverage.end < origin ? coverage.end : origin)) values.set(date, 0);
  const revisions = new Map<string, DemandSeries['observations'][number]>();
  const unversioned: DemandSeries['observations'] = [];
  for (const row of series.observations) if (row.date <= origin && row.availableOn <= origin) {
    if (!row.sourceLineId) { unversioned.push(row); continue; }
    const key = JSON.stringify([row.sourceLineId, row.date]), old = revisions.get(key);
    if (!old || (row.versionAt ?? row.availableOn) >= (old.versionAt ?? old.availableOn)) revisions.set(key, row);
  }
  for (const row of [...unversioned, ...revisions.values()]) if (includedInDemand(row.classification) && row.transactionStatus !== 'CANCELLED' && values.has(row.date)) values.set(row.date, (values.get(row.date) ?? 0) + row.cases);
  if (context) {
    const cache = context.values.get(series) ?? new Map();
    cache.set(origin, values); context.values.set(series, cache);
  }
  return values;
}
const window = (values: Map<string, number>, end: string, count: number) => days(shift(end, 1 - count), end).map(d => values.get(d) ?? null);
const total = (values: Map<string, number>, end: string, count: number) => completeSum(window(values, end, count));
function tail(values: Map<string, number>, origin: string, limit = 90) {
  const result: number[] = [];
  for (let i = 0; i < limit; i++) { const value = values.get(shift(origin, -i)); if (value === undefined) break; result.unshift(value); }
  return result;
}
export function signalsFor(values: Map<string, number>, origin: string, start: string, horizon = 30): Signals {
  const recent = tail(values, origin, forecastRules.maxHistoryDays);
  const priorDates = priorYearDays(start, horizon);
  const current90 = total(values, origin, 90);
  const prior90 = completeSum(priorYearDays(shift(origin, -89), 90).map(d => values.get(d) ?? null));
  const weekly = Array.from({ length: Math.floor(Math.min(90, recent.length) / 7) }, (_, i) => sum(recent.slice(recent.length - (i + 1) * 7, recent.length - i * 7)));
  const weeklyMean = mean(weekly);
  return {
    trailing30: total(values, origin, 30), trailing60: total(values, origin, 60), trailing90: current90,
    priorYear: completeSum(priorDates.map(d => values.get(d) ?? null)),
    yoy: percentChange(current90, prior90),
    recentTrend: percentChange(total(values, origin, 30), total(values, shift(origin, -30), 30)),
    longTrend: percentChange(current90, total(values, shift(origin, -90), 90)),
    volatility: weekly.length >= 4 && weeklyMean > 0 ? Math.sqrt(mean(weekly.map(n => (n - weeklyMean) ** 2))) / weeklyMean : null,
    historyDays: recent.length, nonzeroDays: recent.filter(n => n > 0).length,
  };
}

/** All fitted parameters are derived from the supplied training map only. */
export function predict(method: Method, values: Map<string, number>, origin: string, start: string, horizon = 30, config: ForecastConfig = forecastRules): number[] | null {
  const recent = tail(values, origin);
  if (recent.length < config.minimumDays) return null;
  const average = mean(recent), last30 = mean(recent.slice(-30));
  let daily: number;
  if (method === 'recent-mean') daily = average;
  else if (method === 'weighted-mean') daily = (last30 * 0.5 + mean(recent.slice(-60)) * 0.3 + average * 0.2);
  else if (method === 'exponential-smoothing') { daily = mean(recent.slice(0, Math.min(14, recent.length))); for (const value of recent) daily = 0.12 * value + 0.88 * daily; }
  else if (method === 'croston-sba') {
    if (recent.length < 30 || recent.filter(n => n > 0).length / recent.length > 0.35) return null;
    const alpha = 0.1; let size = 0, interval = 0, elapsed = 1;
    for (const value of recent) {
      if (value > 0) { size = size ? alpha * value + (1 - alpha) * size : value; interval = interval ? alpha * elapsed + (1 - alpha) * interval : elapsed; elapsed = 1; }
      else elapsed++;
    }
    daily = interval ? (1 - alpha / 2) * size / interval : 0;
  } else {
    const previous = priorYearDays(start, horizon).map(d => values.get(d));
    if (previous.some(v => v === undefined) || recent.length < 30) return null;
    // Smooth prior-year daily lumps within each 7-day horizon bucket. Seasonal
    // shape remains across the horizon; one shipment day does not drive a spike.
    const seasonal = previous as number[];
    if (method === 'seasonal-naive') return seasonal.map(n => Math.max(0, n));
    const s = signalsFor(values, origin, start);
    const ratio = clamp(1 + (s.yoy ?? 0), config.growthMinimum, config.growthMaximum);
    const longRatio = clamp(1 + (s.longTrend ?? 0), 0.8, 1.25);
    const growth = 1 + 0.5 * (ratio - 1) + 0.2 * (longRatio - 1);
    const result: number[] = [];
    for (let i = 0; i < horizon; i += 7) {
      const slice = seasonal.slice(i, i + 7);
      const rate = mean(slice) * growth * 0.7 + (last30 * 0.6 + average * 0.4) * 0.3;
      result.push(...slice.map(() => Math.max(0, rate)));
    }
    return result;
  }
  return Array.from({ length: horizon }, () => Math.max(0, daily));
}

export function scoreFolds(method: Method, folds: BacktestScore['folds'], horizon = 30): BacktestScore {
  const errorTotal = sum(folds.map(f => Math.abs(f.error))), actualTotal = sum(folds.map(f => Math.abs(f.actual)));
  const scaled = folds.filter(f => f.scale !== null && f.scale > 0).map(f => Math.abs(f.error) / horizon / f.scale!);
  return { method, folds, mae: folds.length ? errorTotal / folds.length : null, wape: actualTotal > 0 ? errorTotal / actualTotal : null,
    mase: scaled.length ? mean(scaled) : null, bias: actualTotal > 0 ? sum(folds.map(f => f.predicted - f.actual)) / actualTotal : null };
}
function trajectoryFor(series: DemandSeries, values: Map<string, number>, origin: string, start: string, method: Method, config: ForecastConfig, context: ForecastComputationContext) {
  const fullConfig = { ...config, horizonDays: 90 };
  const key = JSON.stringify([origin, start, method, fullConfig]);
  const cache = context.predictions.get(series) ?? new Map<string, number[] | null>();
  if (cache.has(key)) return cache.get(key)!;
  const prediction = predict(method, values, origin, start, 90, fullConfig);
  cache.set(key, prediction); context.predictions.set(series, cache);
  return prediction;
}
export function backtest(series: DemandSeries, origin: string, config: ForecastConfig = forecastRules, context = createForecastComputationContext()): BacktestScore[] {
  const key = JSON.stringify([origin, config]);
  const cached = context.backtests.get(series)?.get(key);
  if (cached) return cached;
  const actualValues = valuesKnownAt(series, origin, context);
  const folds = new Map<Method, BacktestScore['folds']>(methods.map(m => [m, []]));
  for (let i = config.backtestFolds; i >= 1; i--) {
    const cutoff = shift(origin, -i * Math.max(config.horizonDays, config.backtestStepDays));
    const training = valuesKnownAt(series, cutoff, context);
    const actual = total(actualValues, shift(cutoff, config.horizonDays), config.horizonDays);
    const recent = tail(training, cutoff);
    if (actual === null || recent.length < config.minimumBacktestDays) continue;
    const differences = recent.slice(1).map((v, j) => Math.abs(v - recent[j]));
    const scale = mean(differences) || null;
    for (const method of methods) {
      // Validate the same 90-day trajectory prefix used for a live forecast.
      const prediction = trajectoryFor(series, training, cutoff, shift(cutoff, 1), method, config, context);
      if (prediction) { const predicted = sum(prediction.slice(0, config.horizonDays)); folds.get(method)!.push({ origin: cutoff, predicted, actual, error: actual - predicted, scale }); }
    }
  }
  const result = methods.map(method => scoreFolds(method, folds.get(method)!, config.horizonDays));
  const cache = context.backtests.get(series) ?? new Map<string, BacktestScore[]>();
  cache.set(key, result); context.backtests.set(series, cache);
  return result;
}
export function selectModel(scores: BacktestScore[], eligible: Method[], horizon = 30) {
  // Compare every candidate on the same origins. A seasonal candidate with one
  // lucky fold cannot beat a baseline evaluated on eight harder folds.
  const usable = scores.filter(s => eligible.includes(s.method) && s.folds.length >= 3);
  const origins = usable.length ? usable.reduce((set, score) => new Set([...set].filter(o => score.folds.some(f => f.origin === o))), new Set(usable[0].folds.map(f => f.origin))) : new Set<string>();
  if (origins.size < 3) return eligible.includes('weighted-mean') ? 'weighted-mean' : eligible[0] ?? 'recent-mean';
  return usable.map(s => scoreFolds(s.method, s.folds.filter(f => origins.has(f.origin)), horizon)).sort((a, b) => a.mae! - b.mae! || methods.indexOf(a.method) - methods.indexOf(b.method))[0].method;
}
export type HorizonBacktests = Record<ForecastHorizon, BacktestScore[]>;
function coherentSelection(scores: HorizonBacktests, eligible: Method[]): { method: Method; compared: boolean } {
  // A horizon contributes one equally weighted daily MAE. Compare candidates
  // on identical origins within each horizon, with evidence at every horizon.
  const usable = eligible.filter(method => forecastHorizons.every(h => (scores[h].find(score => score.method === method)?.folds.length ?? 0) >= 3));
  const common = new Map(forecastHorizons.map(h => {
    const folds = usable.map(method => scores[h].find(score => score.method === method)!.folds);
    const origins = folds.length ? folds.reduce((set, candidate) => new Set([...set].filter(origin => candidate.some(fold => fold.origin === origin))), new Set(folds[0].map(fold => fold.origin))) : new Set<string>();
    return [h, origins] as const;
  }));
  if (!usable.length || forecastHorizons.some(h => common.get(h)!.size < 3)) return { method: eligible.includes('weighted-mean') ? 'weighted-mean' : eligible[0] ?? 'recent-mean', compared: false };
  const method = usable.map(method => ({ method, loss: mean(forecastHorizons.map(h => {
    const folds = scores[h].find(score => score.method === method)!.folds.filter(fold => common.get(h)!.has(fold.origin));
    return mean(folds.map(fold => Math.abs(fold.error))) / h;
  })) })).sort((a, b) => a.loss - b.loss || methods.indexOf(a.method) - methods.indexOf(b.method))[0].method;
  return { method, compared: true };
}
export function selectCoherentModel(scores: HorizonBacktests, eligible: Method[]): Method {
  return coherentSelection(scores, eligible).method;
}
export function bucketsFor(prediction: number[], start: string): ForecastBucket[] {
  // Longer horizons use the same compact space: two or three 30-day segments.
  const size = prediction.length > 30 ? 30 : 7;
  const buckets = Array.from({ length: Math.ceil(prediction.length / size) }, (_, i) => {
    const offset = i * size, count = Math.min(size, prediction.length - offset);
    return { label: size === 30 ? `Days ${offset + 1}–${offset + count}` : count === 7 ? `Week ${i + 1}` : `Remaining ${count} days`, start: shift(start, offset), end: shift(start, offset + count - 1), cases: rounded(sum(prediction.slice(offset, offset + count))) };
  });
  if (buckets.length) buckets[buckets.length - 1].cases = rounded(rounded(sum(prediction)) - sum(buckets.slice(0, -1).map(b => b.cases)));
  return buckets;
}
const percent = (value: number) => `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`;
function locationForHorizon(series: DemandSeries, asOf: string, config: ForecastConfig, values: Map<string, number>, through: string | null, scores: BacktestScore[], method: Method, trajectory: number[] | null, compared: boolean): LocationForecast {
  const start = shift(asOf, 1);
  const signals = signalsFor(values, through ?? asOf, start, config.horizonDays);
  const base: LocationForecast = { location: series.location, dataThrough: through, point: null, lower: null, upper: null, confidence: 'Low', method: null, rangeMethod: 'Unavailable', buckets: [], signals, backtests: [], reasons: [] };
  if (!through || dayCount(through, asOf) - 1 > config.maxStaleDays || signals.historyDays < config.minimumDays) {
    base.reasons.push(!through ? 'No complete outbound case history.' : signals.historyDays < config.minimumDays ? `Only ${signals.historyDays} consecutive covered days; at least ${config.minimumDays} are needed.` : `Source is stale: data through ${through}.`); return base;
  }
  const daily = trajectory!.slice(0, config.horizonDays);
  const point = sum(daily), score = scores.find(s => s.method === method)!;
  const errors = score.folds.map(f => Math.abs(f.error)).sort((a, b) => a - b);
  const stability = scores.find(s => s.method === 'weighted-mean')?.folds.slice(-3).map(f => f.predicted) ?? [];
  const stable = stability.length >= 3 && Math.max(...stability) <= Math.max(1, Math.min(...stability)) * 1.5;
  const confidence: Confidence = signals.historyDays >= 365 && score.folds.length >= 6 && score.wape !== null && score.wape <= 0.2 && (signals.volatility ?? 2) <= 0.7 && stable && through === asOf ? 'High' : signals.historyDays >= 90 && score.folds.length >= 3 && score.wape !== null && score.wape <= 0.5 && (signals.volatility ?? 3) <= 1.5 && through === asOf ? 'Medium' : 'Low';
  // Empirical 80th percentile absolute horizon-specific error. Sparse histories receive
  // a labelled planning range, not a fabricated calibrated probability interval.
  const empirical = errors.length >= 3;
  const radius = empirical ? errors[Math.min(errors.length - 1, Math.ceil(config.rangeQuantile * errors.length) - 1)] : Math.max(point * 0.5, Math.sqrt(sum(tail(values, through).map(n => n * n)) / Math.max(1, tail(values, through).length) * config.horizonDays));
  const reasons = [`${signals.historyDays} consecutive covered days; ${score.folds.length} rolling ${config.horizonDays}-day backtests.`, compared ? `Selected ${method.replaceAll('-', ' ')} using equally weighted daily error across 30-, 60- and 90-day historical checks.` : `Using ${method.replaceAll('-', ' ')} as a limited-history baseline until every horizon has at least three common historical checks.`];
  if (signals.priorYear !== null) reasons.push(`Comparable period last year: ${rounded(signals.priorYear)} cases.`);
  if (signals.yoy !== null) reasons.push(`Trailing 90-day demand is ${percent(signals.yoy)} year over year; growth is damped and capped in the seasonal model.`);
  if (signals.recentTrend !== null) reasons.push(`Recent 30-day demand is ${percent(signals.recentTrend)} versus the preceding 30 days.`);
  if (signals.longTrend !== null) reasons.push(`Longer-term 90-day demand is ${percent(signals.longTrend)} versus the preceding 90 days.`);
  if (signals.volatility !== null) reasons.push(`Weekly demand volatility is ${signals.volatility > 1 ? 'high' : signals.volatility > 0.5 ? 'moderate' : 'low'}.`);
  if (!empirical) reasons.push('Limited backtest history: range is an uncalibrated planning band.');
  if (through < asOf) reasons.push(`Recent source gap: data through ${through}; confidence reduced.`);
  if (confidence === 'Low') {
    if (signals.historyDays < 90) reasons.push('Low confidence: fewer than 90 consecutive covered days.');
    if (score.folds.length < 3) reasons.push(`Low confidence: fewer than three completed ${config.horizonDays}-day backtests.`);
    if (score.wape === null) reasons.push(score.folds.length ? 'Low confidence: historical actual demand is zero, so percentage forecast error is unavailable.' : 'Low confidence: percentage forecast error cannot be evaluated without completed historical checks.');
    else if (score.wape > 0.5) reasons.push(`Low confidence: historical error is ${Math.round(score.wape * 100)}% of actual demand; Medium requires 50% or less.`);
    if (signals.volatility === null) reasons.push('Low confidence: weekly demand variation cannot be assessed.');
    else if (signals.volatility > 1.5) reasons.push('Low confidence: weekly demand is too variable for the Medium confidence threshold.');
  }
  return { ...base, point: rounded(point), lower: rounded(Math.max(0, point - radius)), upper: rounded(point + radius), confidence, method, rangeMethod: empirical ? `Empirical 80th percentile absolute ${config.horizonDays}-day backtest error; not a guaranteed probability interval` : 'Uncalibrated sparse-history planning band', buckets: bucketsFor(daily, start), backtests: scores, reasons };
}

export function forecastLocationHorizons(series: DemandSeries, asOf: string, config: ForecastConfig = forecastRules, context = createForecastComputationContext()): Record<ForecastHorizon, LocationForecast> {
  const values = valuesKnownAt(series, asOf, context), through = [...values.keys()].sort().at(-1) ?? null;
  const usable = through && dayCount(through, asOf) - 1 <= config.maxStaleDays && tail(values, through, config.minimumDays).length >= config.minimumDays;
  const scores = Object.fromEntries(forecastHorizons.map(horizon => [horizon, usable ? backtest(series, through!, { ...config, horizonDays: horizon }, context) : []])) as HorizonBacktests;
  const eligible = usable ? methods.filter(method => trajectoryFor(series, values, through!, shift(asOf, 1), method, config, context) !== null) : [];
  const { method, compared } = coherentSelection(scores, eligible);
  const trajectory = usable ? trajectoryFor(series, values, through!, shift(asOf, 1), method, config, context) : null;
  return Object.fromEntries(forecastHorizons.map(horizon => [horizon, locationForHorizon(series, asOf, { ...config, horizonDays: horizon }, values, through, scores[horizon], method, trajectory, compared)])) as Record<ForecastHorizon, LocationForecast>;
}
export function forecastLocation(series: DemandSeries, asOf: string, config: ForecastConfig = forecastRules): LocationForecast {
  return forecastLocationHorizons(series, asOf, config)[config.horizonDays as ForecastHorizon];
}

function productForHorizon(product: ForecastProduct, selected: DemandSeries[], guidance: GuidanceObservation[], asOf: string, previous: ProductForecast | null, config: ForecastConfig, locations: LocationForecast[], context: ForecastComputationContext): ProductForecast {
  const point = completeSum(locations.map(l => l.point));
  const rank = { Low: 0, Medium: 1, High: 2 };
  const confidence: Confidence = locations.length ? locations.reduce((a, b) => rank[a] < rank[b.confidence] ? a : b.confidence, 'High' as Confidence) : 'Low';
  const safetyFactor = config.safety[confidence];
  const currentGuidance = product.demandExcluded ? [] : guidance.filter(g => g.market === product.market && g.itemCode === product.code && g.date <= shift(asOf, 1) && includedInDemand(g.classification));
  const alerts: string[] = [], reasons: string[] = [];
  const comparablePrevious = previous && (previous.horizonDays ?? 30) === config.horizonDays ? previous : null;
  const change = percentChange(point, comparablePrevious?.point ?? null);
  if (change !== null && Math.abs(change) >= config.materialChangePercent && Math.abs(point! - comparablePrevious!.point!) >= config.materialChangeCases) alerts.push('Forecast changed');
  if (locations.some(l => l.signals.recentTrend !== null && l.signals.recentTrend >= config.unusualRatio - 1 && (l.signals.trailing30 ?? 0) >= config.materialChangeCases)) alerts.push('Unusual demand');
  if (currentGuidance.some(g => {
    const old = previous?.guidance.find(p => p.location.code === g.location.code);
    return old && g.date > old.date && ([['minimum', g.minimum, old.minimum], ['maximum', g.maximum, old.maximum]] as const).some(([, n, p]) => n !== null && p !== null && Math.abs(n - p) >= config.guidanceChangeCases && Math.abs(percentChange(n, p) ?? 0) >= config.guidanceChangePercent);
  })) alerts.push('Guidance divergence');
  if (!selected.length) reasons.push(product.demandExcluded ? 'Distillery Only / A-3a Dist item: excluded from production demand forecasting.' : 'Outbound case history is unavailable for this product. Import a verified complete Bailment PO / Invoice slice.');
  else if (point === null) reasons.push('A location has missing, sparse or stale history. The product total is unavailable until every known location can be forecast.');
  reasons.push('Forecast is expected outbound demand. Planning target adds the configured uncertainty margin; finished inventory has not been subtracted.', 'Distribution Center min/max values are contextual guidance and do not replace historical demand.');
  const combined = selected.map(s => valuesKnownAt(s, asOf, context));
  const start = shift(asOf, 1), end = shift(start, config.horizonDays - 1);
  const history = Array.from({ length: 13 }, (_, i) => {
    const bucketEnd = shift(asOf, -(12 - i) * 30), bucketStart = shift(bucketEnd, -29);
    return { start: bucketStart, end: bucketEnd, actual: completeSum(combined.map(v => total(v, bucketEnd, 30))), priorYear: completeSum(combined.map(v => completeSum(priorYearDays(bucketStart, 30).map(d => v.get(d) ?? null)))) };
  });
  const priorYear = completeSum(locations.map(l => l.signals.priorYear));
  const trailing90 = completeSum(locations.map(l => l.signals.trailing90));
  const prior90 = completeSum(combined.map(v => completeSum(priorYearDays(shift(asOf, -89), 90).map(d => v.get(d) ?? null))));
  const recent30 = completeSum(locations.map(l => l.signals.trailing30));
  const previous30 = completeSum(combined.map(v => total(v, shift(asOf, -30), 30)));
  if (point !== null) reasons.unshift(`Expected demand sums ${locations.length} independently backtested location forecasts.`, ...(priorYear !== null ? [`Comparable ${config.horizonDays}-day period last year: ${rounded(priorYear)} cases.`] : []), ...(percentChange(trailing90, prior90) !== null ? [`Trailing 90-day demand is ${percent(percentChange(trailing90, prior90)!)} year over year.`] : []), ...(percentChange(recent30, previous30) !== null ? [`Recent 30-day demand is ${percent(percentChange(recent30, previous30)!)} versus the preceding period.`] : []));
  return { product, horizonDays: config.horizonDays as ForecastHorizon, start, end, locations, point, lower: completeSum(locations.map(l => l.lower)), upper: completeSum(locations.map(l => l.upper)), target: point === null ? null : Math.ceil(point * (1 + safetyFactor)), safetyFactor, confidence,
    priorYear, yoy: percentChange(trailing90, prior90), recentTrend: percentChange(recent30, previous30), change, alerts, reasons, guidance: currentGuidance,
    dataThrough: locations.length && locations.every(l => l.dataThrough) ? locations.map(l => l.dataThrough!).sort()[0] : null,
    buckets: point === null ? [] : locations[0].buckets.map((b, i) => ({ ...b, cases: rounded(sum(locations.map(l => l.buckets[i].cases))) })), history };
}

/** One nonnegative daily trajectory per location makes every cumulative horizon
 * coherent. Selection is shared; confidence, errors and ranges stay specific. */
export function forecastProductHorizons(product: ForecastProduct, series: DemandSeries[], guidance: GuidanceObservation[], asOf: string, previous: StoredProductForecast | null = null, config: ForecastConfig = forecastRules, context = createForecastComputationContext()): StoredProductForecast {
  const selected = product.demandExcluded ? [] : series.filter(s => s.market === product.market && s.itemCode === product.code && includedInDemand(s.classification ?? 'BAILMENT'));
  // Guidance establishes a location's existence, never its demand quantity.
  if (!product.demandExcluded) for (const g of guidance.filter(g => g.market === product.market && g.itemCode === product.code && g.date <= shift(asOf, 1) && includedInDemand(g.classification))) {
    if (!selected.some(s => s.location.code === g.location.code)) selected.push({ market: product.market, itemCode: product.code, location: g.location, classification: g.classification, observations: [], coverage: [] });
  }
  const locations = selected.map(source => forecastLocationHorizons(source, asOf, config, context));
  const horizons = Object.fromEntries(forecastHorizons.map(horizon => {
    const prior = previous && (previous.horizonDays ?? 30) === horizon ? previous : previous?.horizons?.[horizon] ?? null;
    return [horizon, productForHorizon(product, selected, guidance, asOf, prior, { ...config, horizonDays: horizon }, locations.map(location => location[horizon]), context)];
  })) as Record<ForecastHorizon, ProductForecast>;
  return { ...horizons[30], horizons: { 60: horizons[60], 90: horizons[90] } };
}
export function forecastProduct(product: ForecastProduct, series: DemandSeries[], guidance: GuidanceObservation[], asOf: string, previous: ProductForecast | null = null, config: ForecastConfig = forecastRules): ProductForecast {
  const { horizons, ...thirty } = forecastProductHorizons(product, series, guidance, asOf, previous, config);
  return config.horizonDays === 30 ? thirty : horizons![config.horizonDays as ForecastHorizon]!;
}
