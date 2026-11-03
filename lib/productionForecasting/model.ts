// Market adapters normalize source facts before the statistical engine sees them.
export const MODEL_VERSION = 'production-demand-v1.4';
export const forecastHorizons = [30, 60, 90] as const;
export type ForecastHorizon = typeof forecastHorizons[number];
export function parseForecastHorizon(value: unknown): ForecastHorizon {
  return value === 60 || value === '60' ? 60 : value === 90 || value === '90' ? 90 : 30;
}
export const classifications = ['BAILMENT', 'A3A_BAIL', 'A3A_DIST', 'OTHER_OUTBOUND'] as const;
export type Classification = typeof classifications[number];
export const includedInDemand = (classification: Classification) => classification !== 'A3A_DIST';
export type ForecastProduct = { id: string; market: string; code: string; name: string; demandExcluded?: boolean };
export type FulfillmentLocation = { code: string; name: string };
export type DemandObservation = { date: string; availableOn: string; cases: number; classification: Classification; sourceLineId?: string; versionAt?: string; transactionStatus?: string };
export type Coverage = { start: string; end: string };
export type DemandSeries = {
  market: string; itemCode: string; location: FulfillmentLocation;
  classification?: Classification;
  observations: DemandObservation[]; coverage: Coverage[];
};
export type GuidanceObservation = {
  market: string; itemCode: string; location: FulfillmentLocation; date: string;
  minimum: number | null; maximum: number | null; classification: Classification;
};
export type Confidence = 'High' | 'Medium' | 'Low';
export const methods = ['recent-mean', 'weighted-mean', 'exponential-smoothing', 'seasonal-naive', 'seasonal-growth', 'croston-sba'] as const;
export type Method = typeof methods[number];
export type BacktestFold = { origin: string; predicted: number; actual: number; error: number; scale: number | null };
export type BacktestScore = { method: Method; folds: BacktestFold[]; mae: number | null; wape: number | null; mase: number | null; bias: number | null };
export type ForecastBucket = { label: string; start: string; end: string; cases: number };
export type Signals = { trailing30: number | null; trailing60: number | null; trailing90: number | null; priorYear: number | null; yoy: number | null; recentTrend: number | null; longTrend: number | null; volatility: number | null; historyDays: number; nonzeroDays: number };
export type LocationForecast = {
  location: FulfillmentLocation; dataThrough: string | null; point: number | null; lower: number | null; upper: number | null;
  confidence: Confidence; method: Method | null; rangeMethod: string; buckets: ForecastBucket[];
  signals: Signals; backtests: BacktestScore[]; reasons: string[];
};
export type ProductForecast = {
  horizonDays?: ForecastHorizon;
  product: ForecastProduct; start: string; end: string; dataThrough: string | null;
  point: number | null; lower: number | null; upper: number | null; target: number | null;
  confidence: Confidence; safetyFactor: number; locations: LocationForecast[];
  priorYear: number | null; yoy: number | null; recentTrend: number | null;
  change: number | null; alerts: string[]; reasons: string[];
  guidance: GuidanceObservation[]; buckets: ForecastBucket[];
  history: { start: string; end: string; actual: number | null; priorYear: number | null }[];
};
/** The 30-day root preserves existing snapshots and scalar database columns. */
export type StoredProductForecast = ProductForecast & { horizons?: Partial<Record<ForecastHorizon, ProductForecast>> };
export const forecastRules = {
  horizonDays: 30, maxHistoryDays: 1096, minimumDays: 14, maxStaleDays: 7,
  backtestFolds: 8, backtestStepDays: 30, minimumBacktestDays: 60,
  growthMinimum: 0.65, growthMaximum: 1.5, rangeQuantile: 0.8,
  materialChangePercent: 0.25, materialChangeCases: 5, unusualRatio: 2,
  guidanceChangePercent: 0.5, guidanceChangeCases: 5,
  safety: { High: 0.05, Medium: 0.1, Low: 0.15 },
};
export type ForecastConfig = typeof forecastRules;
export function forecastConfiguration(settings: unknown): ForecastConfig {
  const raw = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>).productionForecasting : null;
  const safety = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).safety : null;
  const configured = { ...forecastRules.safety };
  if (safety && typeof safety === 'object' && !Array.isArray(safety)) for (const key of ['High', 'Medium', 'Low'] as const) {
    const value = (safety as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 0.3) configured[key] = value;
  }
  return { ...forecastRules, safety: configured };
}
export const dateOnly = (value: Date) => value.toISOString().slice(0, 10);
export function validDay(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && dateOnly(new Date(value)) === value; }
export const shift = (date: string, days: number) => dateOnly(new Date(Date.parse(date) + days * 86400000));
export const dayCount = (start: string, end: string) => Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
export const days = (start: string, end: string) => Array.from({ length: Math.max(0, dayCount(start, end)) }, (_, i) => shift(start, i));
export const previousYear = (date: string) => { const d = new Date(date); const month = d.getUTCMonth(); d.setUTCFullYear(d.getUTCFullYear() - 1); if (d.getUTCMonth() !== month) d.setUTCDate(0); return dateOnly(d); };
export const priorYearDays = (start: string, count: number) => days(previousYear(start), shift(previousYear(start), count - 1));
export const sum = (values: number[]) => values.reduce((n, x) => n + x, 0);
export const mean = (values: number[]) => values.length ? sum(values) / values.length : 0;
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const rounded = (value: number) => Math.round(value * 100) / 100;
export function percentChange(value: number | null, previous: number | null) { return value === null || previous === null || previous <= 0 ? null : value / previous - 1; }
export function completeSum(values: (number | null)[]): number | null { return !values.length || values.some(v => v === null) ? null : sum(values as number[]); }
