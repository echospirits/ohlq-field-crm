export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { SubmitButton } from '../components/SubmitButton';
import { WholesaleOrderFiledSource } from '@prisma/client';
import Link from 'next/link';
import { buildPageMetadata } from '../../lib/appBrand';
import { requireUser } from '../../lib/auth';
import { formatDateOnly } from '../../lib/dateTime';
import { requireFeatureForUser } from '../../lib/organizations';
import { listWholesaleOrders } from '../../lib/wholesaleOrders';
import { PageHeader } from '../components/PageChrome';
import { toggleOrderChecklistAction } from './actions';
import { formatOrderCurrency } from './orderPresentation';

export const metadata = buildPageMetadata('Wholesale Orders');
const PAGE_SIZE = 25;
const toPage = (value: string | undefined) => Math.max(1, Number.parseInt(value ?? '1', 10) || 1);
type Order = Awaited<ReturnType<typeof listWholesaleOrders>>['orders'][number];

function ChecklistControl({ order, field }: { order: Order; field: 'sent' | 'paid' | 'filed' }) {
  const checked = Boolean(order[`${field}At`]);
  const automatic = field === 'filed' && order.filedSource === WholesaleOrderFiledSource.AUTO_MATCH;
  if (automatic) return <button aria-checked="true" aria-label="Filed, confirmed automatically by OHLQ sales data" className="wholesale-order-check checked automatic" disabled role="checkbox" title="Confirmed automatically by OHLQ sales data" type="button">✓</button>;
  return <form action={toggleOrderChecklistAction} className="wholesale-order-check-form">
    <input name="orderId" type="hidden" value={order.id} /><input name="field" type="hidden" value={field} /><input name="checked" type="hidden" value={String(!checked)} />
    <SubmitButton pendingLabel="…" aria-checked={checked} aria-label={`${checked ? 'Uncheck' : 'Check'} ${field} for ${order.customer.dba || order.customer.name}`} className={`wholesale-order-check${checked ? ' checked' : ''}`} role="checkbox" type="submit">{checked ? '✓' : ''}</SubmitButton>
  </form>;
}

function OrdersTable({ orders }: { orders: Order[] }) {
  return <div className="table-scroll wholesale-order-table-scroll"><table className="responsive-table wholesale-orders-table">
    <thead><tr><th>Sale date</th><th>Customer</th><th>Permit</th><th>A-3a store</th><th>Items</th><th>Total</th><th>Submitted by</th><th>Status</th><th className="check-column">Sent</th><th className="check-column">Paid</th><th className="check-column">Filed</th><th><span className="sr-only">Order details</span></th></tr></thead>
    <tbody>{orders.map((order) => <tr key={order.id}>
      <td data-label="Sale date">{formatDateOnly(order.saleDate)}</td><td data-label="Customer"><Link className="table-link" href={`/wholesale/${order.wholesaleAccountId}`}>{order.customer.dba || order.customer.name}</Link></td><td data-label="Permit">{order.customer.permitNumber}</td><td data-label="A-3a store">{order.seller.name} · {order.seller.storeId}</td><td data-label="Items">{order.lines.length}</td><td data-label="Total">{formatOrderCurrency(order.totalCents)}</td><td data-label="Submitted by">{order.createdBy.displayName}</td>
      <td data-label="Status"><span className={`pill wholesale-order-status ${order.sentAt && order.paidAt && order.filedAt ? 'status-completed' : 'status-outstanding'}`}>{order.sentAt && order.paidAt && order.filedAt ? 'Completed' : 'Outstanding'}</span></td>
      <td className="check-column" data-label="Sent"><ChecklistControl field="sent" order={order} /></td><td className="check-column" data-label="Paid"><ChecklistControl field="paid" order={order} /></td><td className="check-column" data-label="Filed"><ChecklistControl field="filed" order={order} /></td><td data-label=""><Link className="table-link wholesale-order-details-link" href={`/wholesale-orders/${order.id}`}>Order Details</Link></td>
    </tr>)}</tbody>
  </table></div>;
}

