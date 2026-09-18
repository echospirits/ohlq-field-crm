export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { SubmitButton } from '../components/SubmitButton';
import { AgencyProductOpportunityState, OpportunityStatus } from '@prisma/client';
import Link from 'next/link';
import { buildPageMetadata } from '../../lib/appBrand';
import { requireUser } from '../../lib/auth';
import { prisma } from '../../lib/prisma';
import { updateAgencyOpportunity } from './actions';
import { getUserDisplayName } from '../../lib/auth';
import { ContextualActions } from '../components/ContextualActions';
import { DataFreshnessBadge } from '../components/DataFreshnessBadge';
import { requireFeatureForUser } from '../../lib/organizations';
import { AgencyFocusSearch } from './AgencyFocusSearch';
import { formatDateOnly } from '../../lib/dateTime';
import { agencyFocusHref } from '../../lib/agencyFocusView';

export const metadata = buildPageMetadata('Agency Intelligence');

const titleCase = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

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
  searchParams?: Promise<{ agencyId?: string; state?: string; q?: string }>;
}) {
  const currentUser = await requireUser();
  const { organizationId } = await requireFeatureForUser(currentUser, 'AGENCY_INTELLIGENCE');
  const query = (await searchParams) ?? {};
  const search = query.q?.trim() ?? '';
  const state = Object.values(AgencyProductOpportunityState).includes(query.state as AgencyProductOpportunityState)
    ? query.state as AgencyProductOpportunityState
    : undefined;
  const [opportunities, users] = await Promise.all([prisma.agencyProductIntelligence.findMany({
    where: {
      organizationId,
      status: { in: [OpportunityStatus.OPEN, OpportunityStatus.ACTIONED] },
      opportunityState: state ?? { in: actionableStates },
      ...(query.agencyId ? { agencyId: query.agencyId } : {}),
      ...(search ? { OR: [
        { itemName: { contains: search, mode: 'insensitive' as const } },
        { itemCode: { contains: search, mode: 'insensitive' as const } },
        { agency: { name: { contains: search, mode: 'insensitive' as const } } },
        { agency: { city: { contains: search, mode: 'insensitive' as const } } },
        { agency: { agencyId: { contains: search, mode: 'insensitive' as const } } },
      ] } : {}),
    },
    include: {
      agency: { select: { id: true, agencyId: true, city: true, name: true } },
      worklistItems: {
        where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
        take: 1,
        select: { id: true },
      },
    },
    orderBy: [{ priorityScore: 'desc' }, { lastDetectedAt: 'desc' }],
    take: 251,
  }), prisma.user.findMany({ where: { organizationId, isActive: true, role: { notIn: ['TASTER', 'PLATFORM_ADMIN'] } }, orderBy: [{ name: 'asc' }, { email: 'asc' }] })]);
  const actionUsers = users.map((user) => ({ id: user.id, name: getUserDisplayName(user) }));
  const visibleOpportunities = opportunities.slice(0, 250);
  const returnTo = agencyFocusHref({ agencyId: query.agencyId, state, q: search });
  const latestSourceDate = visibleOpportunities.reduce<Date | null>(
    (latest, item) => !latest || item.asOfDate > latest ? item.asOfDate : latest,
    null,
  );

  return <div className="agency-focus-page">
    <header className="page-heading page-header agency-focus-header">
      <div><span className="page-eyebrow">Intelligence · Retail actions</span><h1>Agency Intelligence</h1><p className="muted">Prioritized agency actions. Inventory, sales, and evidence at a glance.</p></div>
      <DataFreshnessBadge sourceDate={latestSourceDate} />
    </header>
    <nav aria-label="Agency opportunity filters" className="opportunity-filters">
      <Link aria-current={!state ? 'page' : undefined} className={!state ? 'active' : undefined} href={agencyFocusHref({ ...query, state: undefined })}>All actions</Link>
      {actionableStates.map((value) => <Link aria-current={state === value ? 'page' : undefined} className={state === value ? 'active' : undefined} href={agencyFocusHref({ ...query, state: value })} key={value}>{stateLabels[value]}</Link>)}
    </nav>
    <div className="agency-focus-toolbar">
      <AgencyFocusSearch value={search} />
      <p className="agency-focus-count">{opportunities.length > 250 ? 'Top 250 matching actions — narrow your search for more.' : `${opportunities.length} matching ${opportunities.length === 1 ? 'action' : 'actions'}`} · Highest priority first</p>
      {query.agencyId ? <span className="agency-focus-scope">Single agency view <Link href={agencyFocusHref({ state, q: search })}>Show all agencies</Link></span> : null}
      {state || search ? <Link href={agencyFocusHref({ agencyId: query.agencyId })}>Clear filters</Link> : null}
    </div>
    <section aria-label="Agency recommendations" className="agency-focus-results">
      {visibleOpportunities.map((item) => <article aria-labelledby={`focus-${item.id}`} className="agency-focus-row" key={item.id}>
        <div className="agency-focus-identity">
          <h2 id={`focus-${item.id}`}><Link href={`/agencies/${item.agency.id}`}>{item.agency.name}</Link></h2>
          <p className="muted">#{item.agency.agencyId}{item.agency.city ? ` · ${item.agency.city}` : ''}</p>
          <div className="agency-focus-state"><span className={`priority priority-${item.priorityBand.toLowerCase()}`}>{titleCase(item.priorityBand)}</span><span>{stateLabels[item.opportunityState]}</span></div>
        </div>
        <div className="agency-focus-product">
          <strong>{item.itemName}</strong>
          <small>Item {item.itemCode} · Through {formatDateOnly(item.asOfDate)}</small>
          <p><strong>Next:</strong> {titleCase(item.recommendedAction)}</p>
        </div>
        <dl className="agency-focus-metrics">
          <div><dt>On hand</dt><dd>{item.onHand ?? '—'}</dd></div>
          <div><dt>Minimum</dt><dd>{item.minimum ?? '—'}</dd></div>
          <div><dt>Sales / 7d</dt><dd>{item.retailSales7}</dd></div>
          <div><dt>Sales / 30d</dt><dd>{item.retailSales30}</dd></div>
          <div><dt>Fit score</dt><dd>{item.fitScore} <small>{titleCase(item.fitBand)}</small></dd></div>
          <div><dt>Peer carry</dt><dd>{item.peerCarryPercent === null ? '—' : `${Math.round(item.peerCarryPercent)}%`}</dd></div>
        </dl>
        <ul aria-label="Recommendation evidence" className="agency-focus-reasons">{stringList(item.reasons).map((reason) => <li key={reason}>{reason}</li>)}</ul>
        <div className="agency-focus-row-actions">
          <ContextualActions
            context={{ accountName: item.agency.name, agencyId: item.agency.id, agencyProductIntelligenceId: item.id, productItemCode: item.itemCode, productName: item.itemName, reason: stringList(item.reasons).join(' '), returnTo, sourceLabel: `${stateLabels[item.opportunityState]} - ${item.itemName}`, sourceType: item.opportunityState }}
            currentUserId={currentUser.id}
            existingFollowUpId={item.worklistItems[0]?.id}
            users={actionUsers}
          />
          <form action={updateAgencyOpportunity}><input name="id" type="hidden" value={item.id}/><SubmitButton className="secondary compact-btn" name="action" value="snooze">Snooze 14d</SubmitButton></form>
          <details className="agency-focus-dismiss"><summary>Dismiss</summary><form action={updateAgencyOpportunity}><input name="id" type="hidden" value={item.id}/><select aria-label="Dismissal reason" name="reason" defaultValue="Not a fit"><option>Not a fit</option><option>Already handled</option><option>Wrong timing</option><option>Bad or missing data</option><option>Other</option></select><SubmitButton className="danger compact-btn" name="action" value="dismiss">Dismiss</SubmitButton></form></details>
        </div>
      </article>)}
      {opportunities.length === 0 ? <div className="empty-state"><h2>No matching agency actions</h2><p>{state || search || query.agencyId ? 'Try another action type, clear your search, or show all agencies.' : 'No active recommendations are available yet. Check data freshness or browse your agencies.'}</p><Link href={state || search || query.agencyId ? '/agency-focus' : '/agencies'}>{state || search || query.agencyId ? 'Show all actions' : 'Browse agencies'}</Link></div> : null}
    </section>
  </div>;
}
