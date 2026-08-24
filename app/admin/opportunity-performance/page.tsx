export const dynamic = 'force-dynamic';

import { OpportunityStatus, OpportunityType } from '@prisma/client';
import { buildPageMetadata } from '../../../lib/appBrand';
import { requireAdmin } from '../../../lib/auth';
import { analyzeActivityToPurchases } from '../../../lib/opportunityIntelligence';
import { prisma } from '../../../lib/prisma';
import { requireFeatureForUser } from '../../../lib/organizations';

export const metadata = buildPageMetadata('Opportunity Performance');

export default async function OpportunityPerformancePage() {
  const user = await requireAdmin();
  const { organizationId } = await requireFeatureForUser(user, 'WHOLESALE_OPPORTUNITIES');
  const [opportunities, visits, followUps, purchases] = await Promise.all([
    prisma.salesOpportunity.findMany({ where: { organizationId }, select: { type: true, status: true, detectedAt: true, convertedAt: true, actionedAt: true } }),
    prisma.loggedVisit.findMany({ where: { organizationId, locationType: 'wholesale', wholesaleAccountId: { not: null } }, select: { wholesaleAccountId: true, visitAt: true } }),
    prisma.worklistItem.findMany({ where: { organizationId, wholesaleAccountId: { not: null }, completedAt: { not: null } }, select: { wholesaleAccountId: true, completedAt: true } }),
    prisma.accountSalesEvent.findMany({ where: { organizationId, isTenantProduct: true }, select: { wholesaleAccountId: true, reportDate: true } }),
  ]);
  const purchaseMap = new Map<string, Date[]>(); purchases.forEach((p) => purchaseMap.set(p.wholesaleAccountId, [...(purchaseMap.get(p.wholesaleAccountId) ?? []), p.reportDate]));
  const relationship = (activities: Array<{ wholesaleAccountId: string | null; at: Date | null }>) => activities.flatMap((a) => a.wholesaleAccountId && a.at ? [analyzeActivityToPurchases(a.at, purchaseMap.get(a.wholesaleAccountId) ?? [])] : []);
  const visitResults = relationship(visits.map((v) => ({ wholesaleAccountId: v.wholesaleAccountId, at: v.visitAt })));
  const followUpResults = relationship(followUps.map((w) => ({ wholesaleAccountId: w.wholesaleAccountId, at: w.completedAt })));
  return <><header className="page-heading"><span className="page-eyebrow">Learning</span><h1>Opportunity performance</h1><p className="muted">Observed relationships, not claims that CRM activity caused a purchase.</p></header>
    <div className="card table-wrap"><table><thead><tr><th>Type</th><th>Detected</th><th>Actioned</th><th>Dismissed</th><th>Snoozed</th><th>Converted</th><th>Conversion rate</th><th>Actioned conversion</th><th>Unactioned conversion</th><th>Avg. days</th></tr></thead><tbody>{Object.values(OpportunityType).map((type) => { const rows = opportunities.filter((o) => o.type === type); const converted = rows.filter((o) => o.status === OpportunityStatus.CONVERTED); const actioned = rows.filter((o) => o.actionedAt); const actionedConverted = actioned.filter((o) => o.status === OpportunityStatus.CONVERTED).length; const unactioned = rows.filter((o) => !o.actionedAt); const days = converted.flatMap((o) => o.convertedAt ? [(o.convertedAt.getTime() - o.detectedAt.getTime()) / 86400000] : []); return <tr key={type}><td>{type.replaceAll('_',' ')}</td><td>{rows.length}</td><td>{actioned.length}</td><td>{rows.filter((o) => o.status === OpportunityStatus.DISMISSED).length}</td><td>{rows.filter((o) => o.status === OpportunityStatus.SNOOZED).length}</td><td>{converted.length}</td><td>{rows.length ? `${Math.round(converted.length / rows.length * 100)}%` : '—'}</td><td>{actioned.length ? `${Math.round(actionedConverted / actioned.length * 100)}%` : '—'}</td><td>{unactioned.length ? `${Math.round(unactioned.filter((o) => o.status === OpportunityStatus.CONVERTED).length / unactioned.length * 100)}%` : '—'}</td><td>{days.length ? (days.reduce((a,b) => a+b,0)/days.length).toFixed(1) : '—'}</td></tr>; })}</tbody></table></div>
    <div className="grid"><RelationshipCard title="Visits followed by an Echo purchase" results={visitResults}/><RelationshipCard title="Completed follow-ups followed by an Echo purchase" results={followUpResults}/></div></>;
}

function RelationshipCard({ title, results }: { title: string; results: ReturnType<typeof analyzeActivityToPurchases>[] }) { const average = results.flatMap((r) => r.daysToNextPurchase === null ? [] : [r.daysToNextPurchase]); return <section className="card"><h2>{title}</h2><div className="metric-splits"><span>Within 7 days <strong>{results.filter((r) => r.purchaseWithin7Days).length}</strong></span><span>Within 14 days <strong>{results.filter((r) => r.purchaseWithin14Days).length}</strong></span><span>Within 30 days <strong>{results.filter((r) => r.purchaseWithin30Days).length}</strong></span><span>First orders <strong>{results.filter((r) => r.firstPurchaseAfterActivity).length}</strong></span><span>Reorders <strong>{results.filter((r) => r.reorderAfterActivity).length}</strong></span><span>Average days <strong>{average.length ? (average.reduce((a,b) => a+b,0)/average.length).toFixed(1) : '—'}</strong></span></div></section>; }
