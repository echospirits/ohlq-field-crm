export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { ActionForm } from '../components/ActionForm';
import { SubmitButton } from '../components/SubmitButton';
import { OpportunityEventType, OpportunityStatus, OpportunityType, Prisma, SalesAccountType, UserRole } from '@prisma/client';
import Link from 'next/link';
import { buildPageMetadata } from '../../lib/appBrand';
import { getUserDisplayName, requireUser } from '../../lib/auth';
import { formatEasternDate, formatEasternDateTime } from '../../lib/dateTime';
import { isOpportunityTerritorySlug, OPPORTUNITY_TERRITORIES, opportunityTerritoryAccountWhere, type OpportunityTerritorySlug } from '../../lib/opportunityTerritories';
import { opportunityEvidence } from '../../lib/opportunityPresentation';
import { prisma } from '../../lib/prisma';
import { requireFeatureForUser } from '../../lib/organizations';
import { updateOpportunity } from './actions';
import { ContextualActions } from '../components/ContextualActions';
import { DataFreshnessBadge } from '../components/DataFreshnessBadge';
import { OpportunitySearch } from './OpportunitySearch';
import { normalizeUsState } from '../../lib/usStates';
import { TargetAccountControl } from '../components/TargetAccountControl';

export const metadata = buildPageMetadata('Wholesale Opportunities');

const labels: Record<OpportunityType, string> = { LAPSED_BUYER: 'Reactivation', FIRST_ORDER_FOLLOW_UP: 'First Reorder', CATEGORY_CONQUEST: 'Category Opportunity', CROSS_SELL: 'Cross-Sell', NO_RECENT_TOUCH: 'Needs Attention' };
const TERRITORY_RESULT_LIMIT = 12;
const opportunityInclude = {
  wholesaleAccount: { select: { name: true, city: true, county: true, state: true } },
  worklistItems: { where: { status: { in: ['OPEN', 'IN_PROGRESS'] as const } }, orderBy: [{ dueDate: 'asc' as const }, { createdAt: 'asc' as const }], take: 1, select: { id: true } },
} satisfies Prisma.SalesOpportunityInclude;
type OpportunityRow = Prisma.SalesOpportunityGetPayload<{ include: typeof opportunityInclude }>;
type OpportunityQuery = { type?: string; priority?: string; q?: string; state?: string; sort?: string; territory?: string; view?: string };

const reasonsFor = (item: OpportunityRow) => opportunityEvidence(Array.isArray(item.explanation) ? item.explanation.map(String) : []);

function opportunityWhere({ organizationId, priority, search, state, territory, type }: { organizationId: string; priority?: string; search?: string; state?: string; territory?: OpportunityTerritorySlug; type?: OpportunityType }): Prisma.SalesOpportunityWhereInput {
  return {
    organizationId,
    status: OpportunityStatus.OPEN,
    ...(type ? { type } : {}),
    ...(priority ? { priorityBand: priority.toUpperCase() } : {}),
    ...(territory ? { wholesaleAccount: { is: opportunityTerritoryAccountWhere(territory) } } : {}),
    ...(state ? { AND: [{ wholesaleAccount: { is: { state: { equals: state, mode: 'insensitive' } } } }] } : {}),
    ...(search ? { OR: [
      { title: { contains: search, mode: 'insensitive' as const } },
      { recommendedAction: { contains: search, mode: 'insensitive' as const } },
      { targetCategory: { contains: search, mode: 'insensitive' as const } },
      { wholesaleAccount: { is: { OR: [
        { name: { contains: search, mode: 'insensitive' as const } },
        { city: { contains: search, mode: 'insensitive' as const } },
        { county: { contains: search, mode: 'insensitive' as const } },
      ] } } },
    ] } : {}),
  };
}

