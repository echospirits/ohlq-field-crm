export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { SubmitButton } from '../components/SubmitButton';
import { AgencyProductOpportunityState, OpportunityStatus, SalesAccountType } from '@prisma/client';
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
import { AGENCY_FOCUS_PAGE_SIZE, agencyFocusHref, agencyFocusPageNumber } from '../../lib/agencyFocusView';
import { TargetAccountControl } from '../components/TargetAccountControl';
import { TargetAccountMarker } from '../components/TargetAccountMarker';
import '../intelligence-browsing.css';

export const metadata = buildPageMetadata('Retail Intelligence');

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
  searchParams?: Promise<{ agencyId?: string; state?: string; q?: string; page?: string }>;
}) {
  const currentUser = await requireUser();
  const { organizationId } = await requireFeatureForUser(currentUser, 'AGENCY_INTELLIGENCE');
  const query = (await searchParams) ?? {};
  const search = query.q?.trim() ?? '';
  const page = agencyFocusPageNumber(query.page);
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
    orderBy: [{ priorityScore: 'desc' }, { lastDetectedAt: 'desc' }, { id: 'asc' }],
    skip: (page - 1) * AGENCY_FOCUS_PAGE_SIZE,
    take: AGENCY_FOCUS_PAGE_SIZE + 1,
  }), prisma.user.findMany({ where: { organizationId, isActive: true, role: { notIn: ['TASTER', 'PLATFORM_ADMIN'] } }, orderBy: [{ name: 'asc' }, { email: 'asc' }] })]);
  const actionUsers = users.map((user) => ({ id: user.id, name: getUserDisplayName(user) }));
  const visibleOpportunities = opportunities.slice(0, AGENCY_FOCUS_PAGE_SIZE);
  const targetedAgencies = await prisma.organizationAccountOverlay.findMany({ where: { organizationId, accountType: 'AGENCY', externalAccountId: { in: [...new Set(visibleOpportunities.map((item) => item.agency.id))] }, isTargeting: true }, select: { externalAccountId: true } });
  const targetedAgencyIds = new Set(targetedAgencies.map((item) => item.externalAccountId));
  const hasMore = opportunities.length > AGENCY_FOCUS_PAGE_SIZE;
  const returnTo = agencyFocusHref({ agencyId: query.agencyId, state, q: search, page });
  const latestSourceDate = visibleOpportunities.reduce<Date | null>(
    (latest, item) => !latest || item.asOfDate > latest ? item.asOfDate : latest,
    null,
  );
  const pagination = page > 1 || hasMore ? <nav aria-label="Retail intelligence pages" className="intelligence-pagination">
    <span>Page {page} · {visibleOpportunities.length} actions</span>
    <div>
      {page > 1 ? <Link href={agencyFocusHref({ ...query, page: page - 1 })}>Previous page</Link> : null}
      {hasMore ? <Link href={agencyFocusHref({ ...query, page: page + 1 })}>Next page</Link> : null}
    </div>
  </nav> : null;

  return <div className="agency-focus-page">
    <header className="page-heading page-header agency-focus-header">
      <div><h1>Retail Intelligence</h1></div>
      <DataFreshnessBadge sourceDate={latestSourceDate} />
    </header>
    <nav aria-label="Retail opportunity filters" className="opportunity-filters">
      <Link aria-current={!state ? 'page' : undefined} className={!state ? 'active' : undefined} href={agencyFocusHref({ ...query, state: undefined, page: 1 })}>All actions</Link>
      {actionableStates.map((value) => <Link aria-current={state === value ? 'page' : undefined} className={state === value ? 'active' : undefined} href={agencyFocusHref({ ...query, state: value, page: 1 })} key={value}>{stateLabels[value]}</Link>)}
    </nav>
    <div className="agency-focus-toolbar">
      <AgencyFocusSearch value={search} />
      <p className="agency-focus-count">{page > 1 || hasMore ? `Page ${page} · ${visibleOpportunities.length} actions${hasMore ? ' · More on next page' : ''}` : `${visibleOpportunities.length} matching ${visibleOpportunities.length === 1 ? 'action' : 'actions'}`} · Highest priority first</p>
      {query.agencyId ? <span className="agency-focus-scope">Single retail view <Link href={agencyFocusHref({ state, q: search })}>Show all retail accounts</Link></span> : null}
      {state || search ? <Link href={agencyFocusHref({ agencyId: query.agencyId })}>Clear filters</Link> : null}
    </div>
    {pagination}
    {visibleOpportunities.length ? <div className="table-scroll" role="region" aria-label="Retail recommendations" tabIndex={0}>
      <table className="comparison-table intelligence-comparison-table retail-intelligence-table">
        <thead><tr><th scope="col">Account / product</th><th scope="col">Next action</th><th scope="col" className="numeric">On hand / min</th><th scope="col" className="numeric">Sales · 7 / 30d</th><th scope="col">Evidence</th><th scope="col">Actions</th></tr></thead>
        <tbody>{visibleOpportunities.map((item) => <tr key={item.id}>
          <th scope="row" data-label="Account / product">
            <Link className="intelligence-record-name" href={`/agencies/${item.agency.id}`}>{item.agency.name}</Link>
            {targetedAgencyIds.has(item.agency.id) ? <TargetAccountMarker /> : null}
            <small>{item.agency.city} · Retail {item.agency.agencyId}</small>
            <strong className="intelligence-product-name">{item.itemName}</strong><small>Item {item.itemCode} · Through {formatDateOnly(item.asOfDate)}</small>
          </th>
          <td data-label="Next action"><strong>{titleCase(item.recommendedAction)}</strong><small>{stateLabels[item.opportunityState]}</small><span className={`priority priority-${item.priorityBand.toLowerCase()}`}>{titleCase(item.priorityBand)}</span></td>
          <td className="numeric" data-label="On hand / min"><strong>{item.onHand ?? 'Unavailable'}</strong><small>Min {item.minimum ?? 'Unavailable'}</small></td>
          <td className="numeric" data-label="Sales · 7 / 30d"><strong>{item.retailSales7.toLocaleString()} / {item.retailSales30.toLocaleString()}</strong><small>bottles</small></td>
          <td data-label="Evidence">
            {stringList(item.reasons)[0] ? <p className="intelligence-key-reason agency-focus-key-reason">{stringList(item.reasons)[0]}</p> : null}
            <small>Fit {item.fitScore} · {titleCase(item.fitBand)} · Peer carry {item.peerCarryPercent === null ? 'Unavailable' : `${Math.round(item.peerCarryPercent)}%`}</small>
            {stringList(item.reasons).length > 1 ? <details className="compact-details"><summary>Why this recommendation?</summary><ul aria-label="Recommendation evidence">{stringList(item.reasons).slice(1).map((reason) => <li key={reason}>{reason}</li>)}</ul></details> : null}
          </td>
          <td data-label="Actions"><div className="intelligence-row-actions">
            <ContextualActions
              context={{ accountName: item.agency.name, agencyId: item.agency.id, agencyProductIntelligenceId: item.id, productItemCode: item.itemCode, productName: item.itemName, reason: stringList(item.reasons).join(' '), returnTo, sourceLabel: `${stateLabels[item.opportunityState]} - ${item.itemName}`, sourceType: item.opportunityState }}
              currentUserId={currentUser.id} existingFollowUpId={item.worklistItems[0]?.id} users={actionUsers}
            />
            <details className="compact-details intelligence-more-actions"><summary>More actions</summary>
              <div className="intelligence-secondary-actions">
                <TargetAccountControl accountType={SalesAccountType.AGENCY} externalAccountId={item.agency.id} isTargeting={targetedAgencyIds.has(item.agency.id)} returnTo={returnTo} />
                <form action={updateAgencyOpportunity}><input name="id" type="hidden" value={item.id}/><SubmitButton className="secondary compact-btn" name="action" value="snooze">Snooze 14d</SubmitButton></form>
                <details className="agency-focus-dismiss"><summary>Dismiss recommendation</summary><form action={updateAgencyOpportunity}><input name="id" type="hidden" value={item.id}/><select aria-label="Dismissal reason" name="reason" defaultValue="Not a fit"><option>Not a fit</option><option>Already handled</option><option>Wrong timing</option><option>Bad or missing data</option><option>Other</option></select><SubmitButton className="danger compact-btn" name="action" value="dismiss">Dismiss</SubmitButton></form></details>
              </div>
            </details>
          </div></td>
        </tr>)}</tbody>
      </table>
    </div> : <div className="empty-state"><h2>No matching retail actions</h2><p>{state || search || query.agencyId ? 'Try another action type, clear your search, or show all retail accounts.' : 'No active recommendations are available yet. Check data freshness or browse your retail accounts.'}</p><Link href={state || search || query.agencyId ? '/agency-focus' : '/agencies'}>{state || search || query.agencyId ? 'Show all actions' : 'Browse retail accounts'}</Link></div>}
    {pagination}
  </div>;
}
