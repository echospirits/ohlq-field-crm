import { OpportunityStatus, Prisma } from '@prisma/client';
import Link from 'next/link';
import { formatEasternDate } from '../../lib/dateTime';
import { prisma } from '../../lib/prisma';

const activeStatuses = [OpportunityStatus.OPEN, OpportunityStatus.ACTIONED, OpportunityStatus.SNOOZED];

const firstExplanation = (explanation: Prisma.JsonValue) =>
  Array.isArray(explanation) && explanation.length > 0 ? String(explanation[0]) : 'Review the current account signals.';

export async function OpportunityAccountPanel({ agencyId, wholesaleAccountId }: { agencyId?: string; wholesaleAccountId?: string }) {
  const isAgencyRollup = Boolean(agencyId && !wholesaleAccountId);
  const opportunityWhere: Prisma.SalesOpportunityWhereInput = wholesaleAccountId
    ? { wholesaleAccountId, status: { in: activeStatuses } }
    : { status: { in: activeStatuses }, wholesaleAccount: { agencyId: { equals: agencyId, mode: 'insensitive' } } };
  if (isAgencyRollup) {
    const [opportunities, linkedAccountCount, openFollowUps] = await Promise.all([
      prisma.salesOpportunity.findMany({
        where: opportunityWhere,
        include: { wholesaleAccount: { select: { id: true, name: true } } },
        orderBy: [{ productionScore: 'desc' }, { lastDetectedAt: 'desc' }],
        take: 12,
      }),
      prisma.wholesaleAccount.count({ where: { agencyId: { equals: agencyId, mode: 'insensitive' }, isActive: true, mergedIntoId: null } }),
      prisma.worklistItem.count({
        where: {
          status: { in: ['OPEN', 'IN_PROGRESS'] },
          salesOpportunity: {
            is: {
              status: { in: activeStatuses },
              wholesaleAccount: { agencyId: { equals: agencyId, mode: 'insensitive' } },
            },
          },
        },
      }),
    ]);
    const pursuing = opportunities.filter((item) => item.status === OpportunityStatus.ACTIONED).length;
    const highPriority = opportunities.filter((item) => item.priorityBand === 'HIGH').length;

    return <section className="card account-opportunity-panel">
      <div className="section-heading"><div><span className="page-eyebrow">Linked wholesale opportunity rollup</span><h2>Opportunity intelligence</h2></div><Link className="btn secondary compact-btn" href="/opportunities">Open inbox</Link></div>
      <div className="account-intelligence-facts"><span><strong>{opportunities.length}</strong> active opportunities</span><span><strong>{highPriority}</strong> high priority</span><span><strong>{pursuing}</strong> being pursued</span><span><strong>{openFollowUps}</strong> opportunity follow-ups</span><span><strong>{linkedAccountCount}</strong> linked wholesale accounts</span></div>
      {opportunities.slice(0, 5).map((item) => <div className="account-opportunity-row" key={item.id}><span className={`priority priority-${item.priorityBand.toLowerCase()}`}>{item.priorityBand}</span><div><strong><Link href={`/wholesale/${item.wholesaleAccountId}`}>{item.wholesaleAccount.name}</Link>: {item.title}</strong><p>{firstExplanation(item.explanation)}</p><small>Next: {item.recommendedAction}</small></div></div>)}
      {opportunities.length === 0 ? <p className="muted activity-empty">No active Opportunities are linked to this agency’s wholesale accounts.</p> : null}
    </section>;
  }

  if (!wholesaleAccountId) return null;

  const [opportunities, sales, visits, worklist] = await Promise.all([
    prisma.salesOpportunity.findMany({
      where: opportunityWhere,
      include: { wholesaleAccount: { select: { id: true, name: true } } },
      orderBy: [{ productionScore: 'desc' }, { lastDetectedAt: 'desc' }],
      take: 5,
    }),
    prisma.accountSalesEvent.findMany({ where: { wholesaleAccountId }, orderBy: { reportDate: 'desc' }, take: 30 }),
    prisma.loggedVisit.findMany({ where: { wholesaleAccountId, locationType: 'wholesale' }, orderBy: { visitAt: 'desc' }, take: 20, select: { id: true, visitAt: true, summary: true, createdBy: true } }),
    prisma.worklistItem.findMany({ where: { wholesaleAccountId, status: { in: ['OPEN', 'IN_PROGRESS'] } }, orderBy: { dueDate: 'asc' }, take: 10, select: { id: true, title: true, dueDate: true } }),
  ]);
  const timeline = [
    ...sales.map((event) => ({ at: event.reportDate, kind: 'purchase', title: `${event.itemCode} - ${event.itemName}`, detail: `${event.bottles} bottle${event.bottles === 1 ? '' : 's'} purchased` })),
    ...visits.map((visit) => ({ at: visit.visitAt, kind: 'visit', title: `${visit.createdBy ?? 'Team member'} visited`, detail: visit.summary ?? 'CRM visit logged' })),
    ...opportunities.map((item) => ({ at: item.detectedAt, kind: 'opportunity', title: `${item.title} detected`, detail: item.recommendedAction })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 40);
  const echo90 = sales.filter((event) => event.isTenantProduct && event.reportDate >= new Date(Date.now() - 90 * 86_400_000)).reduce((sum, event) => sum + event.bottles, 0);
  return <>
    <section className="card account-opportunity-panel"><div className="section-heading"><div><span className="page-eyebrow">Why care right now?</span><h2>Opportunity intelligence</h2></div><Link className="btn secondary compact-btn" href="/opportunities">Inbox</Link></div>
      <div className="account-intelligence-facts"><span><strong>{opportunities.length}</strong> active opportunities</span><span><strong>{echo90}</strong> Echo bottles / 90 days</span><span><strong>{visits[0] ? formatEasternDate(visits[0].visitAt) : 'Never'}</strong> last visit</span><span><strong>{worklist.length}</strong> open follow-ups</span></div>
      {opportunities.slice(0, 3).map((item) => <div className="account-opportunity-row" key={item.id}><span className={`priority priority-${item.priorityBand.toLowerCase()}`}>{item.priorityBand}</span><div><strong>{item.title}</strong><p>{firstExplanation(item.explanation)}</p><small>Next: {item.recommendedAction}</small></div></div>)}
      {opportunities.length === 0 ? <p className="muted activity-empty">No active Opportunities for this account.</p> : null}
    </section>
    <section className="dashboard-section unified-timeline"><div className="section-heading"><h2>CRM + sales timeline</h2><span className="pill">{timeline.length}</span></div>{timeline.map((event, index) => <article className={`timeline-event timeline-${event.kind}`} key={`${event.kind}-${event.at.toISOString()}-${index}`}><time>{formatEasternDate(event.at)}</time><div><strong>{event.title}</strong><p>{event.detail}</p></div></article>)}</section>
  </>;
}
