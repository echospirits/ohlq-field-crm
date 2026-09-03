import { OpportunityStatus, OpportunityType } from '@prisma/client';
import Link from 'next/link';
import { prisma } from '../../lib/prisma';

const cards = [
  ['High Priority', null, 'priority=high'],
  ['Reactivation', OpportunityType.LAPSED_BUYER, `type=${OpportunityType.LAPSED_BUYER}`],
  ['First Reorder', OpportunityType.FIRST_ORDER_FOLLOW_UP, `type=${OpportunityType.FIRST_ORDER_FOLLOW_UP}`],
  ['Category Opportunities', OpportunityType.CATEGORY_CONQUEST, `type=${OpportunityType.CATEGORY_CONQUEST}`],
  ['Needs Attention', OpportunityType.NO_RECENT_TOUCH, `type=${OpportunityType.NO_RECENT_TOUCH}`],
] as const;

export async function DashboardOpportunitySummary({ organizationId }: { organizationId: string }) {
  const counts = await Promise.all(cards.map(([, type]) => prisma.salesOpportunity.count({ where: { organizationId, status: OpportunityStatus.OPEN, ...(type ? { type } : { priorityBand: 'HIGH' }) } })));
  return <section className="dashboard-section"><div className="section-heading"><div><span className="page-eyebrow">Opportunity intelligence</span><h2>Where to spend time next</h2></div><Link className="btn secondary compact-btn" href="/opportunities">Open inbox</Link></div><div className="opportunity-summary-grid">{cards.map(([label,, query], index) => <Link className="card metric-card" href={`/opportunities?${query}`} key={label}><h3>{label}</h3><p className="metric-value">{counts[index]}</p></Link>)}</div></section>;
}
