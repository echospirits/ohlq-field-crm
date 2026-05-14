import type { WholesalePurchaseList, WholesaleRecentPurchases } from '../../lib/ohlqSalesData';

const numberFormatter = new Intl.NumberFormat('en-US');

function PurchaseSummary({ list }: { list: WholesalePurchaseList }) {
  return (
    <div className="ohlq-purchase-summary">
      <span>
        <strong>{numberFormatter.format(list.count)}</strong>
        <small>records</small>
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
  if (list.records.length === 0) {
    return <p className="muted activity-empty">{emptyText}</p>;
  }

  return (
    <>
      <div className="ohlq-purchase-list">
        {list.records.map((record, index) => (
          <article
            className="ohlq-purchase-row"
            key={`${record.reportDate}:${record.agencyId}:${record.vendor}:${record.itemCode}:${index}`}
          >
            <div>
              <strong>
                {record.itemCode} - {record.itemName}
              </strong>
              <span className="muted">
                {record.reportDate} - Agency {record.agencyId} - Vendor {record.vendor}
              </span>
            </div>
            <div className="ohlq-item-metrics">
              <span>
                <strong>{numberFormatter.format(record.wholesaleBottlesSold)}</strong>
                <small>bottles</small>
              </span>
            </div>
          </article>
        ))}
      </div>
      {list.count > list.records.length ? (
        <p className="muted view-more-note">
          Showing {numberFormatter.format(list.records.length)} most recent of {numberFormatter.format(list.count)}.
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
