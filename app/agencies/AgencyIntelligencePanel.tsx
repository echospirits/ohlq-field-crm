import {
  AgencyProductOpportunityState,
  AgencyRecommendedAction,
  OpportunityStatus,
  Prisma,
} from '@prisma/client';
import Link from 'next/link';
import { formatEasternDate } from '../../lib/dateTime';
import { prisma } from '../../lib/prisma';
import { ContextualActions } from '../components/ContextualActions';
import { DataFreshnessBadge } from '../components/DataFreshnessBadge';

const titleCase = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const actionLabels: Record<AgencyRecommendedAction, string> = {
  INVESTIGATE: 'Investigate',
  MAINTAIN: 'Maintain',
  MONITOR: 'Monitor',
  NO_ACTION: 'No action',
  PURSUE_PLACEMENT: 'Seek placement',
  REDUCE_PRIORITY: 'Reduce priority',
  RESTOCK: 'Restock',
  SCHEDULE_TASTING: 'Schedule tasting',
};

const actionableStates: AgencyProductOpportunityState[] = [
  AgencyProductOpportunityState.STOCKOUT,
  AgencyProductOpportunityState.RESTOCK,
  AgencyProductOpportunityState.PLACEMENT_OPPORTUNITY,
  AgencyProductOpportunityState.ACTIVATION_OPPORTUNITY,
  AgencyProductOpportunityState.AT_RISK,
  AgencyProductOpportunityState.DEAD_INVENTORY,
];
const visibleStatuses: OpportunityStatus[] = [OpportunityStatus.OPEN, OpportunityStatus.ACTIONED];

const stringList = (value: Prisma.JsonValue) => Array.isArray(value) ? value.map(String) : [];

