export function summarizePurchaseOutcome({ detectedAt, asOf, purchaseDates, completeDates, baseline750, observed750, placementStatuses }: {
  detectedAt: Date; asOf: Date; purchaseDates: Date[]; completeDates: Set<string>;
  baseline750: number | null; observed750: number | null; placementStatuses: string[];
}) {
  const horizonEnd = new Date(detectedAt.getTime() + 90 * 86_400_000);
  const dates = [...new Set(purchaseDates.filter(d => d > detectedAt && d <= asOf && d <= horizonEnd).map(d => d.toISOString().slice(0,10)))].sort();
  const elapsed = Math.min(90, Math.floor((asOf.getTime() - detectedAt.getTime()) / 86_400_000));
  const complete = Array.from({ length: Math.max(0, elapsed) }, (_, i) => new Date(detectedAt.getTime() + (i + 1) * 86_400_000).toISOString().slice(0,10)).every(d => completeDates.has(d));
  const windows = new Set(dates.map(d => Math.min(2, Math.floor(Math.max(0, Date.parse(d) - detectedAt.getTime() - 1) / (30 * 86_400_000)))));
  return { version: 'WHOLESALE_OUTCOME_V1', learningMode: 'SHADOW', provenance: 'OHLQ_PURCHASE_REPORTS', initialPurchaseAt: dates[0] ?? null,
    purchaseDates: dates, distinctPurchaseDates: dates.length, repeatPurchaseDates: Math.max(0, dates.length - 1),
    sustained90Days: elapsed >= 90 && complete ? windows.size >= 3 : null,
    observationComplete: complete && elapsed >= 90, nonConversionLabel: null,
    observedChange750: complete && elapsed >= 90 && baseline750 !== null && observed750 !== null ? observed750 - baseline750 : null,
    placementAgreed: placementStatuses.includes('PROMISED'), placementLive: placementStatuses.includes('ACTIVE'),
    contribution: null, note: 'Observed association only; purchases following a visit or placement are not causal uplift.' };
}
