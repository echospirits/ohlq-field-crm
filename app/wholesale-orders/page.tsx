export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { WholesaleOrderStatus } from '@prisma/client';
import Link from 'next/link';
import { buildPageMetadata } from '../../lib/appBrand';
import { requireUser } from '../../lib/auth';
import { formatDateOnly } from '../../lib/dateTime';
import { requireFeatureForUser } from '../../lib/organizations';
import { listWholesaleOrders } from '../../lib/wholesaleOrders';
import { PageHeader } from '../components/PageChrome';
import { formatOrderCurrency, orderStatusLabel } from './orderPresentation';

export const metadata = buildPageMetadata('Wholesale Orders');

const PAGE_SIZE = 25;
const statusValues = new Set(Object.values(WholesaleOrderStatus));
const toPage = (value: string | undefined) => Math.max(1, Number.parseInt(value ?? '1', 10) || 1);

export default async function WholesaleOrdersPage({ searchParams }: { searchParams?: Promise<{ page?: string; status?: string }> }) {
  const user = await requireUser();
  const { organizationId } = await requireFeatureForUser(user, 'OHIO_DIRECT_WHOLESALE_ORDERS');
  const query = (await searchParams) ?? {};
  const status = statusValues.has(query.status as WholesaleOrderStatus) ? query.status as WholesaleOrderStatus : undefined;
  const requestedPage = toPage(query.page);
  let result = await listWholesaleOrders({ organizationId, status, page: requestedPage, pageSize: PAGE_SIZE });
  const pages = Math.max(1, Math.ceil(result.totalCount / PAGE_SIZE));
  if (requestedPage > pages) result = await listWholesaleOrders({ organizationId, status, page: pages, pageSize: PAGE_SIZE });
  const { orders, totalCount: total, page } = result;
  const href = (nextPage: number, nextStatus: WholesaleOrderStatus | null = status ?? null) => `/wholesale-orders?${new URLSearchParams({ ...(nextStatus ? { status: nextStatus } : {}), ...(nextPage > 1 ? { page: String(nextPage) } : {}) })}`;

  return <>
    <PageHeader eyebrow="Accounts" title="Wholesale Orders" description="Create and track A-3a direct wholesale orders." actions={<Link className="btn" href="/wholesale-orders/new">Create Wholesale Order</Link>} />
    <nav aria-label="Order status filters" className="wholesale-order-filters">
      <Link className={!status ? 'active' : ''} href={href(1, null)}>All <span className="sr-only">orders</span></Link>
      {Object.values(WholesaleOrderStatus).map((value) => <Link className={status === value ? 'active' : ''} href={href(1, value)} key={value}>{orderStatusLabel[value]}</Link>)}
    </nav>
    {orders.length ? <>
      <div className="table-scroll wholesale-order-table-scroll"><table className="responsive-table">
        <thead><tr><th>Sale date</th><th>Customer</th><th>Permit</th><th>A-3a store</th><th>Items</th><th>Total</th><th>Submitted by</th><th>Status</th></tr></thead>
        <tbody>{orders.map((order) => {
          return <tr key={order.id}>
            <td data-label="Sale date">{formatDateOnly(order.saleDate)}</td>
            <td data-label="Customer"><Link className="table-link" href={`/wholesale-orders/${order.id}`}>{order.customer.dba || order.customer.name}</Link></td>
            <td data-label="Permit">{order.customer.permitNumber}</td>
            <td data-label="A-3a store">{order.seller.name} · {order.seller.storeId}</td>
            <td data-label="Items">{order.lines.length}</td>
            <td data-label="Total">{formatOrderCurrency(order.totalCents)}</td>
            <td data-label="Submitted by">{order.createdBy.displayName}</td>
            <td data-label="Status"><span className={`pill wholesale-order-status status-${order.status.toLowerCase().replace('_', '-')}`}>{orderStatusLabel[order.status]}</span></td>
          </tr>;
        })}</tbody>
      </table></div>
      <nav aria-label="Wholesale order pages" className="pagination-row">
        {page > 1 ? <Link className="btn compact-btn secondary" href={href(page - 1)}>Previous</Link> : null}
        <span className="muted">Page {page} of {pages} · {total} order{total === 1 ? '' : 's'}</span>
        {page < pages ? <Link className="btn compact-btn secondary" href={href(page + 1)}>Next</Link> : null}
      </nav>
    </> : <article className="card empty-state"><h2>{status ? `No ${orderStatusLabel[status]} orders` : 'No saved wholesale orders yet'}</h2><p>Order history begins when a new PDF is saved. PDFs downloaded before this release are not available here.</p><Link className="btn" href="/wholesale-orders/new">Create Wholesale Order</Link></article>}
  </>;
}
