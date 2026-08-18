export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { AgencyProductOpportunityState, OpportunityStatus } from '@prisma/client';
import Link from 'next/link';
import { requireUser } from '../../lib/auth';
import { prisma } from '../../lib/prisma';
import { updateAgencyOpportunity } from './actions';

const stateLabels: Record<AgencyProductOpportunityState, string> = {
  ACTIVATION_OPPORTUNITY: 'Tasting',
  AT_RISK: 'At risk',
  DEAD_INVENTORY: 'Dead inventory',
  INSUFFICIENT_EVIDENCE: 'Insufficient evidence',
  LOW_PRIORITY: 'Low priority',
  MAINTAIN: 'Maintain',
  PLACEMENT_OPPORTUNITY: 'Placement',
  RESTOCK: 'Restock',
  STOCKOUT: 'Stockout',
  WINNING: 'Winning',
};

const actionableStates: AgencyProductOpportunityState[] = [
  AgencyProductOpportunityState.STOCKOUT,
  AgencyProductOpportunityState.RESTOCK,
  AgencyProductOpportunityState.PLACEMENT_OPPORTUNITY,
  AgencyProductOpportunityState.ACTIVATION_OPPORTUNITY,
  AgencyProductOpportunityState.AT_RISK,
  AgencyProductOpportunityState.DEAD_INVENTORY,
];

const stringList = (value: unknown) => Array.isArray(value) ? value.map(String) : [];

export default async function AgencyFocusPage({
  searchParams,
}: {
  searchParams?: Promise<{ agencyId?: string; state?: string }>;
}) {
  await requireUser();
  const query = (await searchParams) ?? {};
  const state = Object.values(AgencyProductOpportunityState).includes(query.state as AgencyProductOpportunityState)
    ? query.state as AgencyProductOpportunityState
    : undefined;
  const opportunities = await prisma.agencyProductIntelligence.findMany({
    where: {
      status: { in: [OpportunityStatus.OPEN, OpportunityStatus.ACTIONED] },
      opportunityState: state ?? { in: actionableStates },
      ...(query.agencyId ? { agencyId: query.agencyId } : {}),
    },
    include: {
      agency: { select: { id: true, agencyId: true, city: true, name: true } },
      worklistItems: {
        where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
        select: { id: true },
      },
    },
    orderBy: [{ priorityScore: 'desc' }, { lastDetectedAt: 'desc' }],
    take: 250,
  });

  return <>
    <header className="page-heading page-header">
      <div><span className="page-eyebrow">Agency intelligence</span><h1>Agency Focus</h1><p className="muted">The highest-value retail actions, with the inventory and sales facts behind each recommendation.</p></div>
    </header>
    <nav className="opportunity-filters">
      <Link href="/agency-focus">All actions</Link>
      {actionableStates.map((value) => <Link href={`/agency-focus?state=${value}`} key={value}>{stateLabels[value]}</Link>)}
    </nav>
    <section className="agency-focus-list">
      {opportunities.map((item) => <article className="card agency-focus-card" key={item.id}>
        <div className="agency-focus-card-heading">
          <div><span className={`priority priority-${item.priorityBand.toLowerCase()}`}>{item.priorityBand}</span><small>{stateLabels[item.opportunityState]}</small><h2><Link href={`/agencies/${item.agency.id}`}>{item.agency.name}</Link></h2><p className="muted">Agency {item.agency.agencyId}{item.agency.city ? ` · ${item.agency.city}` : ''}</p></div>
          <div className="agency-focus-item"><span className="ohlq-item-code">{item.itemCode}</span><strong>{item.itemName}</strong></div>
        </div>
        <dl className="agency-product-metrics">
          <div><dt>On hand</dt><dd>{item.onHand ?? '—'}</dd></div>
          <div><dt>Minimum</dt><dd>{item.minimum ?? '—'}</dd></div>
          <div><dt>Sales / 7d</dt><dd>{item.retailSales7}</dd></div>
          <div><dt>Sales / 30d</dt><dd>{item.retailSales30}</dd></div>
          <div><dt>Fit</dt><dd>{item.fitBand} · {item.fitScore}</dd></div>
          <div><dt>Peer carry</dt><dd>{item.peerCarryPercent === null ? '—' : `${Math.round(item.peerCarryPercent)}%`}</dd></div>
        </dl>
        <ul className="agency-product-reasons">{stringList(item.reasons).map((reason) => <li key={reason}>{reason}</li>)}</ul>
        <p className="agency-product-action"><strong>Recommended:</strong> {item.recommendedAction.toLowerCase().replaceAll('_', ' ')}</p>
        <div className="agency-focus-actions">
          <Link className="btn secondary compact-btn" href={`/agencies/${item.agency.id}`}>Open Agency</Link>
          <Link className="btn secondary compact-btn" href={`/visits/new?type=agency&agencyId=${item.agency.id}`}>Log visit</Link>
          <form action={updateAgencyOpportunity}><input name="id" type="hidden" value={item.id}/><button className="compact-btn" name="action" value="worklist" disabled={item.worklistItems.length > 0}>{item.worklistItems.length ? 'On worklist' : 'Add to worklist'}</button><button className="secondary compact-btn" name="action" value="snooze">Snooze 14d</button></form>
        </div>
        <details className="agency-focus-dismiss"><summary>Dismiss</summary><form action={updateAgencyOpportunity}><input name="id" type="hidden" value={item.id}/><select aria-label="Dismissal reason" name="reason" defaultValue="Not a fit"><option>Not a fit</option><option>Already handled</option><option>Wrong timing</option><option>Bad or missing data</option><option>Other</option></select><button className="danger compact-btn" name="action" value="dismiss">Dismiss</button></form></details>
      </article>)}
      {opportunities.length === 0 ? <p className="card muted">No active Agency opportunities match this view.</p> : null}
    </section>
  </>;
}
