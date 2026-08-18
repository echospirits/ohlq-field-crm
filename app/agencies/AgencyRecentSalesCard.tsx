import type { AgencySalesSummaryItem, AgencySalesWindow } from '../../lib/ohlqSalesData';
import { getTenantConfig } from '../../lib/tenantConfig';

const numberFormatter = new Intl.NumberFormat('en-US');

function SalesWindowSummary({
  className,
  items,
  label,
}: {
  className: string;
  items: AgencySalesWindow['items'];
  label: string;
}) {
  const totalBottles = items.reduce((total, item) => total + item.totalBottlesSold, 0);

  return <div className={`ohlq-window-summary-group ${className}`} aria-label={`${label} sales summary`}>
    <strong>{label}</strong>
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

function SalesItemList({ emptyText, items }: { emptyText: string; items: CombinedSalesItem[] }) {
  if (items.length === 0) {
    return <p className="muted activity-empty">{emptyText}</p>;
  }

  return (
    <div className="table-wrap ohlq-sales-table-wrap">
      <table className="ohlq-sales-table">
        <colgroup>
          <col className="ohlq-sales-item-column" />
          <col className="ohlq-sales-date-column" />
          <col span={6} className="ohlq-sales-number-column" />
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={2} scope="col">Item</th>
            <th rowSpan={2} scope="col">Latest sale</th>
            <th className="ohlq-sales-window-heading" colSpan={3} scope="colgroup">7 days</th>
            <th className="ohlq-sales-window-heading window-start" colSpan={3} scope="colgroup">30 days</th>
          </tr>
          <tr>
            <th scope="col">Total</th>
            <th scope="col">Retail</th>
            <th scope="col">Wholesale</th>
            <th className="window-start" scope="col">Total</th>
            <th scope="col">Retail</th>
            <th scope="col">Wholesale</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.itemCode}>
              <th className="ohlq-sales-item" scope="row">
                <span className="ohlq-item-code">{item.itemCode}</span>
                <strong>{item.itemName}</strong>
              </th>
              <td className="ohlq-sales-date">{item.mostRecentSaleDate ?? 'Unknown'}</td>
              <td className="numeric">{numberFormatter.format(item.sevenDay?.totalBottlesSold ?? 0)}</td>
              <td className="numeric">{numberFormatter.format(item.sevenDay?.retailBottlesSold ?? 0)}</td>
              <td className="numeric">{numberFormatter.format(item.sevenDay?.wholesaleBottlesSold ?? 0)}</td>
              <td className="numeric window-start">{numberFormatter.format(item.thirtyDay?.totalBottlesSold ?? 0)}</td>
              <td className="numeric">{numberFormatter.format(item.thirtyDay?.retailBottlesSold ?? 0)}</td>
              <td className="numeric">{numberFormatter.format(item.thirtyDay?.wholesaleBottlesSold ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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
        <div className="ohlq-sales-grid-scroll">
          <div className="section-heading ohlq-window-heading">
            <h3>7 and 30 day sales</h3>
            <div className="ohlq-combined-sales-summary">
              <SalesWindowSummary className="seven-day-summary" items={sevenDayWindow?.items ?? []} label="7 days" />
              <SalesWindowSummary className="thirty-day-summary" items={thirtyDayWindow?.items ?? []} label="30 days" />
            </div>
          </div>
          <SalesItemList
            emptyText={`No ${tenantConfig.productPluralLabel} sales found in the last 30 days.`}
            items={combinedItems}
          />
        </div>
      </div>
    </section>
  );
}
