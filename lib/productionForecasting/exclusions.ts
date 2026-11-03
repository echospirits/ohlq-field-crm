import { z } from 'zod';
import { demandIdentity } from './reconciliation';
import { includedInDemand, validDay, type Classification, type DemandSeries } from './model';

const boundedCode = z.string().trim().min(1).max(200).refine(value => !/[\x00-\x1f]/.test(value));
const exclusionSchema = z.object({
  market: z.string().trim().regex(/^[A-Z0-9_-]{1,16}$/),
  itemCode: boundedCode,
  date: z.string().refine(validDay, 'A valid ISO movement date is required.'),
  sourceLineId: z.string().regex(/^v1:[a-f0-9]{64}$/),
  locationCode: boundedCode,
  reason: z.string().trim().min(1).max(500).refine(value => !/[\x00-\x1f]/.test(value)),
  approvedAt: z.string().datetime({ offset: true }).refine(value => validDay(value.slice(0, 10)), 'A valid approval timestamp is required.').transform(value => new Date(value).toISOString()),
}).strict();
export type DemandExclusion = z.infer<typeof exclusionSchema>;
const identityFields = (row: Pick<DemandExclusion, 'market' | 'itemCode' | 'date' | 'sourceLineId' | 'locationCode'>) => JSON.stringify([row.market, row.itemCode, row.date, demandIdentity(row.sourceLineId, row.date), row.locationCode]);

/** Current owner-approved exceptions are tenant settings, never global invoice
 * or agency constants. Invalid explicit configuration fails closed. */
export function parseDemandExclusions(settings: unknown): DemandExclusion[] {
  const configuration = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>).productionForecasting : null;
  const raw = configuration && typeof configuration === 'object' && !Array.isArray(configuration) ? (configuration as Record<string, unknown>).demandExclusions : undefined;
  if (raw === undefined) return [];
  const parsed = z.array(exclusionSchema).max(100).safeParse(raw);
  if (!parsed.success) throw new Error('Production forecast demand exclusion configuration is invalid.');
  const identities = new Set<string>();
  for (const rule of parsed.data) {
    const key = identityFields(rule);
    if (identities.has(key)) throw new Error('Production forecast demand exclusions contain a duplicate source identity.');
    identities.add(key);
  }
  return parsed.data.sort((a, b) => identityFields(a).localeCompare(identityFields(b)));
}

export function matchesDemandExclusion(row: Pick<DemandExclusion, 'market' | 'itemCode' | 'date' | 'sourceLineId' | 'locationCode'>, rule: DemandExclusion) {
  return identityFields(row) === identityFields(rule);
}

export type DemandExclusionHistoryRow = {
  id: string; market: string; itemCode: string; locationCode: string; sourceLineId: string;
  date: string; availableOn: string; cases: number; classification: Classification;
  transactionStatus: string; importedAt: string; sourceEvidence?: unknown;
};
export type DemandExclusionSummary = {
  configuredRules: number; matchedRules: number; unmatchedRules: number;
  excludedObservationVersions: number; prunedSeries: number;
  prunedLocations: Array<{ market: string; locationCode: string }>;
};
const locationIdentity = (row: { market: string; locationCode: string }) => JSON.stringify([row.market, row.locationCode]);
const seriesIdentity = (row: { market: string; itemCode: string; locationCode: string }) => JSON.stringify([row.market, row.itemCode, row.locationCode]);
function generatedCoverage(row: DemandExclusionHistoryRow) {
  if (row.cases !== 0 || demandIdentity(row.sourceLineId, row.date) !== demandIdentity(`coverage:${row.itemCode}:${row.locationCode}`, row.date)) return false;
  const evidence = row.sourceEvidence;
  return Boolean(evidence && typeof evidence === 'object' && !Array.isArray(evidence) && 'original' in evidence && (evidence as { original: unknown }).original === null);
}

/** Exclude only exact approved identities. A location disappears from planning
 * only when the excluded identity is its sole real demand and the remaining
 * series are provably generated coverage. Retain those covered zeroes for
 * eventual actual evaluation of immutable older forecast documents. */
export function applyPlanningExclusions(series: DemandSeries[], rules: DemandExclusion[], history: DemandExclusionHistoryRow[], asOf: string) {
  const summary: DemandExclusionSummary = { configuredRules: rules.length, matchedRules: 0, unmatchedRules: rules.length, excludedObservationVersions: 0, prunedSeries: 0, prunedLocations: [] };
  if (!rules.length) return { series, actualSeries: series, summary };
  const excluded = (row: Pick<DemandExclusion, 'market' | 'itemCode' | 'date' | 'sourceLineId' | 'locationCode'>) => rules.some(rule => matchesDemandExclusion(row, rule));
  const known = history.filter(row => row.date <= asOf && row.availableOn <= asOf);
  const matched = rules.filter(rule => known.some(row => matchesDemandExclusion(row, rule)));
  summary.matchedRules = matched.length; summary.unmatchedRules = rules.length - matched.length;
  // Physical warehouse coverage stays authoritative even when a particular
  // invoice is excluded. Only importer-created direct groupings can be an
  // artifact of that one invoice and its cross-product coverage declarations.
  const affected = new Set(matched.filter(rule => rule.locationCode.startsWith('DIRECT:')).map(locationIdentity));
  const latest = new Map<string, DemandExclusionHistoryRow>();
  for (const row of known) {
    const key = identityFields(row), old = latest.get(key);
    if (!old || row.importedAt > old.importedAt || row.importedAt === old.importedAt && row.id > old.id) latest.set(key, row);
  }
  const supporting = new Set([...latest.values()].filter(row => affected.has(locationIdentity(row)) && !excluded(row) && row.cases > 0 && ['POSTED', 'SHIPPED'].includes(row.transactionStatus) && includedInDemand(row.classification)).map(locationIdentity));
  const historicalSeries = new Map<string, DemandExclusionHistoryRow[]>();
  for (const row of known) {
    const key = seriesIdentity(row), old = historicalSeries.get(key) ?? [];
    old.push(row); historicalSeries.set(key, old);
  }
  const actualSeries = series.map(source => {
    const observations = source.observations.filter(observation => {
      // Native observations always have an identity. Identity-less historical
      // evidence cannot be assumed to match an approved exception.
      if (!observation.sourceLineId || !excluded({ market: source.market, itemCode: source.itemCode, locationCode: source.location.code, sourceLineId: observation.sourceLineId, date: observation.date })) return true;
      summary.excludedObservationVersions++; return false;
    });
    return observations.length === source.observations.length ? source : { ...source, observations };
  });
  const removed = new Set<string>();
  const planningSeries = actualSeries.filter(source => {
    const scope = { market: source.market, itemCode: source.itemCode, locationCode: source.location.code };
    const location = locationIdentity(scope);
    if (!affected.has(location) || supporting.has(location)) return true;
    const rows = historicalSeries.get(seriesIdentity(scope)) ?? [];
    // Missing provenance, explicit manual zeroes and genuine native zero
    // invoices are preserved rather than guessed to be generated coverage.
    if (!rows.length || !rows.every(row => excluded(row) || generatedCoverage(row))) return true;
    summary.prunedSeries++; removed.add(location); return false;
  });
  summary.prunedLocations = [...removed].sort().map(key => { const [market, locationCode] = JSON.parse(key) as [string, string]; return { market, locationCode }; });
  return { series: planningSeries, actualSeries, summary };
}
