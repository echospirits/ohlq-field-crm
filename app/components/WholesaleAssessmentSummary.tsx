import type { ReactNode } from 'react';
import { formatEasternDateTime } from '../../lib/dateTime';
import { evidenceModeLabel, readAssessment } from '../../lib/wholesaleAssessment';
import { CommercialOpportunityStars } from './CommercialOpportunityStars';

export function WholesaleAssessmentSummary({ value, actions, pending = false, status, reason, compact = false }: {
  value: unknown; actions?: ReactNode; pending?: boolean; status?: string | null; reason?: string | null; compact?: boolean;
}) {
  const assessment = readAssessment(value);
  if (!assessment) return <div className="wholesale-assessment"><CommercialOpportunityStars rating={null} status={status ?? 'PENDING'} pending={pending} /><p className="muted">{reason ?? 'Current commercial assessment unavailable. The next refresh will assess this account.'}</p>{actions}</div>;
  const stale = Date.now() - Date.parse(assessment.calculatedAt) > 48 * 3_600_000;
  const commercial = assessment.commercial;
  const periods = assessment.coverage.contextPeriods;
  const quantity = (value: number | null | undefined) => value == null ? 'Unavailable' : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return <div className="wholesale-assessment">
    <div className="assessment-heading">{!compact ? <span>Commercial opportunity</span> : null}<CommercialOpportunityStars rating={assessment.rating} status={status} pending={pending} stale={stale} /><span className={compact ? 'assessment-evidence-mode' : 'pill'}>{evidenceModeLabel[assessment.evidenceMode]}</span></div>
    <strong>{assessment.title}</strong>
    {compact ? <p className="assessment-key-reason">{assessment.reasons[0]}</p> : <ul>{assessment.reasons.slice(0, 2).map(reason => <li key={reason}>{reason}</li>)}</ul>}
    {actions}
    <details className="compact-details"><summary>{compact ? 'Why this recommendation?' : 'Commercial evidence and details'}</summary>
      {compact && assessment.reasons.length ? <ul>{assessment.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul> : null}
      <p>Commercial tiers describe portfolio fit and meaningful purchasing depth. They do not predict an order or attainable revenue. Buyer access and pursuit preferences are separate.</p>
      <p>Last calculated {formatEasternDateTime(new Date(assessment.calculatedAt))} · Last researched {assessment.researchAt ? formatEasternDateTime(new Date(assessment.researchAt)) : 'Unavailable'}</p>
      <p>Sales foundation: {assessment.coverage.representedFrom ?? 'Unavailable'} through {assessment.coverage.through ?? 'Unavailable'} · {commercial.representedDays ? `${commercial.representedDays} represented days` : 'No sales period'}. Latest source date {assessment.coverage.latestSourceDate ?? 'Unavailable'}. Assessment effective date {assessment.asOf}.</p>
      {assessment.evidenceMode !== 'RESEARCH_ONLY' ? <>
        <p>Compatible purchasing: {quantity(commercial.compatible750)} 750 ml equivalents in the represented period; {quantity(commercial.compatible750Per30)} per 30 days.</p>
        <p>Strongest compatible product: {quantity(commercial.leadingProduct750Per30)} 750 ml equivalents per 30 days. Meaningful core: {quantity(commercial.core750Per30)}; recurring core: {quantity(commercial.recurringCore750Per30)} per 30 days.</p>
        {periods ? <><p>Recent purchasing context (physical bottles):</p><ul>{([['Latest 30 days', periods.latest30], ['Earlier 30 days', periods.previous30]] as const).map(([label, period]) => <li key={label}>{label}: {period.from} through {period.through}; {period.coveredDays > 0 ? `${quantity(period.bottles)} bottles on ${period.coveredDays} represented days` : 'Source unavailable'}.</li>)}</ul>{periods.latest30.coveredDays !== 30 || periods.previous30.coveredDays !== 30 ? <p>These context periods are not directly comparable unless both have complete, equal coverage. Unavailable days are not zero sales.</p> : null}</> : null}
        <p>Purchases are observed purchasing, not measured consumer consumption. Distinct purchase dates describe ordering history only when available.</p>
      </> : <p>Research supports a qualitative commercial tier; it does not establish bottle volumes or invoice costs.</p>}
      <p>Price basis: {commercial.priceBasis === 'CATALOG_RETAIL_PROXY' ? 'Published catalog retail positioning proxy; not invoice costs' : commercial.priceBasis === 'PUBLISHED_WHOLESALE' ? 'Published account-facing restaurant prices' : commercial.priceBasis === 'MIXED' ? 'Comparable published price bases; see limitations' : 'Unavailable'}.</p>
      <p>Assessment: {reason ?? assessment.ratingReason} Model {assessment.version}; calibration {assessment.calibrationVersion}.</p>
      {assessment.limitations.length ? <><strong>Evidence limitations</strong><ul>{assessment.limitations.map((s,i) => <li key={i}>{s}</li>)}</ul></> : null}
      {assessment.maintenance.length ? <><strong>Existing customer service</strong><ul>{assessment.maintenance.map(s => <li key={s}>{s}</li>)}</ul></> : null}
    </details>
  </div>;
}
