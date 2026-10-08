import Link from 'next/link';
import { prisma } from '../../lib/prisma';
import { evidenceModeLabel } from '../../lib/wholesaleAssessment';
export async function DashboardOpportunitySummary({ organizationId }: { organizationId: string }) {
  const modes = Object.entries(evidenceModeLabel);
  const counts = await Promise.all(modes.map(([mode]) => prisma.wholesaleAccountAssessment.count({ where: { organizationId, evidenceMode: mode, priorityBand: 'HIGH', state: 'READY', wholesaleAccount: { mergedIntoId: null } } })));
  return <section className="dashboard-section"><div className="section-heading"><h2>Where to spend time next</h2><Link href="/opportunities">Open intelligence</Link></div><div className="opportunity-summary-grid">{modes.map(([mode,label],i) => <Link className="card metric-card" key={mode} href={`/opportunities?mode=${mode}&priority=high`}><h3>{label}</h3><p className="metric-value">{counts[i]}</p><small>High account priority</small></Link>)}</div></section>;
}
