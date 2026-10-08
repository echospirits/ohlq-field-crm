import type { ReactNode } from 'react';
import { formatEasternDateTime } from '../../lib/dateTime';
import { evidenceModeLabel, effortLabel, pathLabel, readAssessment } from '../../lib/wholesaleAssessment';

export function WholesaleAssessmentSummary({ value, actions, pending = false }: { value: unknown; actions?: ReactNode; pending?: boolean }) {
  const assessment = readAssessment(value);
  if (!assessment) return <p className="muted" role="status">Current assessment unavailable. The next intelligence refresh will assess this account.</p>;
  const best = assessment.candidates[0];
  const stale = Date.now() - Date.parse(assessment.calculatedAt) > 48 * 3_600_000;
  return <div className="wholesale-assessment">
    <div className="assessment-heading"><strong>{assessment.priority.toFixed(0)} / 100 priority</strong><span className="pill">{evidenceModeLabel[assessment.evidenceMode]}</span><span>{assessment.band}</span></div>
    {stale || pending ? <p role="status" className="muted">{pending ? 'Evidence changed; recalculation is pending.' : 'Assessment is stale; a refresh is due.'}</p> : null}
    <strong>{assessment.title}</strong>
    <p>{best ? pathLabel[best.path] : assessment.state.replaceAll('_', ' ')} · {effortLabel[assessment.effort]}</p>
    <p>{best?.upside ?? assessment.action}{best ? ` · ${best.confidence.toLowerCase()} confidence in supporting evidence` : ''}</p>
    <ul>{assessment.reasons.slice(0, 2).map(reason => <li key={reason}>{reason}</li>)}</ul>
    {actions}
    <details className="compact-details"><summary>Why this recommendation?</summary>
      <p>Priority is a heuristic for sales attention. Compare within the evidence mode; equal scores do not mean equal measured commercial value.</p>
      <p>Last scored {formatEasternDateTime(new Date(assessment.calculatedAt))} · Last researched {assessment.researchAt ? formatEasternDateTime(new Date(assessment.researchAt)) : 'Unavailable'}</p>
      <p>Purchases through {assessment.coverage.through ?? 'Unavailable'} · {assessment.coverage.completeDays}/{assessment.coverage.expectedDays} verified report days. Window ends {assessment.asOf}.</p>
      <p>Observed physical bottles, 30 / 60 / 90 days: {[assessment.observed.bottles30, assessment.observed.bottles60, assessment.observed.bottles90].map(n => n === null ? 'Unavailable' : n.toLocaleString()).join(' / ')}.</p>
      <p>Observed 750 ml equivalents / 90 days: {assessment.observed.equivalents75090 ?? 'Unavailable'} · Tenant share: {assessment.observed.tenantShare === null ? 'Unavailable' : `${assessment.observed.tenantShare}%`}. Purchases are not observed consumption.</p>
      {best ? <><p>Observed compatible stream: {best.observedCompatible750 ?? 'Unquantified'} 750 ml equivalents / 90 days. Estimated attainable additional volume: unavailable. Contribution: unavailable.</p>
        <p>Calculation: potential {best.components.potential} × feasibility {best.components.feasibility} × strategy {best.components.strategy}; policy and coverage caps may apply. Model {assessment.version}.</p>
        <ul>{best.assumptions.map(s => <li key={s}>{s}</li>)}</ul>
        {best.evidence.map((e,i) => <p key={i}>{e.claim} · {e.kind} · {e.observedAt.slice(0,10)} · Poured product: {e.pouredProduct ?? 'Unconfirmed'} · {/^https?:\/\//.test(e.source) ? <a href={e.source} target="_blank" rel="noreferrer">Source</a> : e.source}</p>)}
        <p><strong>What would change this?</strong> {best.changes.join(' ')}</p></> : null}
      {assessment.limitations.length ? <><strong>Limitations and qualification needs</strong><ul>{assessment.limitations.map((s,i) => <li key={i}>{s}</li>)}</ul></> : null}
      {assessment.maintenance.length ? <><strong>Relationship and reorder needs</strong><ul>{assessment.maintenance.map(s => <li key={s}>{s}</li>)}</ul></> : null}
      {assessment.candidates.length > 1 ? <><strong>Alternatives</strong><ul>{assessment.candidates.slice(1).map(c => <li key={c.key}>{c.product.name}: {pathLabel[c.path]} · {c.score} priority · {c.upside}</li>)}</ul><p>Alternatives may overlap; their potential is never added together.</p></> : null}
    </details>
  </div>;
}
