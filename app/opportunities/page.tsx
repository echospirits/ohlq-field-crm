export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { OpportunityEventType, OpportunityStatus, OpportunityType, UserRole } from '@prisma/client';
import Link from 'next/link';
import { getUserDisplayName, requireUser } from '../../lib/auth';
import { formatEasternDate } from '../../lib/dateTime';
import { prisma } from '../../lib/prisma';
import { updateOpportunity } from './actions';

const labels: Record<OpportunityType, string> = { LAPSED_BUYER: 'Reactivation', FIRST_ORDER_FOLLOW_UP: 'First Reorder', CATEGORY_CONQUEST: 'Category Opportunity', CROSS_SELL: 'Cross-Sell', NO_RECENT_TOUCH: 'Needs Attention' };

export default async function OpportunityInbox({ searchParams }: { searchParams?: Promise<{ type?: string; priority?: string }> }) {
  const currentUser = await requireUser(); const query = (await searchParams) ?? {};
  const type = Object.values(OpportunityType).includes(query.type as OpportunityType) ? query.type as OpportunityType : undefined;
  const [opportunities, assignees] = await Promise.all([
    prisma.salesOpportunity.findMany({
      where: { status: OpportunityStatus.OPEN, ...(type ? { type } : {}), ...(query.priority ? { priorityBand: query.priority.toUpperCase() } : {}) },
      include: { wholesaleAccount: { select: { name: true, city: true } }, worklistItems: { where: { status: { in: ['OPEN', 'IN_PROGRESS'] } }, select: { id: true } } },
      orderBy: [{ productionScore: 'desc' }, { detectedAt: 'desc' }], take: 250,
    }),
    currentUser.role === UserRole.ADMIN
      ? prisma.user.findMany({ where: { isActive: true, role: { not: UserRole.TASTER } }, orderBy: [{ name: 'asc' }, { email: 'asc' }] })
      : Promise.resolve([]),
  ]);
  const activeAssigneeIds = new Set(assignees.map((assignee) => assignee.id));
  await prisma.opportunityEvent.createMany({ skipDuplicates: true, data: opportunities.map((item) => ({ opportunityId: item.id, eventType: OpportunityEventType.SHOWN, eventKey: 'SHOWN:INBOX', wholesaleAccountId: item.wholesaleAccountId, occurredAt: new Date() })) });
  return <>
    <header className="page-heading page-header"><div><span className="page-eyebrow">Next best work</span><h1>Opportunity Inbox</h1><p className="muted">Prioritized recommendations with the evidence behind each one.</p></div><div className="page-actions"><Link className="btn secondary" href="/alerts?view=pursuing">View pursuing</Link>{currentUser.role === UserRole.ADMIN ? <Link className="btn secondary" href="/admin/opportunity-performance">Performance</Link> : null}</div></header>
    <nav className="opportunity-filters"><Link href="/opportunities">Best Opportunities</Link>{Object.values(OpportunityType).map((value) => <Link href={`/opportunities?type=${value}`} key={value}>{labels[value]}</Link>)}</nav>
    <section className="opportunity-grid">{opportunities.map((item) => <article className="card opportunity-card" key={item.id}>
      <div className="opportunity-card-heading"><div><span className={`priority priority-${item.priorityBand.toLowerCase()}`}>{item.priorityBand}</span><small>{labels[item.type]}</small><h2><Link href={`/wholesale/${item.wholesaleAccountId}`}>{item.wholesaleAccount.name}</Link></h2><p className="muted">{item.wholesaleAccount.city}</p></div><strong className="opportunity-score">{Math.round(item.productionScore)}</strong></div>
      <ul>{(item.explanation as string[]).map((reason) => <li key={reason}>{reason}</li>)}</ul><p><strong>Next:</strong> {item.recommendedAction}</p>
      {item.status === OpportunityStatus.ACTIONED ? <p className="opportunity-pursuing" role="status"><strong>Pursuing</strong>{item.actionedAt ? ` since ${formatEasternDate(item.actionedAt)}` : ''}</p> : null}
      <div className="opportunity-actions"><form action={updateOpportunity}><input type="hidden" name="id" value={item.id}/>{currentUser.role === UserRole.ADMIN && item.status !== OpportunityStatus.ACTIONED ? <select aria-label="Assign pursuit to" name="assignedToUserId" defaultValue={item.assignedToUserId && activeAssigneeIds.has(item.assignedToUserId) ? item.assignedToUserId : currentUser.id} required>{assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{getUserDisplayName(assignee)}</option>)}</select> : null}<button name="action" value="pursue" disabled={item.status === OpportunityStatus.ACTIONED}>{item.status === OpportunityStatus.ACTIONED ? 'Pursuing' : 'Pursue'}</button><button className="secondary" name="action" value="worklist" disabled={item.worklistItems.length > 0}>{item.worklistItems.length ? 'On worklist' : 'Add to worklist'}</button></form><Link className="btn secondary compact-btn" href={`/visits/new?type=wholesale&wholesaleAccountId=${item.wholesaleAccountId}`}>Log visit</Link></div>
      <form action={updateOpportunity} className="opportunity-dismiss"><input type="hidden" name="id" value={item.id}/><select aria-label="Dismissal reason" name="reason" defaultValue="Wrong timing">{['Not a fit','Wrong timing','Already handled','Buyer not interested','Seasonal','Bad/missing data','Other'].map((reason) => <option key={reason}>{reason}</option>)}</select><button className="danger" name="action" value="dismiss">Dismiss</button></form>
      <details><summary>Snooze</summary><form action={updateOpportunity} className="opportunity-feedback"><input type="hidden" name="id" value={item.id}/><input aria-label="Snooze until" name="snoozedUntil" type="date"/><button name="action" value="snooze">Snooze</button></form></details>
    </article>)}</section>{opportunities.length === 0 ? <p className="card muted">No open opportunities match this view.</p> : null}
  </>;
}