export default async function OpportunityInbox({ searchParams }: { searchParams?: Promise<OpportunityQuery> }) {
  const currentUser = await requireUser();
  const { organizationId } = await requireFeatureForUser(currentUser, 'WHOLESALE_OPPORTUNITIES');
  const query = (await searchParams) ?? {};
  const type = Object.values(OpportunityType).includes(query.type as OpportunityType) ? query.type as OpportunityType : undefined;
  const search = query.q?.trim() ?? '';
  const state = normalizeUsState(query.state) ?? undefined;
  const territory = (!state || state === 'OH') && isOpportunityTerritorySlug(query.territory) ? query.territory : undefined;
  const territoryView = (!state || state === 'OH') && query.view === 'territories';
  const lowestFirst = query.sort === 'lowest' && !territoryView;
  const priority = query.priority?.toLowerCase() === 'high' ? 'HIGH' : undefined;
  const baseWhere = opportunityWhere({ organizationId, priority, search, state: territoryView ? 'OH' : state, type });
  const filteredWhere = opportunityWhere({ organizationId, priority, search, state, territory, type });

  const [opportunityCount, assignees, opportunities, territoryGroups] = await Promise.all([
    prisma.salesOpportunity.count({ where: territoryView ? baseWhere : filteredWhere }),
    prisma.user.findMany({ where: { organizationId, isActive: true, role: { notIn: ['TASTER', 'PLATFORM_ADMIN'] } }, orderBy: [{ name: 'asc' }, { email: 'asc' }] }),
    territoryView ? Promise.resolve([] as OpportunityRow[]) : prisma.salesOpportunity.findMany({ where: filteredWhere, include: opportunityInclude, orderBy: [{ productionScore: lowestFirst ? 'asc' : 'desc' }, { detectedAt: 'desc' }], take: 250 }),
    territoryView ? Promise.all(OPPORTUNITY_TERRITORIES.map(async (item) => {
      const where = opportunityWhere({ organizationId, priority, search, territory: item.slug, type });
      const [rows, count] = await Promise.all([
        prisma.salesOpportunity.findMany({ where, include: opportunityInclude, orderBy: [{ productionScore: 'desc' }, { detectedAt: 'desc' }], take: TERRITORY_RESULT_LIMIT }),
        prisma.salesOpportunity.count({ where }),
      ]);
      return { ...item, count, opportunities: rows };
    })) : Promise.resolve([]),
  ]);
  const shownOpportunities = territoryView ? territoryGroups.flatMap((group) => group.opportunities) : opportunities;
  const targetedAccounts = await prisma.organizationAccountOverlay.findMany({ where: { organizationId, accountType: 'WHOLESALE', externalAccountId: { in: [...new Set(shownOpportunities.map((item) => item.wholesaleAccountId))] }, isTargeting: true }, select: { externalAccountId: true } });
  const targetedIds = new Set(targetedAccounts.map((item) => item.externalAccountId));
  const actionUsers = assignees.map((assignee) => ({ id: assignee.id, name: getUserDisplayName(assignee) }));
  const latestSignalAt = shownOpportunities.reduce<Date | null>((latest, item) => !latest || item.lastDetectedAt > latest ? item.lastDetectedAt : latest, null);

  const buildHref = (updates: Partial<OpportunityQuery>) => {
    const next = { ...query, ...updates };
    const params = new URLSearchParams();
    for (const key of ['type', 'priority', 'q', 'state', 'sort', 'territory', 'view'] as const) if (next[key]) params.set(key, next[key]!);
    return `/opportunities${params.size ? `?${params}` : ''}`;
  };
  const renderOpportunity = (item: OpportunityRow) => {
    const reasons = reasonsFor(item);
    return <article aria-labelledby={`opportunity-${item.id}`} className="opportunity-row" key={item.id}>
      <div className="opportunity-row-identity"><h2 id={`opportunity-${item.id}`}><Link href={`/wholesale/${item.wholesaleAccountId}`}>{item.wholesaleAccount.name}</Link></h2>{targetedIds.has(item.wholesaleAccountId) ? <p><strong className="target-account-marker">TARGET ACCOUNT</strong></p> : null}<p className="muted">{[item.wholesaleAccount.city, item.wholesaleAccount.state ?? 'OH', item.wholesaleAccount.county].filter(Boolean).join(' · ')}</p><div className="opportunity-row-state"><span className={`priority priority-${item.priorityBand.toLowerCase()}`}>{item.priorityBand}</span><span>{labels[item.type]}</span></div></div>
      <div className="opportunity-row-recommendation"><strong>{item.title}</strong>{item.targetCategory ? <small>{item.targetCategory}</small> : null}<p><strong>Next:</strong> {item.recommendedAction}</p></div>
      <dl className="opportunity-row-metrics"><div><dt>{item.scoringVersion.startsWith('RESEARCH_FIT_') ? 'Research-only score (provisional)' : 'Score'}</dt><dd>{Math.round(item.productionScore)}</dd></div><div><dt>Intelligence updated</dt><dd>{formatEasternDateTime(item.lastDetectedAt)}</dd></div></dl>
      {item.status === OpportunityStatus.ACTIONED ? <p className="opportunity-pursuing" role="status"><strong>In progress</strong>{item.actionedAt ? ` since ${formatEasternDate(item.actionedAt)}` : ''}</p> : null}
      <ul aria-label="Opportunity evidence" className="opportunity-row-reasons">{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      <div className="opportunity-row-actions"><TargetAccountControl accountType={SalesAccountType.WHOLESALE} externalAccountId={item.wholesaleAccountId} isTargeting={targetedIds.has(item.wholesaleAccountId)} returnTo={buildHref({})} /><ContextualActions context={{ accountName: item.wholesaleAccount.name, opportunityId: item.id, reason: reasons.join(' '), returnTo: buildHref({}), sourceLabel: item.title, sourceType: item.type, wholesaleAccountId: item.wholesaleAccountId }} currentUserId={currentUser.id} existingFollowUpId={item.worklistItems[0]?.id} followUpLabel="Create Follow-up" users={actionUsers} />
      <details className="opportunity-more-actions"><summary>More</summary><div className="opportunity-more-menu">
        <ActionForm action={updateOpportunity} className="opportunity-feedback"><input type="hidden" name="id" value={item.id}/><input aria-label="Snooze until" name="snoozedUntil" type="date" required/><SubmitButton name="action" value="snooze">Snooze</SubmitButton></ActionForm>
        <ActionForm action={updateOpportunity} className="opportunity-dismiss"><input type="hidden" name="id" value={item.id}/><select aria-label="Dismissal reason" name="reason" defaultValue="Wrong timing">{['Not a fit','Wrong timing','Already handled','Buyer not interested','Seasonal','Bad/missing data','Other'].map((reason) => <option key={reason}>{reason}</option>)}</select><SubmitButton className="danger" name="action" value="dismiss">Dismiss</SubmitButton></ActionForm>
      </div></details></div>
    </article>;
  };

  await prisma.opportunityEvent.createMany({ skipDuplicates: true, data: shownOpportunities.map((item) => ({ organizationId, opportunityId: item.id, eventType: OpportunityEventType.SHOWN, eventKey: 'SHOWN:INBOX', wholesaleAccountId: item.wholesaleAccountId, occurredAt: new Date() })) });
  return <div className="opportunities-page">
    <header className="page-heading page-header opportunities-header"><div><span className="page-eyebrow">Intelligence · Wholesale</span><h1>Wholesale Opportunities</h1><p className="muted">Prioritized recommendations. Geography changes what you see, never how an account scores.</p></div><div className="page-actions"><DataFreshnessBadge datePrefix="Signals through" sourceDate={latestSignalAt} /><Link className="btn secondary" href="/alerts?view=pursuing">View in progress</Link>{currentUser.role === UserRole.ADMIN ? <Link className="btn secondary" href="/admin/opportunity-performance">Performance</Link> : null}</div></header>
    <nav aria-label="Opportunity views" className="opportunity-filters">
      <Link aria-current={!territoryView && !territory && !type && !priority && !lowestFirst ? 'page' : undefined} className={!territoryView && !territory && !type && !priority && !lowestFirst ? 'active' : undefined} href="/opportunities">Best overall</Link>
      <Link aria-current={territoryView ? 'page' : undefined} className={territoryView ? 'active' : undefined} href={buildHref({ territory: undefined, view: 'territories', sort: undefined, state: undefined })}>Best by Ohio territory</Link>
      <Link aria-current={priority ? 'page' : undefined} className={priority ? 'active' : undefined} href={buildHref({ priority: 'high', sort: undefined })}>High priority</Link>
      <Link aria-current={lowestFirst ? 'page' : undefined} className={lowestFirst ? 'active' : undefined} href={buildHref({ sort: 'lowest', territory: undefined, view: undefined })}>Lowest scores</Link>
      {Object.values(OpportunityType).map((value) => <Link aria-current={type === value ? 'page' : undefined} className={type === value ? 'active' : undefined} href={buildHref({ type: value })} key={value}>{labels[value]}</Link>)}
    </nav>
    {!territoryView ? <nav aria-label="Opportunity territories" className="opportunity-filters opportunity-territory-filters"><Link aria-current={!territory ? 'page' : undefined} className={!territory ? 'active' : undefined} href={buildHref({ territory: undefined })}>All territories</Link>{OPPORTUNITY_TERRITORIES.map((item) => <Link aria-current={territory === item.slug ? 'page' : undefined} className={territory === item.slug ? 'active' : undefined} href={buildHref({ territory: item.slug, view: undefined, state: 'OH' })} key={item.slug}>{item.shortLabel}</Link>)}</nav> : null}
    <div className="opportunity-toolbar"><OpportunitySearch value={search} state={state ?? ''}/><p className="opportunity-result-count">{territoryView ? `Up to ${TERRITORY_RESULT_LIMIT} top opportunities per Ohio territory across ${opportunityCount.toLocaleString()} matches.` : `${opportunities.length.toLocaleString()} of ${opportunityCount.toLocaleString()} matching opportunities · ${lowestFirst ? 'Lowest' : 'Highest'} score first`}</p>{search || state ? <Link href={buildHref({ q: undefined, state: undefined, territory: undefined })}>Clear search and state</Link> : null}</div>
    <p className="muted">Research-only scores are provisional discovery ratings. Compare them with other research-only accounts; sales-backed scores use additional purchase and price evidence.</p>
    {territoryView ? <div className="opportunity-territory-groups">{territoryGroups.map((group) => <section aria-labelledby={`territory-${group.slug}`} className="opportunity-territory-group" key={group.slug}>
      <div className="section-heading opportunity-territory-heading"><div><span className="page-eyebrow">Sales territory</span><h2 id={`territory-${group.slug}`}>{group.label}</h2><p className="muted">{group.count.toLocaleString()} matching open {group.count === 1 ? 'opportunity' : 'opportunities'}</p></div>{group.count > 0 ? <Link className="btn secondary" href={buildHref({ territory: group.slug, view: undefined })}>View all</Link> : null}</div>
      {group.opportunities.length ? <div className="opportunity-results">{group.opportunities.map(renderOpportunity)}</div> : <p className="card muted">No open opportunities match this territory and filter.</p>}
    </section>)}</div> : <section aria-label="Wholesale recommendations" className="opportunity-results">{opportunities.map(renderOpportunity)}</section>}
    {opportunityCount === 0 ? <p className="card muted">No open opportunities match this view. Clear a filter or choose another territory.</p> : null}
  </div>;
}
