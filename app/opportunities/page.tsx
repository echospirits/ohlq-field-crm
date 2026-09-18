export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ActionForm } from '../components/ActionForm';
import { SubmitButton } from '../components/SubmitButton';
import { OpportunityEventType, OpportunityStatus, OpportunityType, Prisma, UserRole } from '@prisma/client';
import Link from 'next/link';
import { buildPageMetadata } from '../../lib/appBrand';
import { getUserDisplayName, requireUser } from '../../lib/auth';
import { formatEasternDate, formatEasternDateTime } from '../../lib/dateTime';
import { isOpportunityTerritorySlug, OPPORTUNITY_TERRITORIES, opportunityTerritoryAccountWhere, type OpportunityTerritorySlug } from '../../lib/opportunityTerritories';
import { prisma } from '../../lib/prisma';
import { requireFeatureForUser } from '../../lib/organizations';
import { updateOpportunity } from './actions';
import { ContextualActions } from '../components/ContextualActions';
import { DataFreshnessBadge } from '../components/DataFreshnessBadge';

export const metadata = buildPageMetadata('Wholesale Opportunities');

const labels: Record<OpportunityType, string> = { LAPSED_BUYER: 'Reactivation', FIRST_ORDER_FOLLOW_UP: 'First Reorder', CATEGORY_CONQUEST: 'Category Opportunity', CROSS_SELL: 'Cross-Sell', NO_RECENT_TOUCH: 'Needs Attention' };
const TERRITORY_RESULT_LIMIT = 12;
const opportunityInclude = {
  wholesaleAccount: { select: { name: true, city: true, county: true } },
  worklistItems: { where: { status: { in: ['OPEN', 'IN_PROGRESS'] as const } }, orderBy: [{ dueDate: 'asc' as const }, { createdAt: 'asc' as const }], take: 1, select: { id: true } },
} satisfies Prisma.SalesOpportunityInclude;
type OpportunityRow = Prisma.SalesOpportunityGetPayload<{ include: typeof opportunityInclude }>;
type OpportunityQuery = { type?: string; priority?: string; sort?: string; territory?: string; view?: string };

const reasonsFor = (item: OpportunityRow) => Array.isArray(item.explanation) ? item.explanation.map(String) : [];

function opportunityWhere({ organizationId, priority, territory, type }: { organizationId: string; priority?: string; territory?: OpportunityTerritorySlug; type?: OpportunityType }): Prisma.SalesOpportunityWhereInput {
  return {
    organizationId,
    status: OpportunityStatus.OPEN,
    ...(type ? { type } : {}),
    ...(priority ? { priorityBand: priority.toUpperCase() } : {}),
    ...(territory ? { wholesaleAccount: { is: opportunityTerritoryAccountWhere(territory) } } : {}),
  };
}

