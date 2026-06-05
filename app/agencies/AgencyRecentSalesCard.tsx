import type { AgencySalesWindow } from '../../lib/ohlqSalesData';
import { getTenantConfig } from '../../lib/tenantConfig';

const numberFormatter = new Intl.NumberFormat('en-US');

const formatRange = (window: AgencySalesWindow) =>
  window.startDate && window.endDate ? `${window.startDate} to ${window.endDate}` : 'No loaded sales dates';

function SalesItemList({ emptyText, items }: { emptyText: string; items: AgencySalesWindow['items'] }) {
  if (items.length === 0) {
    return <p className="muted activity-empty">{emptyText}</p>;
  }

  return (
    <div className="ohlq-item-list">
      {items.map((item) => (
        <article className="ohlq-item-row" key={item.itemCode}>
          <div>
            <strong>
              {item.itemCode} - {item.itemName}
            </strong>
            <span className="muted">Most recent sale: {item.mostRecentSaleDate ?? 'Unknown'}</span>
          </div>
          <div className="ohlq-item-metrics" aria-label={`${item.itemCode} sales metrics`}>
            <span>
              <strong>{numberFormatter.format(item.totalBottlesSold)}</strong>
              <small>bottles</small>
            </span>
            <span>
              <strong>{numberFormatter.format(item.retailBottlesSold)}</strong>
              <small>retail</small>
            </span>
            <span>
              <strong>{numberFormatter.format(item.wholesaleBottlesSold)}</strong>
              <small>wholesale</small>
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}

export function AgencyRecentSalesCard({ salesWindows }: { salesWindows: AgencySalesWindow[] }) {
  const tenantConfig = getTenantConfig();
  const sevenDayWindow = salesWindows.find((window) => window.days === 7) ?? salesWindows[0];
  const thirtyDayWindow = salesWindows.find((window) => window.days === 30) ?? salesWindows[1];

  return (
    <section className="dashboard-section ohlq-sales-section">
      <div className="section-heading">
        <h2>Recent {tenantConfig.productLabel} Item Sales</h2>
        <span className="pill">{thirtyDayWindow?.endDate ? `Through ${thirtyDayWindow.endDate}` : 'No data'}</span>
      </div>

      <div className="card ohlq-window-card">
        <div className="section-heading">
          <h3>Last 7 days</h3>
          <span className="pill">{sevenDayWindow ? formatRange(sevenDayWindow) : 'No data'}</span>
        </div>
        <SalesItemList
          emptyText={`No ${tenantConfig.productPluralLabel} sales found in the last 7 days.`}
          items={sevenDayWindow?.items ?? []}
        />
      </div>

      <details className="card compact-details ohlq-window-details">
        <summary>
          Last 30 days
          <span className="pill">{thirtyDayWindow?.items.length ?? 0} items</span>
        </summary>
        <p className="muted">{thirtyDayWindow ? formatRange(thirtyDayWindow) : 'No loaded sales dates'}</p>
        <SalesItemList
          emptyText={`No ${tenantConfig.productPluralLabel} sales found in the last 30 days.`}
          items={thirtyDayWindow?.items ?? []}
        />
      </details>
    </section>
  );
}
