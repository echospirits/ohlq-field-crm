import {
  AgencyProductOpportunityState,
  AgencyRecommendedAction,
  OpportunityStatus,
  Prisma,
} from '@prisma/client';
import Link from 'next/link';
import { formatEasternDate } from '../../lib/dateTime';
import { prisma } from '../../lib/prisma';

const titleCase = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const actionLabels: Record<AgencyRecommendedAction, string> = {
  INVESTIGATE: 'Investigate',
  MAINTAIN: 'Maintain',
  MONITOR: 'Monitor',
  NO_ACTION: 'No action',
  PURSUE_PLACEMENT: 'Pursue placement',
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

export async function AgencyIntelligencePanel({ agencyId }: { agencyId: string }) {
  const [summary, products] = await Promise.all([
    prisma.agencyIntelligenceSummary.findUnique({ where: { agencyId } }),
    prisma.agencyProductIntelligence.findMany({
      where: { agencyId },
      orderBy: [{ priorityScore: 'desc' }, { itemName: 'asc' }],
    }),
  ]);

  if (!summary) {
    return <section className="card agency-intelligence-empty" id="intelligence">
      <span className="page-eyebrow">Agency intelligence</span>
      <h2>Decision support is waiting for the next complete OHLQ data run</h2>
      <p className="muted">The engine only publishes recommendations after sales, wholesale, and inventory inputs all complete successfully.</p>
    </section>;
  }

  const activeProducts = products.filter((product) =>
    actionableStates.includes(product.opportunityState) &&
    visibleStatuses.includes(product.status),
  );
  const currentInventory = products.filter((product) => product.inventorySnapshotDate !== null);
  const focus = stringList(summary.recommendedFocus);

  return <div className="agency-intelligence-stack" id="intelligence">
    <section className="card agency-intelligence-overview">
      <div className="section-heading agency-intelligence-heading">
        <div><span className="page-eyebrow">Agency opportunity</span><h2>What to do here next</h2></div>
        <span className="pill">As of {formatEasternDate(summary.asOfDate)}</span>
      </div>
      <dl className="agency-intelligence-snapshot">
        <IntelligenceBand label="Retail" value={summary.retailBand} />
        <IntelligenceBand label="Wholesale influence" value={summary.wholesaleInfluenceBand} />
        <div><dt>Echo SKUs</dt><dd>{summary.currentSkuCount}</dd></div>
        <div><dt>Agency sales / 30d</dt><dd>{summary.retailSales30}</dd></div>
        <div><dt>Last Echo sale</dt><dd>{summary.lastEchoSaleDate ? formatEasternDate(summary.lastEchoSaleDate) : 'None'}</dd></div>
        <div><dt>D8 opportunities</dt><dd>{summary.tastingOpportunityCount}</dd></div>
      </dl>
      <div className="agency-focus-summary">
        <h3>Recommended focus</h3>
        {focus.length ? <ol>{focus.map((item) => <li key={item}>{item}</li>)}</ol> : <p className="muted">No immediate action is recommended.</p>}
      </div>
    </section>

    <section className="dashboard-section" id="product-opportunities">
      <div className="section-heading"><div><span className="page-eyebrow">Agency × product</span><h2>Product opportunities</h2></div><Link className="btn secondary compact-btn" href={`/agency-focus?agencyId=${agencyId}`}>Open focus view</Link></div>
      <div className="agency-product-list">
        {activeProducts.slice(0, 5).map((product) => <details className="card agency-product-card" key={product.id}>
          <summary>
            <span className="agency-product-title"><span className="ohlq-item-code">{product.itemCode}</span><strong>{product.itemName}</strong><small>{titleCase(product.opportunityState)}</small></span>
            <span className={`priority priority-${product.priorityBand.toLowerCase()}`}>{product.priorityBand}</span>
          </summary>
          <div className="agency-product-body">
            <dl className="agency-product-metrics">
              <div><dt>On hand</dt><dd>{product.onHand ?? '—'}</dd></div>
              <div><dt>Minimum</dt><dd>{product.minimum ?? '—'}</dd></div>
              <div><dt>Sales / 7d</dt><dd>{product.retailSales7}</dd></div>
              <div><dt>Sales / 30d</dt><dd>{product.retailSales30}</dd></div>
              <div><dt>Fit</dt><dd>{titleCase(product.fitBand)} · {product.fitScore}</dd></div>
              <div><dt>Peer carry</dt><dd>{product.peerCarryPercent === null ? '—' : `${Math.round(product.peerCarryPercent)}%`}</dd></div>
            </dl>
            <p className="agency-product-action"><strong>Next:</strong> {actionLabels[product.recommendedAction]}</p>
            <ul className="agency-product-reasons">{stringList(product.reasons).map((reason) => <li key={reason}>{reason}</li>)}</ul>
          </div>
        </details>)}
        {activeProducts.length === 0 ? <p className="card muted activity-empty">No active product issues require attention.</p> : null}
      </div>
    </section>

    <details className="card compact-details agency-inventory-details" id="current-inventory" open>
      <summary><span><strong>Current Echo inventory</strong><small>What is actually in this store now</small></span><span className="pill">{currentInventory.length} items</span></summary>
      <div className="agency-current-inventory-list">
        {currentInventory.map((product) => <article className="agency-current-inventory-row" key={product.id}>
          <div className="ohlq-item-identity"><div><span className="ohlq-item-code">{product.itemCode}</span><strong>{product.itemName}</strong></div><span className="muted">{product.inventoryStatus || titleCase(product.inventoryState)}{product.coverageGroup ? ` · ${product.coverageGroup}` : ''}</span></div>
          <div className="agency-inventory-metrics">
            <span><strong>{product.onHand ?? '—'}</strong><small>on hand</small></span>
            <span><strong>{product.minimum ?? '—'}</strong><small>minimum</small></span>
            <span><strong>{product.retailSales7}</strong><small>7d sales</small></span>
            <span><strong>{product.retailSales30}</strong><small>30d sales</small></span>
            <span><strong>{product.daysSinceLastSale ?? '—'}</strong><small>days since sale</small></span>
          </div>
        </article>)}
        {currentInventory.length === 0 ? <p className="muted activity-empty">No current Echo inventory is recorded.</p> : null}
      </div>
    </details>

    <section className="card agency-wholesale-influence" id="wholesale-influence">
      <div className="section-heading"><div><span className="page-eyebrow">Connected business</span><h2>Wholesale influence</h2></div><span className={`priority priority-${summary.wholesaleInfluenceBand.toLowerCase()}`}>{titleCase(summary.wholesaleInfluenceBand)}</span></div>
      <dl className="agency-intelligence-snapshot">
        <div><dt>Linked</dt><dd>{summary.linkedWholesaleCount}</dd></div>
        <div><dt>Active</dt><dd>{summary.activeWholesaleCount}</dd></div>
        <div><dt>Echo buyers</dt><dd>{summary.echoWholesaleBuyerCount}</dd></div>
        <div><dt>Echo bottles / 30d</dt><dd>{summary.wholesaleEchoBottles30}</dd></div>
        <div><dt>Lapsed</dt><dd>{summary.lapsedWholesaleCount}</dd></div>
        <div><dt>Open opportunities</dt><dd>{summary.openWholesaleOpportunityCount}</dd></div>
      </dl>
      <ul className="agency-product-reasons">{stringList(summary.wholesaleReasons).map((reason) => <li key={reason}>{reason}</li>)}</ul>
    </section>
  </div>;
}
