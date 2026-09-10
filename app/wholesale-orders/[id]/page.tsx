export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { WholesaleOrderFiledSource, WholesaleOrderStatus } from '@prisma/client';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buildPageMetadata } from '../../../lib/appBrand';
import { requireUser } from '../../../lib/auth';
import { formatDateOnly, formatEasternDateTime } from '../../../lib/dateTime';
import { requireFeatureForUser } from '../../../lib/organizations';
import { getWholesaleOrder } from '../../../lib/wholesaleOrders';
import { PageHeader } from '../../components/PageChrome';
import { markOrderFiledAction, markOrderSentAction } from '../actions';
import { filedSourceLabel, formatOrderCurrency, orderStatusLabel } from '../orderPresentation';

export async function generateMetadata() { return buildPageMetadata('Wholesale Order'); }

const statusMessage: Record<string, string> = { filed: 'Order marked Filed.', sent: 'Order marked Sent.' };

export default async function WholesaleOrderDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ status?: string }> }) {
  const user = await requireUser();
  const { organizationId } = await requireFeatureForUser(user, 'OHIO_DIRECT_WHOLESALE_ORDERS');
  const { id } = await params;
  const order = await getWholesaleOrder({ id, organizationId });
  if (!order) notFound();
  const query = (await searchParams) ?? {};
  const customerAddress = [order.customer.address, order.customer.city, order.customer.state, order.customer.postalCode].filter(Boolean).join(', ');
  const sellerAddress = [order.seller.addressLine1, order.seller.city, order.seller.state, order.seller.postalCode].filter(Boolean).join(', ');

  return <>
    <PageHeader eyebrow={`Wholesale order · ${orderStatusLabel[order.status]}`} title={order.customer.dba || order.customer.name} description={`Sale date ${formatDateOnly(order.saleDate)} · Permit ${order.customer.permitNumber}`} actions={<div className="page-actions"><Link className="btn secondary" href={`/wholesale/${order.wholesaleAccountId}`}>View customer</Link><Link className="btn secondary" href="/wholesale-orders">Back to orders</Link><a className="btn" href={`/api/wholesale-orders/${order.id}/pdf`}>Download PDF</a></div>} />
    {query.status && statusMessage[query.status] ? <p className="toast-notice" role="status">{statusMessage[query.status]}</p> : null}
    <div className="wholesale-order-detail-grid">
      <article className="card">
        <div className="section-heading"><div><span className="page-eyebrow">Order details</span><h2>Customer and seller</h2></div><span className="pill">{orderStatusLabel[order.status]}</span></div>
        <dl className="wholesale-order-detail-list">
          <div><dt>Customer</dt><dd>{order.customer.name}{order.customer.dba ? <><br />DBA {order.customer.dba}</> : null}</dd></div>
          <div><dt>Permit</dt><dd>{order.customer.permitNumber}</dd></div>
          <div><dt>Customer address</dt><dd>{customerAddress || 'Not provided'}</dd></div>
          <div><dt>A-3a seller</dt><dd>{order.seller.name} · Store {order.seller.storeId}</dd></div>
          <div><dt>Seller address</dt><dd>{sellerAddress || 'Not provided'}</dd></div>
          <div><dt>Submitted</dt><dd>{formatEasternDateTime(order.createdAt)} by {order.createdBy.displayName}</dd></div>
        </dl>
      </article>
      <article className="card">
        <div className="section-heading"><div><span className="page-eyebrow">Status history</span><h2>Order lifecycle</h2></div></div>
        <dl className="wholesale-order-detail-list">
          <div><dt>PDF Generated</dt><dd>{formatEasternDateTime(order.createdAt)} by {order.createdBy.displayName}</dd></div>
          {order.sentAt ? <div><dt>Sent</dt><dd>{formatEasternDateTime(order.sentAt)}{order.sentBy?.displayName ? ` by ${order.sentBy.displayName}` : ''}</dd></div> : null}
          {order.filedAt ? <div><dt>Filed</dt><dd>{formatEasternDateTime(order.filedAt)} · {order.filedSource ? filedSourceLabel[order.filedSource] : 'Filed'}{order.filedBy?.displayName ? ` by ${order.filedBy.displayName}` : ''}{order.filedSource === WholesaleOrderFiledSource.AUTO_MATCH && order.matchedReportDate ? ` · OHLQ sale ${formatDateOnly(order.matchedReportDate)}` : ''}</dd></div> : null}
        </dl>
        <div className="action-row wholesale-order-status-actions">
          {order.status === WholesaleOrderStatus.PDF_GENERATED ? <form action={markOrderSentAction}><input name="orderId" type="hidden" value={order.id} /><button type="submit">Mark Sent</button></form> : null}
          {order.status !== WholesaleOrderStatus.FILED ? <form action={markOrderFiledAction}><input name="orderId" type="hidden" value={order.id} /><button className="secondary" type="submit">Mark Filed</button></form> : null}
        </div>
      </article>
    </div>
    <section className="card wholesale-order-lines-detail">
      <div className="section-heading"><div><span className="page-eyebrow">Invoice</span><h2>Products</h2></div><strong>{formatOrderCurrency(order.totalCents)}</strong></div>
      <div className="table-scroll"><table className="responsive-table"><thead><tr><th>Item code</th><th>Product</th><th>Quantity</th><th>Price per bottle</th><th>Subtotal</th></tr></thead><tbody>
        {order.lines.map((line, index) => <tr key={`${line.itemCode}-${index}`}><td data-label="Item code">{line.itemCode}</td><td data-label="Product">{line.itemName}</td><td data-label="Quantity">{line.quantityBottles}</td><td data-label="Price per bottle">{formatOrderCurrency(line.unitPriceCents)}</td><td data-label="Subtotal">{formatOrderCurrency(line.unitPriceCents * line.quantityBottles)}</td></tr>)}
      </tbody></table></div>
      <dl className="direct-order-total"><div><dt>Subtotal</dt><dd>{formatOrderCurrency(order.subtotalCents)}</dd></div><div><dt>SIN tax</dt><dd>{formatOrderCurrency(order.sinTaxCents)}</dd></div><div className="grand-total"><dt>Invoice total</dt><dd>{formatOrderCurrency(order.totalCents)}</dd></div></dl>
    </section>
  </>;
}
