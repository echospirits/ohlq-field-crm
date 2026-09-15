export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { OpportunityEventType, OpportunityStatus, OpportunityType, UserRole } from '@prisma/client';
import Link from 'next/link';
import { buildPageMetadata } from '../../lib/appBrand';
import { getUserDisplayName, requireUser } from '../../lib/auth';
import { formatEasternDate, formatEasternDateTime } from '../../lib/dateTime';
import { prisma } from '../../lib/prisma';
import { requireFeatureForUser } from '../../lib/organizations';
import { updateOpportunity } from './actions';
import { ContextualActions } from '../components/ContextualActions';
import { DataFreshnessBadge } from '../components/DataFreshnessBadge';

export const metadata = buildPageMetadata('Opportunities');

const labels: Record<OpportunityType, string> = { LAPSED_BUYER: 'Reactivation', FIRST_ORDER_FOLLOW_UP: 'First Reorder', CATEGORY_CONQUEST: 'Category Opportunity', CROSS_SELL: 'Cross-Sell', NO_RECENT_TOUCH: 'Needs Attention' };

export default async function OpportunityInbox({ searchParams }: { searchParams?: Promise<{ type?: string; priority?: string; sort?: string }> }) {
  const currentUser = await requireUser();
  const { organizationId } = await requireFeatureForUser(currentUser, 'WHOLESALE_OPPORTUNITIES');
  const query = (await searchParams) ?? {};
  const type = Object.values(OpportunityType).includes(query.type as OpportunityType) ? query.type as OpportunityType : undefined;
  const lowestFirst = query.sort === 'lowest';
  const opportunityWhere = { organizationId, status: OpportunityStatus.OPEN, ...(type ? { type } : {}), ...(query.priority ? { priorityBand: query.priority.toUpperCase() } : {}) };
  const [opportunities, opportunityCount, assignees] = await Promise.all([
    prisma.salesOpportunity.findMany({
      where: opportunityWhere,
      include: { wholesaleAccount: { select: { name: true, city: true } }, worklistItems: { where: { status: { in: ['OPEN', 'IN_PROGRESS'] } }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }], take: 1, select: { id: true } } },
      orderBy: [{ productionScore: lowestFirst ? 'asc' : 'desc' }, { detectedAt: 'desc' }], take: 250,
    }),
    prisma.salesOpportunity.count({ where: opportunityWhere }),
    prisma.user.findMany({ where: { organizationId, isActive: true, role: { notIn: ['TASTER', 'PLATFORM_ADMIN'] } }, orderBy: [{ name: 'asc' }, { email: 'asc' }] }),
  ]);
  const actionUsers = assignees.map((assignee) => ({ id: assignee.id, name: getUserDisplayName(assignee) }));
  const latestSignalAt = opportunities.reduce<Date | null>(
    (latest, item) => !latest || item.lastDetectedAt > latest ? item.lastDetectedAt : latest,
    null,
  );
  await prisma.opportunityEvent.createMany({ skipDuplicates: true, data: opportunities.map((item) => ({ organizationId, opportunityId: item.id, eventType: OpportunityEventType.SHOWN, eventKey: 'SHOWN:INBOX', wholesaleAccountId: item.wholesaleAccountId, occurredAt: new Date() })) });
  return <>
    <header className="page-heading page-header"><div><span className="page-eyebrow">Next best work</span><h1>Opportunity Inbox</h1><p className="muted">Prioritized recommendations with the next action kept in view. Open evidence only when you need it.</p></div><div className="page-actions"><DataFreshnessBadge datePrefix="Signals through" sourceDate={latestSignalAt} /><Link className="btn secondary" href="/alerts?view=pursuing">View pursuing</Link>{currentUser.role === UserRole.ADMIN ? <Link className="btn secondary" href="/admin/opportunity-performance">Performance</Link> : null}</div></header>
    <nav aria-label="Opportunity filters" className="opportunity-filters">
      <Link aria-current={!type && !query.priority ? 'page' : undefined} className={!type && !query.priority ? 'active' : undefined} href="/opportunities">Best Opportunities</Link>
      <Link aria-current={query.priority?.toLowerCase() === 'high' ? 'page' : undefined} className={query.priority?.toLowerCase() === 'high' ? 'active' : undefined} href="/opportunities?priority=high">High priority</Link>
      <Link aria-current={lowestFirst ? 'page' : undefined} className={lowestFirst ? 'active' : undefined} href="/opportunities?sort=lowest">Lowest scores</Link>
      {Object.values(OpportunityType).map((value) => <Link aria-current={type === value ? 'page' : undefined} className={type === value ? 'active' : undefined} href={`/opportunities?type=${value}`} key={value}>{labels[value]}</Link>)}
    </nav>
    <p className="muted opportunity-result-count">Showing {opportunities.length.toLocaleString()} of {opportunityCount.toLocaleString()} open opportunities, {lowestFirst ? 'lowest' : 'highest'} score first.</p>
    <section className="opportunity-grid">{opportunities.map((item) => <article className="card opportunity-card" key={item.id}>
      <div className="opportunity-card-heading"><div><span className={`priority priority-${item.priorityBand.toLowerCase()}`}>{item.priorityBand}</span><small>{labels[item.type]}</small><h2><Link href={`/wholesale/${item.wholesaleAccountId}`}>{item.wholesaleAccount.name}</Link></h2><p className="muted">{item.wholesaleAccount.city}</p></div><span className="opportunity-score"><strong>{Math.round(item.productionScore)}</strong><small>score</small></span></div>
      <p className="opportunity-primary-action"><strong>Next:</strong> {item.recommendedAction}</p>
      <p className="muted opportunity-intelligence-updated">Intelligence updated {formatEasternDateTime(item.lastDetectedAt)}</p>
      {item.status === OpportunityStatus.ACTIONED ? <p className="opportunity-pursuing" role="status"><strong>Pursuing</strong>{item.actionedAt ? ` since ${formatEasternDate(item.actionedAt)}` : ''}</p> : null}
      <ContextualActions
        context={{ accountName: item.wholesaleAccount.name, opportunityId: item.id, reason: (item.explanation as string[]).join(' '), returnTo: '/opportunities', sourceLabel: item.title, sourceType: item.type, wholesaleAccountId: item.wholesaleAccountId }}
        currentUserId={currentUser.id}
        existingFollowUpId={item.worklistItems[0]?.id}
        followUpLabel="Create Follow-up"
        users={actionUsers}
      />
      <details className="opportunity-evidence compact-details nested-details">
        <summary>Why this opportunity</summary>
        <ul>{(item.explanation as string[]).map((reason) => <li key={reason}>{reason}</li>)}</ul>
      </details>
      <details className="opportunity-more-actions"><summary>More</summary><div className="opportunity-more-menu">
        <form action={updateOpportunity} className="opportunity-feedback"><input type="hidden" name="id" value={item.id}/><input aria-label="Snooze until" name="snoozedUntil" type="date"/><button name="action" value="snooze">Snooze</button></form>
        <form action={updateOpportunity} className="opportunity-dismiss"><input type="hidden" name="id" value={item.id}/><select aria-label="Dismissal reason" name="reason" defaultValue="Wrong timing">{['Not a fit','Wrong timing','Already handled','Buyer not interested','Seasonal','Bad/missing data','Other'].map((reason) => <option key={reason}>{reason}</option>)}</select><button className="danger" name="action" value="dismiss">Dismiss</button></form>
      </div></details>
    </article>)}</section>{opportunities.length === 0 ? <p className="card muted">No open opportunities match this view.</p> : null}
  </>;
}
