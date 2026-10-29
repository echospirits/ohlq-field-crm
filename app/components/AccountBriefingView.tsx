import type { ReactNode } from 'react';
import type { getAccountBriefing } from '../../lib/crm/briefing';
import { formatEasternDate } from '../../lib/dateTime';

type Briefing = Pick<Awaited<ReturnType<typeof getAccountBriefing>>, 'health' | 'indicators'> & {
  lastContact: Date | null; lastMeaningful: Date | null; lastVisit: Date | null; lastFollowUp: Date | null;
};

export function AccountBriefingView({ briefing, lastPurchaseAt, action, children }: { briefing: Briefing; lastPurchaseAt?: Date | null; action?: ReactNode; children?: ReactNode }) {
  const facts: Array<[string, Date | null | undefined]> = [
    ['Last contact', briefing.lastContact], ['Meaningful interaction', briefing.lastMeaningful],
    ['Physical visit', briefing.lastVisit], ['Completed follow-up', briefing.lastFollowUp], ['Purchase evidence', lastPurchaseAt],
  ];
  const recorded = facts.filter((fact): fact is [string, Date] => fact[1] instanceof Date);
  const attention = [...new Set(briefing.indicators.reasons)].filter((reason) => reason !== 'No active contact recorded.' || briefing.indicators.nextAction !== 'Identify a buyer or decision-maker');

  return <section aria-label="Account briefing" className="account-briefing">
    <div className="account-briefing-heading"><h2>Account briefing</h2>{action}</div>
    {recorded.length ? <dl className="account-briefing-facts">{recorded.map(([label, date]) => <div key={label}><dt>{label}</dt><dd>{formatEasternDate(date)}</dd></div>)}</dl> : <p className="muted">No recorded relationship history available for this briefing.</p>}
    <div className="account-briefing-next"><strong>{briefing.indicators.nextAction}</strong>{attention.length ? <p>{attention.join(' ')}</p> : null}</div>
    <details className="compact-details account-briefing-evidence"><summary>Relationship evidence</summary>
      <p>{briefing.health.score === null ? 'Not enough evidence to assess relationship health.' : `Relationship health: ${briefing.health.score}/100`}</p>
      {briefing.health.reasons.length ? <ul>{briefing.health.reasons.map((reason) => <li key={reason.label}>{reason.label} · −{reason.penalty} points</li>)}</ul> : null}
      {briefing.health.missing.length ? <p className="muted">Missing: {briefing.health.missing.join(', ')}. Missing data is not zero performance.</p> : null}
      <p className="muted">Based on records you can see. Purchase evidence may reflect a reporting date; invitations do not prove a meeting occurred.</p>
    </details>
    {children}
  </section>;
}
