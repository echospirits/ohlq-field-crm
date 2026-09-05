import { createHash } from 'crypto';
import type { AccountOpportunitySignals, OpportunityHypothesis } from './opportunityIntelligence';
import { getPriceEvidence } from './opportunityAffinity';

export type OutcomeExample = { accountId: string; detectedAt: string; converted: boolean; key: string };
export type OutcomeModel = { version: string; trainingCount: number; holdoutCount: number; conversions: number; active: boolean; baseline: number; rates: Record<string, number>; brier: number | null; baselineBrier: number | null; reason: string };
export function outcomeSegment(signals: AccountOpportunitySignals, hypothesis: OpportunityHypothesis) {
  if (!hypothesis.targetProduct) return null;
  const evidence = getPriceEvidence(signals.purchases, hypothesis.targetProduct);
  if (evidence.coverage < .7 || !evidence.targetPrice750) return null;
  return `${hypothesis.type}:${hypothesis.targetCategory}:${evidence.comparableShare >= .5 ? 'aligned' : evidence.comparableShare >= .15 ? 'mixed' : 'low'}:${evidence.localScore > 2 ? 'local-comparable' : 'other'}:${signals.visits90 > 0 ? 'prior-contact' : 'no-prior-contact'}`;
}

export function labelMatureOutcome(detectedAt: Date, asOf: Date, reportDates: Set<string>, purchaseDates: Date[]): boolean | null {
  const end = new Date(detectedAt.getTime() + 90 * 86400000);
  if (asOf < end) return null;
  // Missing source days are censored, never labeled as a failed sale.
  for (let day = 1; day <= 90; day++) {
    if (!reportDates.has(new Date(detectedAt.getTime() + day * 86400000).toISOString().slice(0,10))) return null;
  }
  return purchaseDates.some(date => date > detectedAt && date <= end);
}

export function trainOutcomeModel(examples: OutcomeExample[]): OutcomeModel {
  // One earliest eligible example per account; chronological holdout, no account overlap.
  const seen = new Set<string>();
  const rows = [...examples].sort((a,b) => a.detectedAt.localeCompare(b.detectedAt)).filter(e => !seen.has(e.accountId) && Boolean(seen.add(e.accountId)));
  const split = Math.floor(rows.length * .8); const training = rows.slice(0, split); const holdout = rows.slice(split);
  const conversions = training.filter(e => e.converted).length;
  const baseline = (conversions + 1) / (training.length + 2);
  const groups = new Map<string, OutcomeExample[]>();
  training.forEach(e => groups.set(e.key, [...(groups.get(e.key) ?? []), e]));
  const rates = Object.fromEntries([...groups].filter(([, group]) => group.length >= 10).map(([key,group]) => [key, (group.filter(e => e.converted).length + 20 * baseline) / (group.length + 20)]));
  const brier = holdout.length ? holdout.reduce((sum,e) => sum + ((rates[e.key] ?? baseline) - Number(e.converted)) ** 2, 0) / holdout.length : null;
  const baselineBrier = holdout.length ? holdout.reduce((sum,e) => sum + (baseline - Number(e.converted)) ** 2, 0) / holdout.length : null;
  const enough = training.length >= 80 && holdout.length >= 20 && conversions >= 10 && training.length - conversions >= 10 && holdout.filter(e => e.converted).length >= 5 && holdout.filter(e => !e.converted).length >= 5;
  const active = Boolean(enough && brier !== null && baselineBrier !== null && brier < baselineBrier * .95);
  return { version: createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0,16), trainingCount: training.length, holdoutCount: holdout.length, conversions, baseline, rates, brier, baselineBrier, active,
    reason: active ? 'Chronological holdout improves Brier error by more than 5%' : enough ? 'Shadow only: no demonstrated holdout improvement' : 'Collecting mature outcomes; insufficient independent positive and negative examples' };
}
export function learnedAdjustment(model: OutcomeModel, key: string | null) {
  return model.active && key && model.rates[key] !== undefined ? Math.max(-10, Math.min(10, (model.rates[key] - model.baseline) * 20)) : 0;
}
