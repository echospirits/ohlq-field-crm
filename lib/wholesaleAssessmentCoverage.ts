import { getOhlqLicenseeMatchKeys } from './ohlqWholesaleMatching';
import type { SalesCoverage } from './wholesaleAssessment';

export const isoDay = (date: Date) => date.toISOString().slice(0, 10);
export const assessmentDay = (date: Date) => new Date(`${isoDay(date)}T00:00:00Z`);
export function windowDates(asOf: Date, days = 90) {
  return Array.from({ length: days }, (_, i) => isoDay(new Date(asOf.getTime() - i * 86_400_000)));
}
export type AccountIdentity = { id: string; licenseeId: string | null; licenseeIds: { licenseeId: string }[] };
export function identityCoverage(accounts: AccountIdentity[]) {
  const owners = new Map<string, Set<string>>();
  const keys = new Map(accounts.map(a => [a.id, [...new Set([a.licenseeId, ...a.licenseeIds.map(x => x.licenseeId)].flatMap(getOhlqLicenseeMatchKeys))]]));
  for (const [id, aliases] of keys) for (const key of aliases) owners.set(key, new Set([...(owners.get(key) ?? []), id]));
  return new Map(accounts.map(a => {
    const aliases = keys.get(a.id)!;
    return [a.id, !aliases.length ? 'UNMATCHED' : aliases.some(key => owners.get(key)!.size > 1) ? 'AMBIGUOUS' : 'MATCHED'] as const;
  }));
}
export function sourceCoverage({ asOf, completeDates, identity, hasPurchases, through }: {
  asOf: Date; completeDates: Set<string>; identity: SalesCoverage['identity']; hasPurchases: boolean; through: string | null;
}): SalesCoverage {
  const missingDates = windowDates(asOf).filter(date => !completeDates.has(date));
  const completeDays = 90 - missingDates.length;
  const mode = identity !== 'MATCHED' && !hasPurchases || (!completeDays && !hasPurchases) ? 'RESEARCH_ONLY'
    : identity === 'MATCHED' && !missingDates.length ? 'SALES_BACKED' : 'PARTIAL_SALES';
  return { mode, through: mode === 'RESEARCH_ONLY' ? null : through, expectedDays: 90, completeDays: mode === 'RESEARCH_ONLY' ? 0 : completeDays, identity,
    missingDates, verifiedZero: mode === 'SALES_BACKED' && !hasPurchases,
    limitations: [...(mode === 'RESEARCH_ONLY' ? ['Sales data is unavailable; this assessment uses stored research only.'] : missingDates.length ? [`${missingDates.length} of 90 report days lack verified ledger coverage; missing days are not zero purchases.`] : []),
      ...(identity === 'AMBIGUOUS' || identity === 'UNMATCHED' ? ['Sales identity is ambiguous or unmatched; no verified zero or full-market volume claim.'] : [])] };
}

// The import completion revision changes on same-date corrections, including zero rows.
export function reportRevision(report: { updatedAt: Date; rowCount: number }) {
  return `${report.updatedAt.toISOString()}:${report.rowCount}`;
}