function Pagination({ label, page, pages, total, href }: { label: string; page: number; pages: number; total: number; href: (page: number) => string }) {
  if (pages <= 1) return <p className="muted order-count">{total} order{total === 1 ? '' : 's'}</p>;
  return <nav aria-label={`${label} pages`} className="pagination-row">{page > 1 ? <Link className="btn compact-btn secondary" href={href(page - 1)}>Previous</Link> : null}<span className="muted">Page {page} of {pages} · {total} order{total === 1 ? '' : 's'}</span>{page < pages ? <Link className="btn compact-btn secondary" href={href(page + 1)}>Next</Link> : null}</nav>;
}

export default async function WholesaleOrdersPage({ searchParams }: { searchParams?: Promise<{ outstandingPage?: string; completedPage?: string; showCompleted?: string; status?: string }> }) {
  const user = await requireUser();
  const { organizationId } = await requireFeatureForUser(user, 'OHIO_DIRECT_WHOLESALE_ORDERS');
  const query = (await searchParams) ?? {};
  let [outstanding, completed] = await Promise.all([
    listWholesaleOrders({ organizationId, completion: 'outstanding', page: toPage(query.outstandingPage), pageSize: PAGE_SIZE }),
    listWholesaleOrders({ organizationId, completion: 'completed', page: toPage(query.completedPage), pageSize: PAGE_SIZE }),
  ]);
  const outstandingPages = Math.max(1, Math.ceil(outstanding.totalCount / PAGE_SIZE));
  const completedPages = Math.max(1, Math.ceil(completed.totalCount / PAGE_SIZE));
  const retries = await Promise.all([
    outstanding.page > outstandingPages ? listWholesaleOrders({ organizationId, completion: 'outstanding', page: outstandingPages, pageSize: PAGE_SIZE }) : null,
    completed.page > completedPages ? listWholesaleOrders({ organizationId, completion: 'completed', page: completedPages, pageSize: PAGE_SIZE }) : null,
  ]);
  if (retries[0]) outstanding = retries[0];
  if (retries[1]) completed = retries[1];
  const outstandingHref = (page: number) => `/wholesale-orders?${new URLSearchParams({ ...(page > 1 ? { outstandingPage: String(page) } : {}) })}`;
  const completedHref = (page: number) => `/wholesale-orders?${new URLSearchParams({ showCompleted: '1', ...(page > 1 ? { completedPage: String(page) } : {}) })}`;
  return <>
    <PageHeader eyebrow="Accounts" title="Wholesale Orders" description="Create and track A-3a direct wholesale orders." actions={<Link className="btn" href="/wholesale-orders/new">Create Wholesale Order</Link>} />
    {query.status === 'updated' ? <p className="toast-notice" role="status">Order checklist updated.</p> : null}
    <section aria-labelledby="outstanding-orders-heading" className="wholesale-order-section"><div className="section-heading"><div><span className="page-eyebrow">Needs action</span><h2 id="outstanding-orders-heading">Outstanding Orders</h2><p className="muted">Check Sent, Paid, and Filed. An order completes when all three are checked.</p></div><span className="pill">{outstanding.totalCount}</span></div>
      {outstanding.orders.length ? <><OrdersTable orders={outstanding.orders} /><Pagination href={outstandingHref} label="Outstanding order" page={outstanding.page} pages={outstandingPages} total={outstanding.totalCount} /></> : <article className="card empty-state"><h3>No outstanding orders</h3><p>Newly generated wholesale PDFs will appear here.</p></article>}
    </section>
    <details className="card wholesale-order-completed" open={query.showCompleted === '1'}><summary><span><span className="page-eyebrow">History</span><strong>Completed Orders</strong></span><span className="pill">{completed.totalCount}</span></summary><div className="wholesale-order-completed-content">{completed.orders.length ? <><OrdersTable orders={completed.orders} /><Pagination href={completedHref} label="Completed order" page={completed.page} pages={completedPages} total={completed.totalCount} /></> : <div className="empty-state"><h3>No completed orders yet</h3><p>Orders move here after Sent, Paid, and Filed are all checked.</p></div>}</div></details>
  </>;
}
