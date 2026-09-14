import Link from 'next/link';
import { prisma } from '../../lib/prisma';
import { formatWorklistDue } from '../../lib/dateTime';
import { getWorklistGroup } from '../../lib/worklistPresentation';
import { getWorklistLocations } from '../../lib/worklistLocations';
import { EmptyState } from './PageChrome';

export async function DashboardNextWork({ organizationId, userId, enabledFeatures }: { organizationId: string; userId: string; enabledFeatures: ReadonlySet<string> }) {
  const items = await prisma.worklistItem.findMany({
    where: {
      organizationId, assignedToUserId: userId, status: { in: ['OPEN', 'IN_PROGRESS'] },
      source: { notIn: [
        ...(!enabledFeatures.has('AGENCY_INTELLIGENCE') ? ['AGENCY_INTELLIGENCE' as const] : []),
        ...(!enabledFeatures.has('WHOLESALE_OPPORTUNITIES') ? ['OPPORTUNITY_INTELLIGENCE' as const] : []),
      ] },
    },
    include: { loggedVisit: { select: { locationType: true, agencyId: true, wholesaleAccountId: true } } },
    orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { dueTimeMinutes: 'asc' }, { createdAt: 'asc' }],
    take: 4,
  });
  const locations = await getWorklistLocations(items);
  const [next, ...rest] = items;
  return <section className="day-work" aria-labelledby="day-work-title">
    <div className="section-heading"><h2 id="day-work-title">Your next steps</h2><Link href="/alerts?owner=mine">My work →</Link></div>
    {next ? <>
      <article className="next-work-card">
        <span className="page-eyebrow">{getWorklistGroup(next)} · Assigned to you</span>
        <h2>{locations.get(next.id)?.name ?? next.title}</h2>
        {locations.has(next.id) ? <p>{next.title}</p> : null}
        <p className="muted">{formatWorklistDue(next.dueDate, next.dueTimeMinutes) || 'No date set'}</p>
        <Link className="btn" href={`/alerts?owner=mine#worklist-${next.id}`}>Open task →</Link>
      </article>
      {rest.length ? <div className="day-work-list">{rest.map((item) => <Link key={item.id} href={`/alerts?owner=mine#worklist-${item.id}`}>
        <span><strong>{item.title}</strong><small>{locations.get(item.id)?.name ?? 'General task'} · {getWorklistGroup(item)}</small></span><span aria-hidden="true">→</span>
      </Link>)}</div> : null}
    </> : <EmptyState title="No open tasks assigned to you" description="Find an account to visit or choose work from the team worklist." action={<Link className="btn secondary" href="/alerts">View team work</Link>} />}
  </section>;
}
