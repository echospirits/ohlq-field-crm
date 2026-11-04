'use client';

import { useId, useRef, useState } from 'react';
import type { WholesalePurchaseList, WholesaleRecentPurchases } from '../../lib/ohlqSalesData';
import { DataFreshnessBadge } from '../components/DataFreshnessBadge';

const numberFormatter = new Intl.NumberFormat('en-US');
const PAGE_SIZE = 50;

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
  label,
  list,
}: {
  emptyText: string;
  label: string;
  list: WholesalePurchaseList;
}) {
  const [page, setPage] = useState(0);
  const listId = useId();
  const topNavigation = useRef<HTMLElement>(null);
  const pageCount = Math.ceil(list.items.length / PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const start = currentPage * PAGE_SIZE;
  const items = list.items.slice(start, start + PAGE_SIZE);

  function changePage(nextPage: number) {
    setPage(nextPage);
    topNavigation.current?.focus({ preventScroll: true });
    topNavigation.current?.scrollIntoView({ block: 'start' });
  }

  function navigation(position: 'top' | 'bottom') {
    return (
      <nav
        className="pagination-row ohlq-purchase-pagination"
        aria-label={`${label} pagination (${position})`}
        ref={position === 'top' ? topNavigation : undefined}
        tabIndex={-1}
      >
        <span className="muted" role={position === 'top' ? 'status' : undefined}>
          Showing {numberFormatter.format(start + 1)}–{numberFormatter.format(start + items.length)} of {numberFormatter.format(list.count)} items
        </span>
        <button type="button" className="btn secondary" aria-controls={listId} disabled={currentPage === 0} onClick={() => changePage(currentPage - 1)}>
          Previous
        </button>
        <button type="button" className="btn secondary" aria-controls={listId} disabled={currentPage >= pageCount - 1} onClick={() => changePage(currentPage + 1)}>
          Next
        </button>
      </nav>
    );
  }

  if (list.items.length === 0) {
    return <p className="muted activity-empty">{emptyText}</p>;
  }

  return (
    <>
      {pageCount > 1 ? navigation('top') : null}
      <div className="table-scroll" id={listId} role="region" aria-label={`${label} purchase comparison`} tabIndex={0}><table className="comparison-table purchase-comparison-table">
        <thead><tr><th scope="col">Product</th><th className="numeric" scope="col">Bottles</th><th className="numeric" scope="col">Purchase lines</th><th className="numeric" scope="col">Agencies</th><th className="numeric" scope="col">Vendors</th></tr></thead><tbody>
        {items.map((item) => (
          <tr key={item.itemCode}>
            <th scope="row"><strong>{item.itemName}</strong><small className="directory-record-id">{item.itemCode}</small></th>
            <td className="numeric">{numberFormatter.format(item.totalBottlesSold)}</td>
            <td className="numeric">{numberFormatter.format(item.purchaseLineCount)}</td>
            <td className="numeric">{numberFormatter.format(item.agencyCount)}</td>
            <td className="numeric">{numberFormatter.format(item.vendorCount)}</td>
          </tr>
        ))}
        </tbody></table></div>
      {pageCount > 1 ? navigation('bottom') : null}
    </>
  );
}

export function WholesaleRecentPurchasesCard({
  purchases,
}: {
  purchases: WholesaleRecentPurchases;
}) {
  const productLabel = purchases.productLabel;
  const productPluralLabel = purchases.productPluralLabel;

  if (!purchases.licenseeId) {
    return (
      <section className="dashboard-section ohlq-sales-section">
        <div className="section-heading ohlq-sales-heading">
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
      <div className="section-heading ohlq-sales-heading">
        <h2>Recent OHLQ Purchases</h2>
        <DataFreshnessBadge sourceDate={purchases.endDate} />
      </div>

      <details className="source-explanation compact-details nested-details">
        <summary>How these purchases relate to the timeline</summary>
        <p>The first list shows your organization&apos;s tracked products purchased by this account during the source-date window. All purchases includes other vendors at this location. The activity timeline shows only your organization&apos;s tracked products, so it can contain fewer purchase entries. CRM visits and tasks may also be newer than the latest OHLQ report.</p>
      </details>
      <p className="muted">Most bottles first · Product name A–Z for ties</p>

      <div className="card ohlq-window-card">
        <div className="section-heading ohlq-purchase-window-heading">
          <h3>{productLabel} · 30 days</h3>
          <PurchaseSummary list={purchases.tracked} />
        </div>
        {purchases.tracked.count === 0 && purchases.all.count > 0 ? (
          <p className="muted">This account has recent OHLQ purchases, but none for {productPluralLabel}.</p>
        ) : null}
        <PurchaseList
          key={`${purchases.licenseeId}:tracked:${purchases.endDate}`}
          label={`${productLabel} purchases`}
          emptyText={`No ${productLabel} purchases found in the last 30 days.`}
          list={purchases.tracked}
        />
      </div>
      <details className="card compact-details ohlq-window-details">
        <summary>
          All purchases · 30 days
          <PurchaseSummary list={purchases.all} />
        </summary>
        <PurchaseList key={`${purchases.licenseeId}:all:${purchases.endDate}`} label="All purchases" emptyText="No purchases found in the last 30 days." list={purchases.all} />
      </details>
    </section>
  );
}
