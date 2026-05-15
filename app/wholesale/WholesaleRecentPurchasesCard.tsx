import type { WholesalePurchaseList, WholesaleRecentPurchases } from '../../lib/ohlqSalesData';

const numberFormatter = new Intl.NumberFormat('en-US');

function PurchaseSummary({ list }: { list: WholesalePurchaseList }) {
  return (
    <div className="ohlq-purchase-summary">
      <span>
        <strong>{numberFormatter.format(list.count)}</strong>
        <small>items</small>
      </span>
      <span>
        <strong>{numberFormatter.format(list.totalBottlesSold)}</strong>
        <small>bottles</small>
      </span>
    </div>
  );
}

function PurchaseList({
  emptyText,
  list,
}: {
  emptyText: string;
  list: WholesalePurchaseList;
}) {
  if (list.items.length === 0) {
    return <p className="muted activity-empty">{emptyText}</p>;
  }

  return (
    <>
      <div className="ohlq-purchase-list">
        {list.items.map((item) => (
          <article
            className="ohlq-purchase-row"
            key={item.itemCode}
          >
            <div>
              <strong>
                {item.itemCode} - {item.itemName}
              </strong>
              <span className="muted">
                {numberFormatter.format(item.purchaseLineCount)} purchase line{item.purchaseLineCount === 1 ? '' : 's'}
                {' · '}
                {numberFormatter.format(item.agencyCount)} agenc{item.agencyCount === 1 ? 'y' : 'ies'}
                {item.vendorCount > 1 ? ` · ${numberFormatter.format(item.vendorCount)} vendors` : ''}
              </span>
            </div>
            <div className="ohlq-item-metrics">
              <span>
                <strong>{numberFormatter.format(item.totalBottlesSold)}</strong>
                <small>bottles</small>
              </span>
            </div>
          </article>
        ))}
      </div>
      {list.count > list.items.length ? (
        <p className="muted view-more-note">
          Showing {numberFormatter.format(list.items.length)} of {numberFormatter.format(list.count)} items.
        </p>
      ) : null}
    </>
  );
}

export function WholesaleRecentPurchasesCard({
  purchases,
}: {
  purchases: WholesaleRecentPurchases;
}) {
  if (!purchases.licenseeId) {
    return (
      <section className="dashboard-section ohlq-sales-section">
        <div className="section-heading">
          <h2>Recent OHLQ Purchases</h2>
          <span className="pill">Not linked</span>
        </div>
        <div className="card">
          <p className="muted activity-empty">Purchase data cannot be linked until this account has a Licensee ID.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="dashboard-section ohlq-sales-section">
      <div className="section-heading">
        <h2>Recent OHLQ Purchases</h2>
        <span className="pill">
          {purchases.startDate && purchases.endDate ? `${purchases.startDate} to ${purchases.endDate}` : 'No data'}
        </span>
      </div>

      <div className="card ohlq-window-card">
        <div className="section-heading">
          <h3>Echo purchases - last 30 days</h3>
          <PurchaseSummary list={purchases.echo} />
        </div>
        {purchases.echo.count === 0 && purchases.all.count > 0 ? (
          <p className="muted">This account has recent OHLQ purchases, but none for Echo item codes.</p>
        ) : null}
        <PurchaseList emptyText="No Echo purchases found in the last 30 days." list={purchases.echo} />
      </div>

      <details className="card compact-details ohlq-window-details">
        <summary>
          All purchases - last 30 days
          <PurchaseSummary list={purchases.all} />
        </summary>
        <PurchaseList emptyText="No purchases found in the last 30 days." list={purchases.all} />
      </details>
    </section>
  );
}