export default async function OpportunityInbox({ searchParams }: { searchParams?: Promise<OpportunityQuery> }) {
  const currentUser = await requireUser();
  const { organizationId } = await requireFeatureForUser(currentUser, 'WHOLESALE_OPPORTUNITIES');
  const query = (await searchParams) ?? {};
  const type = Object.values(OpportunityType).includes(query.type as OpportunityType) ? query.type as OpportunityType : undefined;
  const territory = isOpportunityTerritorySlug(query.territory) ? query.territory : undefined;
  const territoryView = query.view === 'territories';
  const lowestFirst = query.sort === 'lowest' && !territoryView;
  const priority = query.priority?.toLowerCase() === 'high' ? 'HIGH' : undefined;
  const baseWhere = opportunityWhere({ organizationId, priority, type });
  const filteredWhere = opportunityWhere({ organizationId, priority, territory, type });

  const [opportunityCount, assignees, opportunities, territoryGroups] = await Promise.all([
    prisma.salesOpportunity.count({ where: territoryView ? baseWhere : filteredWhere }),
    prisma.user.findMany({ where: { organizationId, isActive: true, role: { notIn: ['TASTER', 'PLATFORM_ADMIN'] } }, orderBy: [{ name: 'asc' }, { email: 'asc' }] }),
    territoryView ? Promise.resolve([] as OpportunityRow[]) : prisma.salesOpportunity.findMany({ where: filteredWhere, include: opportunityInclude, orderBy: [{ productionScore: lowestFirst ? 'asc' : 'desc' }, { detectedAt: 'desc' }], take: 250 }),
    territoryView ? Promise.all(OPPORTUNITY_TERRITORIES.map(async (item) => {
      const where = opportunityWhere({ organizationId, priority, territory: item.slug, type });
      const [rows, count] = await Promise.all([
        prisma.salesOpportunity.findMany({ where, include: opportunityInclude, orderBy: [{ productionScore: 'desc' }, { detectedAt: 'desc' }], take: TERRITORY_RESULT_LIMIT }),
        prisma.salesOpportunity.count({ where }),
      ]);
      return { ...item, count, opportunities: rows };
    })) : Promise.resolve([]),
  ]);
  const shownOpportunities = territoryView ? territoryGroups.flatMap((group) => group.opportunities) : opportunities;
  const actionUsers = assignees.map((assignee) => ({ id: assignee.id, name: getUserDisplayName(assignee) }));
  const latestSignalAt = shownOpportunities.reduce<Date | null>((latest, item) => !latest || item.lastDetectedAt > latest ? item.lastDetectedAt : latest, null);

  const buildHref = (updates: Partial<OpportunityQuery>) => {
    const next = { ...query, ...updates };
    const params = new URLSearchParams();
    for (const key of ['type', 'priority', 'sort', 'territory', 'view'] as const) if (next[key]) params.set(key, next[key]!);
    return `/opportunities${params.size ? `?${params}` : ''}`;
  };
  const renderOpportunity = (item: OpportunityRow) => {
    const reasons = reasonsFor(item);
    return <article className="card opportunity-card" key={item.id}>
      <div className="opportunity-card-heading"><div><span className={`priority priority-${item.priorityBand.toLowerCase()}`}>{item.priorityBand}</span><small>{labels[item.type]}</small><h2><Link href={`/wholesale/${item.wholesaleAccountId}`}>{item.wholesaleAccount.name}</Link></h2><p className="muted">{[item.wholesaleAccount.city, item.wholesaleAccount.county].filter(Boolean).join(' · ')}</p></div><span className="opportunity-score"><strong>{Math.round(item.productionScore)}</strong><small>score</small></span></div>
      <p className="opportunity-primary-action"><strong>Next:</strong> {item.recommendedAction}</p>
      <p className="muted opportunity-intelligence-updated">Intelligence updated {formatEasternDateTime(item.lastDetectedAt)}</p>
      {item.status === OpportunityStatus.ACTIONED ? <p className="opportunity-pursuing" role="status"><strong>Pursuing</strong>{item.actionedAt ? ` since ${formatEasternDate(item.actionedAt)}` : ''}</p> : null}
      <ContextualActions context={{ accountName: item.wholesaleAccount.name, opportunityId: item.id, reason: reasons.join(' '), returnTo: buildHref({}), sourceLabel: item.title, sourceType: item.type, wholesaleAccountId: item.wholesaleAccountId }} currentUserId={currentUser.id} existingFollowUpId={item.worklistItems[0]?.id} followUpLabel="Create Follow-up" users={actionUsers} />
      <details className="opportunity-evidence compact-details nested-details"><summary>Why this opportunity</summary><ul>{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></details>
      <details className="opportunity-more-actions"><summary>More</summary><div className="opportunity-more-menu">
        <ActionForm action={updateOpportunity} className="opportunity-feedback"><input type="hidden" name="id" value={item.id}/><input aria-label="Snooze until" name="snoozedUntil" type="date" required/><SubmitButton name="action" value="snooze">Snooze</SubmitButton></ActionForm>
        <ActionForm action={updateOpportunity} className="opportunity-dismiss"><input type="hidden" name="id" value={item.id}/><select aria-label="Dismissal reason" name="reason" defaultValue="Wrong timing">{['Not a fit','Wrong timing','Already handled','Buyer not interested','Seasonal','Bad/missing data','Other'].map((reason) => <option key={reason}>{reason}</option>)}</select><SubmitButton className="danger" name="action" value="dismiss">Dismiss</SubmitButton></ActionForm>
      </div></details>
    </article>;
  };

  await prisma.opportunityEvent.createMany({ skipDuplicates: true, data: shownOpportunities.map((item) => ({ organizationId, opportunityId: item.id, eventType: OpportunityEventType.SHOWN, eventKey: 'SHOWN:INBOX', wholesaleAccountId: item.wholesaleAccountId, occurredAt: new Date() })) });
  return <>
    <header className="page-heading page-header"><div><span className="page-eyebrow">Intelligence · Wholesale</span><h1>Wholesale Opportunities</h1><p className="muted">Prioritized recommendations with statewide and territory views. Geography changes what you see, never how an account scores.</p></div><div className="page-actions"><DataFreshnessBadge datePrefix="Signals through" sourceDate={latestSignalAt} /><Link className="btn secondary" href="/alerts?view=pursuing">View pursuing</Link>{currentUser.role === UserRole.ADMIN ? <Link className="btn secondary" href="/admin/opportunity-performance">Performance</Link> : null}</div></header>
    <nav aria-label="Opportunity views" className="opportunity-filters">
      <Link aria-current={!territoryView && !territory && !type && !priority && !lowestFirst ? 'page' : undefined} className={!territoryView && !territory && !type && !priority && !lowestFirst ? 'active' : undefined} href="/opportunities">Best statewide</Link>
      <Link aria-current={territoryView ? 'page' : undefined} className={territoryView ? 'active' : undefined} href={buildHref({ territory: undefined, view: 'territories', sort: undefined })}>Best by territory</Link>
      <Link aria-current={priority ? 'page' : undefined} className={priority ? 'active' : undefined} href={buildHref({ priority: 'high', sort: undefined })}>High priority</Link>
      <Link aria-current={lowestFirst ? 'page' : undefined} className={lowestFirst ? 'active' : undefined} href={buildHref({ sort: 'lowest', territory: undefined, view: undefined })}>Lowest scores</Link>
      {Object.values(OpportunityType).map((value) => <Link aria-current={type === value ? 'page' : undefined} className={type === value ? 'active' : undefined} href={buildHref({ type: value })} key={value}>{labels[value]}</Link>)}
    </nav>
    {!territoryView ? <nav aria-label="Opportunity territories" className="opportunity-filters opportunity-territory-filters"><Link aria-current={!territory ? 'page' : undefined} className={!territory ? 'active' : undefined} href={buildHref({ territory: undefined })}>All Ohio</Link>{OPPORTUNITY_TERRITORIES.map((item) => <Link aria-current={territory === item.slug ? 'page' : undefined} className={territory === item.slug ? 'active' : undefined} href={buildHref({ territory: item.slug, view: undefined })} key={item.slug}>{item.shortLabel}</Link>)}</nav> : null}
    <p className="muted opportunity-result-count">{territoryView ? `Showing up to ${TERRITORY_RESULT_LIMIT} top opportunities per territory across ${opportunityCount.toLocaleString()} matching open opportunities.` : `Showing ${opportunities.length.toLocaleString()} of ${opportunityCount.toLocaleString()} matching open opportunities, ${lowestFirst ? 'lowest' : 'highest'} score first.`}</p>
    {territoryView ? <div className="opportunity-territory-groups">{territoryGroups.map((group) => <section aria-labelledby={`territory-${group.slug}`} className="opportunity-territory-group" key={group.slug}>
      <div className="section-heading opportunity-territory-heading"><div><span className="page-eyebrow">Sales territory</span><h2 id={`territory-${group.slug}`}>{group.label}</h2><p className="muted">{group.count.toLocaleString()} matching open {group.count === 1 ? 'opportunity' : 'opportunities'}</p></div>{group.count > 0 ? <Link className="btn secondary" href={buildHref({ territory: group.slug, view: undefined })}>View all</Link> : null}</div>
      {group.opportunities.length ? <div className="opportunity-grid">{group.opportunities.map(renderOpportunity)}</div> : <p className="card muted">No open opportunities match this territory and filter.</p>}
    </section>)}</div> : <section className="opportunity-grid">{opportunities.map(renderOpportunity)}</section>}
    {opportunityCount === 0 ? <p className="card muted">No open opportunities match this view. Clear a filter or choose another territory.</p> : null}
  </>;
}