function IntelligenceBand({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd><span className={`priority priority-${value.toLowerCase()}`}>{titleCase(value)}</span></dd></div>;
}

export async function AgencyIntelligencePanel({ agencyId, agencyName, currentUserId, organizationId, users }: { agencyId: string; agencyName: string; currentUserId: string; organizationId: string; users: Array<{ id: string; name: string }> }) {
  const [summary, products] = await Promise.all([
    prisma.agencyIntelligenceSummary.findUnique({ where: { organizationId_agencyId: { organizationId, agencyId } } }),
    prisma.agencyProductIntelligence.findMany({
      where: { agencyId, organizationId },
      include: { worklistItems: { where: { organizationId, status: { in: ['OPEN', 'IN_PROGRESS'] } }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }], take: 1, select: { id: true } } },
      orderBy: [{ priorityScore: 'desc' }, { itemName: 'asc' }],
    }),
  ]);

  if (!summary) {
    return <section className="agency-intelligence-empty">
      <h3>Next actions</h3>
      <p>Recommendations await a complete sales, restaurant and inventory refresh.</p>
    </section>;
  }

  const activeProducts = products.filter((product) =>
    actionableStates.includes(product.opportunityState) &&
    visibleStatuses.includes(product.status),
  );
  const currentInventory = products.filter((product) => product.inventorySnapshotDate !== null);
  const focus = stringList(summary.recommendedFocus);

  return <div className="agency-intelligence-stack">
    <section className="card agency-intelligence-overview">
      <div className="section-heading agency-intelligence-heading">
        <h3>Account signals</h3>
        <DataFreshnessBadge datePrefix="As of" sourceDate={summary.asOfDate} />
      </div>
      <dl className="agency-intelligence-snapshot">
        <IntelligenceBand label="Retail" value={summary.retailBand} />
        <IntelligenceBand label="Restaurant influence" value={summary.wholesaleInfluenceBand} />
        <div><dt>Echo SKUs</dt><dd>{summary.currentSkuCount}</dd></div>
        <div><dt>Retail sales / 30d</dt><dd>{summary.retailSales30}</dd></div>
        <div><dt>Last Echo sale</dt><dd>{summary.lastEchoSaleDate ? formatEasternDate(summary.lastEchoSaleDate) : 'None'}</dd></div>
        <div><dt>D8 opportunities</dt><dd>{summary.tastingOpportunityCount}</dd></div>
      </dl>
      <div className="agency-focus-summary">
        <h3>Recommended focus</h3>
        {focus.length ? <ol>{focus.map((item) => <li key={item}>{item}</li>)}</ol> : <p className="muted">No immediate action is recommended.</p>}
      </div>
    </section>

    <section className="dashboard-section" id="product-opportunities">
      <div className="section-heading"><h3>Product opportunities</h3><Link className="btn secondary compact-btn" href={`/agency-focus?agencyId=${agencyId}`}>Open Retail Intelligence</Link></div>
      {activeProducts.length ? <div className="table-scroll" role="region" aria-label="Product opportunities" tabIndex={0}><table className="comparison-table intelligence-comparison-table account-product-opportunities">
        <thead><tr><th scope="col">Product</th><th scope="col">Next action</th><th scope="col" className="numeric">On hand / min</th><th scope="col" className="numeric">Sales · 7 / 30d</th><th scope="col">Evidence</th><th scope="col">Actions</th></tr></thead>
        <tbody>{activeProducts.slice(0, 5).map((product) => <tr key={product.id}>
          <th scope="row" data-label="Product"><strong>{product.itemName}</strong><small>Item {product.itemCode} · {titleCase(product.opportunityState)}</small></th>
          <td data-label="Next action"><strong>{actionLabels[product.recommendedAction]}</strong><span className={`priority priority-${product.priorityBand.toLowerCase()}`}>{titleCase(product.priorityBand)}</span></td>
          <td className="numeric" data-label="On hand / min"><strong>{product.onHand ?? 'Unavailable'}</strong><small>Min {product.minimum ?? 'Unavailable'}</small></td>
          <td className="numeric" data-label="Sales · 7 / 30d"><strong>{product.retailSales7} / {product.retailSales30}</strong><small>bottles</small></td>
          <td data-label="Evidence"><p className="intelligence-key-reason">{stringList(product.reasons)[0]}</p><small>Fit {product.fitScore} · {titleCase(product.fitBand)} · Peer carry {product.peerCarryPercent === null ? 'Unavailable' : `${Math.round(product.peerCarryPercent)}%`}</small>{stringList(product.reasons).length > 1 ? <details className="compact-details"><summary>More evidence ({stringList(product.reasons).length - 1})</summary><ul>{stringList(product.reasons).slice(1).map((reason) => <li key={reason}>{reason}</li>)}</ul></details> : null}</td>
          <td data-label="Actions"><ContextualActions context={{ accountName: agencyName, agencyId, agencyProductIntelligenceId: product.id, productItemCode: product.itemCode, productName: product.itemName, reason: stringList(product.reasons).join(' '), returnTo: `/agencies/${agencyId}`, sourceLabel: `${titleCase(product.opportunityState)} - ${product.itemName}`, sourceType: product.opportunityState }} currentUserId={currentUserId} existingFollowUpId={product.worklistItems[0]?.id} users={users} /></td>
        </tr>)}</tbody>
      </table></div> : <p className="muted activity-empty">No active product issues require attention.</p>}
      {activeProducts.length > 5 ? <Link className="intelligence-continuation" href={`/agency-focus?agencyId=${agencyId}`}>View all {activeProducts.length} product opportunities</Link> : null}
    </section>

    <section className="workspace-section agency-inventory-details" id="current-inventory" aria-label="Current Echo inventory">
      <div className="section-heading"><h3>Current Echo inventory</h3><span className="pill">{currentInventory.length} items</span></div>
      {currentInventory.length ? <div className="table-scroll" role="region" aria-label="Inventory comparison" tabIndex={0}><table className="comparison-table inventory-comparison-table">
        <thead><tr><th scope="col">Product</th><th scope="col" className="numeric">On hand</th><th scope="col" className="numeric">Minimum</th><th scope="col" className="numeric">Sales · 7d</th><th scope="col" className="numeric">Sales · 30d</th><th scope="col" className="numeric">Days since sale</th></tr></thead>
        <tbody>{currentInventory.map((product) => <tr key={product.id}>
          <th scope="row" data-label="Product"><strong>{product.itemName}</strong><small>{product.itemCode} · {product.inventoryStatus || titleCase(product.inventoryState)}{product.coverageGroup ? ` · ${product.coverageGroup}` : ''}</small></th>
          <td className="numeric" data-label="On hand">{product.onHand ?? 'Unavailable'}</td><td className="numeric" data-label="Minimum">{product.minimum ?? 'Unavailable'}</td>
          <td className="numeric" data-label="Sales · 7d">{product.retailSales7}</td><td className="numeric" data-label="Sales · 30d">{product.retailSales30}</td><td className="numeric" data-label="Days since sale">{product.daysSinceLastSale ?? 'Unavailable'}</td>
        </tr>)}</tbody>
      </table></div> : <p className="muted activity-empty">No current Echo inventory is recorded.</p>}
    </section>

    <section className="workspace-section agency-wholesale-influence" id="wholesale-influence">
      <div className="section-heading"><h3>Restaurant influence</h3><span className={`priority priority-${summary.wholesaleInfluenceBand.toLowerCase()}`}>{titleCase(summary.wholesaleInfluenceBand)}</span></div>
      <dl className="agency-intelligence-snapshot">
        <div><dt>Linked</dt><dd>{summary.linkedWholesaleCount}</dd></div>
        <div><dt>Active</dt><dd>{summary.activeWholesaleCount}</dd></div>
        <div><dt>Echo buyers</dt><dd>{summary.echoWholesaleBuyerCount}</dd></div>
        <div><dt>Echo bottles / 30d</dt><dd>{summary.wholesaleEchoBottles30}</dd></div>
        <div><dt>Lapsed</dt><dd>{summary.lapsedWholesaleCount}</dd></div>
        <div><dt>Open opportunities</dt><dd>{summary.openWholesaleOpportunityCount}</dd></div>
      </dl>
      {stringList(summary.wholesaleReasons).length ? <details className="compact-details"><summary>Influence evidence</summary><ul className="agency-product-reasons">{stringList(summary.wholesaleReasons).map((reason) => <li key={reason}>{reason}</li>)}</ul></details> : null}
    </section>
  </div>;
}
