import { AgencyProductOpportunityState, OpportunityStatus } from '@prisma/client';
import Link from 'next/link';
import { prisma } from '../../lib/prisma';

const tiles = [
  ['Agency stockouts', AgencyProductOpportunityState.STOCKOUT, 'High-demand products at zero inventory'],
  ['Placement opportunities', AgencyProductOpportunityState.PLACEMENT_OPPORTUNITY, 'High-fit products not currently carried'],
  ['Tasting opportunities', AgencyProductOpportunityState.ACTIVATION_OPPORTUNITY, 'D8 stores with inventory and activation potential'],
  ['Dead inventory', AgencyProductOpportunityState.DEAD_INVENTORY, 'Inventory without acceptable sell-through'],
] as const;

export async function DashboardAgencyIntelligence() {
  const [counts, agenciesNeedingAttention] = await Promise.all([
    Promise.all(tiles.map(([, state]) => prisma.agencyProductIntelligence.count({ where: { status: OpportunityStatus.OPEN, opportunityState: state } }))),
    prisma.agencyIntelligenceSummary.count({ where: { OR: [
      { openProductOpportunityCount: { gt: 0 } },
      { openWholesaleOpportunityCount: { gt: 0 } },
      { lapsedWholesaleCount: { gt: 0 } },
    ] } }),
  ]);
  return <section className="dashboard-section">
    <div className="section-heading"><div><span className="page-eyebrow">Agency intelligence</span><h2>Retail actions needing attention</h2></div><Link className="btn secondary compact-btn" href="/agency-focus">Open Agency Focus</Link></div>
    <div className="agency-dashboard-grid">
      {tiles.map(([label, state, detail], index) => <Link className="card agency-dashboard-tile" href={`/agency-focus?state=${state}`} key={state}><span>{label}</span><strong>{counts[index]}</strong><small>{detail}</small></Link>)}
      <Link className="card agency-dashboard-tile" href="/agency-focus"><span>Agencies needing attention</span><strong>{agenciesNeedingAttention}</strong><small>Retail or connected wholesale action is available</small></Link>
    </div>
  </section>;
}
