import type { AgencySalesSummaryItem, AgencySalesWindow } from '../../lib/ohlqSalesData';
import { getTenantConfig } from '../../lib/tenantConfig';

const numberFormatter = new Intl.NumberFormat('en-US');

function SalesWindowSummary({ items }: { items: AgencySalesWindow['items'] }) {
  const totalBottles = items.reduce((total, item) => total + item.totalBottlesSold, 0);

  return <div className="ohlq-purchase-summary" aria-label="Sales window summary">
    <span><strong>{numberFormatter.format(items.length)}</strong><small>items</small></span>
    <span><strong>{numberFormatter.format(totalBottles)}</strong><small>bottles</small></span>
  </div>;
}

type CombinedSalesItem = {
  itemCode: string;
  itemName: string;
  mostRecentSaleDate: string | null;
  sevenDay: AgencySalesSummaryItem | null;
  thirtyDay: AgencySalesSummaryItem | null;
};

function combineSalesItems(
  sevenDayItems: AgencySalesWindow['items'],
  thirtyDayItems: AgencySalesWindow['items'],
) {
  const itemsByCode = new Map<string, CombinedSalesItem>();

  thirtyDayItems.forEach((item) => {
    itemsByCode.set(item.itemCode, {
      itemCode: item.itemCode,
      itemName: item.itemName,
      mostRecentSaleDate: item.mostRecentSaleDate,
      sevenDay: null,
      thirtyDay: item,
    });
  });

  sevenDayItems.forEach((item) => {
    const existing = itemsByCode.get(item.itemCode);
    itemsByCode.set(item.itemCode, {
      itemCode: item.itemCode,
      itemName: item.itemName,
      mostRecentSaleDate: item.mostRecentSaleDate ?? existing?.mostRecentSaleDate ?? null,
      sevenDay: item,
      thirtyDay: existing?.thirtyDay ?? null,
    });
  });

  return Array.from(itemsByCode.values()).sort(
    (left, right) =>
      (right.thirtyDay?.totalBottlesSold ?? 0) - (left.thirtyDay?.totalBottlesSold ?? 0) ||
      (right.sevenDay?.totalBottlesSold ?? 0) - (left.sevenDay?.totalBottlesSold ?? 0) ||
      left.itemCode.localeCompare(right.itemCode),
  );
}

function SalesMetrics({ item, label }: { item: AgencySalesSummaryItem | null; label: string }) {
  return (
    <div className="ohlq-item-window-metrics" aria-label={`${label} sales`}>
      <strong className="ohlq-item-window-label">{label}</strong>
      <span>
        <strong>{numberFormatter.format(item?.totalBottlesSold ?? 0)}</strong>
        <small>total</small>
      </span>
      <span>
        <strong>{numberFormatter.format(item?.retailBottlesSold ?? 0)}</strong>
        <small>retail</small>
      </span>
      <span>
        <strong>{numberFormatter.format(item?.wholesaleBottlesSold ?? 0)}</strong>
        <small>wholesale</small>
      </span>
    </div>
  );
}

function SalesItemList({ emptyText, items }: { emptyText: string; items: CombinedSalesItem[] }) {
  if (items.length === 0) {
    return <p className="muted activity-empty">{emptyText}</p>;
  }

  return (
    <div className="ohlq-item-list">
      {items.map((item) => (
        <article className="ohlq-item-row" key={item.itemCode}>
          <div className="ohlq-item-identity">
            <div><span className="ohlq-item-code">{item.itemCode}</span><strong>{item.itemName}</strong></div>
            <span className="muted">Latest sale {item.mostRecentSaleDate ?? 'unknown'}</span>
          </div>
          <div className="ohlq-item-metrics" aria-label={`${item.itemCode} sales metrics`}>
            <SalesMetrics item={item.sevenDay} label="7 days" />
            <SalesMetrics item={item.thirtyDay} label="30 days" />
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
  const combinedItems = combineSalesItems(sevenDayWindow?.items ?? [], thirtyDayWindow?.items ?? []);

  return (
    <section className="dashboard-section ohlq-sales-section">
      <div className="section-heading ohlq-sales-heading">
        <h2>Recent {tenantConfig.productLabel} Item Sales</h2>
        <span className="pill">{thirtyDayWindow?.endDate ? `Through ${thirtyDayWindow.endDate}` : 'No data'}</span>
      </div>

      <div className="card ohlq-window-card">
        <div className="section-heading ohlq-window-heading">
          <h3>7 and 30 day sales</h3>
          <div className="ohlq-combined-sales-summary">
            <div><strong>7 days</strong><SalesWindowSummary items={sevenDayWindow?.items ?? []} /></div>
            <div><strong>30 days</strong><SalesWindowSummary items={thirtyDayWindow?.items ?? []} /></div>
          </div>
        </div>
        <SalesItemList
          emptyText={`No ${tenantConfig.productPluralLabel} sales found in the last 30 days.`}
          items={combinedItems}
        />
      </div>
    </section>
  );
}
