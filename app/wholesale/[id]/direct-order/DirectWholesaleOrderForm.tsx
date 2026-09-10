'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { calculateDirectWholesaleOrderTotals, MAX_DIRECT_WHOLESALE_ORDER_LINES, type DirectWholesaleOrderPdfPayload } from '../../../../lib/directWholesaleOrders';

type LocationOption = { id: string; label: string; storeId: string };
type ProductOption = { itemCode: string; itemName: string; wholesalePrice: number | null };
type OrderLine = { key: number; itemCode: string; quantityBottles: number; wholesalePrice: number };

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function DirectWholesaleOrderForm({
  account,
  locations,
  products,
  saleDate,
  submitterName,
}: {
  account: { address: string; city: string; dba: string; id: string; name: string; permitNumber: string; phone: string; postalCode: string; state: string };
  locations: LocationOption[];
  products: ProductOption[];
  saleDate: string;
  submitterName: string;
}) {
  const defaultLocationId = locations[0]?.id ?? '';
  const [directSaleLocationId, setDirectSaleLocationId] = useState(defaultLocationId);
  const [customer, setCustomer] = useState({ ...account, f2Permit: false });
  const [selectedSaleDate, setSelectedSaleDate] = useState(saleDate);
  const [sinTax, setSinTax] = useState(0);
  const [a3aSignature, setA3aSignature] = useState(submitterName);
  const [customerSignature, setCustomerSignature] = useState('');
  const [lines, setLines] = useState<OrderLine[]>([{ key: 1, itemCode: '', quantityBottles: 1, wholesalePrice: 0 }]);
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [completedOrder, setCompletedOrder] = useState<{ fingerprint: string; id: string } | null>(null);
  const requestRef = useRef<{ fingerprint: string; id: string } | null>(null);
  const productByCode = useMemo(() => new Map(products.map((product) => [product.itemCode.toUpperCase(), product])), [products]);
  const totals = calculateDirectWholesaleOrderTotals(lines, sinTax);
  const updateCustomer = (key: keyof typeof customer, value: string | boolean) => setCustomer((current) => ({ ...current, [key]: value }));
  const updateLine = (key: number, changes: Partial<OrderLine>) => setLines((current) => current.map((line) => line.key === key ? { ...line, ...changes } : line));
  const selectProduct = (key: number, value: string) => {
    const itemCode = value.trim().toUpperCase();
    const product = productByCode.get(itemCode);
    updateLine(key, { itemCode, ...(product?.wholesalePrice != null ? { wholesalePrice: product.wholesalePrice } : {}) });
  };
  const canReview = Boolean(
    directSaleLocationId && selectedSaleDate && customer.name.trim() && customer.address.trim() && customer.city.trim() &&
    customer.state === 'OH' && customer.postalCode.trim() && customer.permitNumber.trim() && Number.isFinite(sinTax) && sinTax >= 0 && lines.length > 0 &&
    sinTax <= 100000 && lines.every((line) => productByCode.has(line.itemCode.toUpperCase()) && Number.isInteger(line.quantityBottles) && line.quantityBottles > 0 && line.quantityBottles <= 10000 && Number.isFinite(line.wholesalePrice) && line.wholesalePrice >= 0 && line.wholesalePrice <= 100000),
  );
  const payload: DirectWholesaleOrderPdfPayload = {
    a3aSignature,
    customer,
    customerSignature,
    directSaleLocationId,
    lines: lines.map(({ itemCode, quantityBottles, wholesalePrice }) => ({ itemCode, quantityBottles, wholesalePrice })),
    saleDate: selectedSaleDate,
    sinTax,
    wholesaleAccountId: account.id,
  };
  const fingerprint = JSON.stringify(payload);

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const getDownloadFilename = (response: Response) => {
    const disposition = response.headers.get('content-disposition') ?? '';
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const plain = disposition.match(/filename="([^"]+)"/i)?.[1];
    if (encoded) {
      try { return decodeURIComponent(encoded); } catch { /* use the safe fallback below */ }
    }
    return plain || `${selectedSaleDate}-A3a-Wholesale-Sale.pdf`;
  };

  const createAndDownloadOrder = async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      if (completedOrder?.fingerprint === fingerprint) {
        const response = await fetch(`/api/wholesale-orders/${completedOrder.id}/pdf`, { cache: 'no-store' });
        if (!response.ok) throw new Error(await response.text() || 'The saved PDF could not be downloaded.');
        if (!response.headers.get('content-type')?.includes('application/pdf')) throw new Error('Your session may have expired. Refresh the page, sign in, and download the saved order again.');
        downloadBlob(await response.blob(), getDownloadFilename(response));
        return;
      }
      if (!requestRef.current || requestRef.current.fingerprint !== fingerprint) {
        requestRef.current = { fingerprint, id: crypto.randomUUID() };
      }
      const response = await fetch('/api/wholesale-orders/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, clientRequestId: requestRef.current.id }),
      });
      if (!response.ok) throw new Error(await response.text() || 'The wholesale order could not be created.');
      if (!response.headers.get('content-type')?.includes('application/pdf')) throw new Error('Your session may have expired. Refresh the page, sign in, and try again.');
      const orderId = response.headers.get('x-wholesale-order-id');
      if (!orderId) throw new Error('The order confirmation was incomplete. Open Wholesale Orders to check whether it was saved before retrying.');
      downloadBlob(await response.blob(), getDownloadFilename(response));
      setCompletedOrder({ fingerprint, id: orderId });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'The wholesale order could not be created.');
    } finally {
      setSubmitting(false);
    }
  };

  if (reviewing) {
    const location = locations.find((item) => item.id === directSaleLocationId);
    return <section className="direct-order-shell">
      <div className="notice direct-order-safety"><strong>Save and download only.</strong> Neat will not email or transmit this order.</div>
      <article className="card direct-order-review">
        <div className="section-heading"><div><span className="page-eyebrow">Review</span><h2>A-3a direct wholesale sale</h2></div><span className="pill">PDF download</span></div>
        <dl className="direct-order-review-grid">
          <div><dt>Seller</dt><dd>{location?.label}<small>Store {location?.storeId}</small></dd></div>
          <div><dt>Customer</dt><dd>{customer.dba || customer.name}<small>{customer.name} · {customer.permitNumber}</small></dd></div>
          <div><dt>Sale date</dt><dd>{selectedSaleDate}</dd></div>
          <div><dt>F2 permit</dt><dd>{customer.f2Permit ? 'Yes' : 'No'}</dd></div>
        </dl>
        <div className="direct-order-review-lines">{lines.map((line, index) => {
          const product = productByCode.get(line.itemCode.toUpperCase());
          return <div key={line.key}><span><strong>{line.itemCode}</strong> {product?.itemName}</span><span>{line.quantityBottles} × {currency.format(line.wholesalePrice)}</span><strong>{currency.format(totals.lineSubtotals[index])}</strong></div>;
        })}</div>
        <div className="direct-order-total"><span>Subtotal <strong>{currency.format(totals.subtotal)}</strong></span><span>SIN tax <strong>{currency.format(totals.sinTax)}</strong></span><span className="grand-total">Invoice total <strong>{currency.format(totals.total)}</strong></span></div>
        <div className="action-row direct-order-review-actions">
          <button className="secondary" disabled={submitting} onClick={() => setReviewing(false)} type="button">Back to edit</button>
          <button disabled={submitting} onClick={createAndDownloadOrder} type="button">{submitting ? 'Preparing PDF…' : completedOrder?.fingerprint === fingerprint ? 'Download saved PDF again' : 'Save order and download PDF'}</button>
        </div>
        {submitError ? <p className="notice direct-order-error" role="alert">{submitError}</p> : null}
        {completedOrder?.fingerprint === fingerprint ? <div className="notice direct-order-success" role="status"><strong>Your order is saved.</strong> <Link href={`/wholesale-orders/${completedOrder.id}`}>View order</Link></div> : null}
      </article>
    </section>;
  }

  return <section className="direct-order-shell">
    <div className="notice direct-order-safety"><strong>Safe pilot:</strong> this workflow saves the order in Neat and downloads its PDF. It cannot send email to OHLQ.</div>
    <article className="card direct-order-card">
      <div className="section-heading"><div><span className="page-eyebrow">1. Seller</span><h2>A-3a selling location</h2></div></div>
      <label>Selling location<select onChange={(event) => setDirectSaleLocationId(event.target.value)} value={directSaleLocationId}>{locations.map((location) => <option key={location.id} value={location.id}>{location.label} · Store {location.storeId}</option>)}</select></label>
    </article>
    <article className="card direct-order-card">
      <div className="section-heading"><div><span className="page-eyebrow">2. Customer</span><h2>Wholesale customer information</h2><p className="muted">Correcting these values changes this PDF only.</p></div></div>
      <div className="form-grid">
        <label>Customer name<input onChange={(event) => updateCustomer('name', event.target.value)} required value={customer.name} /></label>
        <label>Customer DBA<input onChange={(event) => updateCustomer('dba', event.target.value)} value={customer.dba} /></label>
        <label>Permit number<input onChange={(event) => updateCustomer('permitNumber', event.target.value)} required value={customer.permitNumber} /></label>
        <label>Customer phone<input onChange={(event) => updateCustomer('phone', event.target.value)} type="tel" value={customer.phone} /></label>
        <label>Customer address<input onChange={(event) => updateCustomer('address', event.target.value)} required value={customer.address} /></label>
        <label>City<input onChange={(event) => updateCustomer('city', event.target.value)} required value={customer.city} /></label>
        <label>State<input readOnly required value="OH" /></label>
        <label>Postal code<input onChange={(event) => updateCustomer('postalCode', event.target.value)} required value={customer.postalCode} /></label>
      </div>
      <fieldset className="direct-order-choice"><legend>Is this an F2 Permit?</legend><label><input checked={!customer.f2Permit} name="f2Permit" onChange={() => updateCustomer('f2Permit', false)} type="radio" /> No</label><label><input checked={customer.f2Permit} name="f2Permit" onChange={() => updateCustomer('f2Permit', true)} type="radio" /> Yes</label></fieldset>
    </article>
    <article className="card direct-order-card">
      <div className="section-heading"><div><span className="page-eyebrow">3. Sale</span><h2>Products and quantities</h2><p className="muted">Wholesale prices come from the latest Ohio Brand Master and can be corrected for this order.</p></div></div>
      <label>Sales date<input onChange={(event) => setSelectedSaleDate(event.target.value)} type="date" value={selectedSaleDate} /></label>
      <datalist id="direct-order-products">{products.map((product) => <option key={product.itemCode} value={product.itemCode}>{product.itemName}</option>)}</datalist>
      <div className="direct-order-lines">{lines.map((line, index) => {
        const product = productByCode.get(line.itemCode.toUpperCase());
        return <article className="direct-order-line" key={line.key}>
          <div className="direct-order-line-heading"><strong>Product {index + 1}</strong>{lines.length > 1 ? <button className="link-button" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} type="button">Remove</button> : null}</div>
          <label>Ohio item code<input list="direct-order-products" onChange={(event) => selectProduct(line.key, event.target.value)} placeholder="Search by item code" value={line.itemCode} /></label>
          <p className="direct-order-product-name">{product?.itemName || 'Select an organization product'}</p>
          <div className="direct-order-line-numbers"><label>Quantity (bottles)<input inputMode="numeric" min={1} onChange={(event) => updateLine(line.key, { quantityBottles: Number(event.target.value) })} step={1} type="number" value={line.quantityBottles} /></label><label>Price per bottle<input inputMode="decimal" min={0} onChange={(event) => updateLine(line.key, { wholesalePrice: Number(event.target.value) })} step="0.01" type="number" value={line.wholesalePrice} /></label></div>
          <p className="direct-order-line-subtotal"><span>Item subtotal</span><strong>{currency.format(totals.lineSubtotals[index])}</strong></p>
        </article>;
      })}</div>
      {lines.length < MAX_DIRECT_WHOLESALE_ORDER_LINES ? <button className="secondary" onClick={() => setLines((current) => [...current, { key: Math.max(...current.map((line) => line.key)) + 1, itemCode: '', quantityBottles: 1, wholesalePrice: 0 }])} type="button">Add product</button> : <p className="muted">The official template supports seven product rows.</p>}
      <label>SIN tax, if applicable<input inputMode="decimal" min={0} onChange={(event) => setSinTax(Number(event.target.value))} step="0.01" type="number" value={sinTax} /></label>
      <div className="direct-order-total"><span>Subtotal <strong>{currency.format(totals.subtotal)}</strong></span><span className="grand-total">Invoice total <strong>{currency.format(totals.total)}</strong></span></div>
    </article>
    <article className="card direct-order-card">
      <div className="section-heading"><div><span className="page-eyebrow">4. Signatures</span><h2>Typed names on the PDF</h2></div></div>
      <div className="form-grid"><label>A-3a signature name<input onChange={(event) => setA3aSignature(event.target.value)} value={a3aSignature} /></label><label>Customer signature name<input onChange={(event) => setCustomerSignature(event.target.value)} value={customerSignature} /></label></div>
    </article>
    {!canReview ? <p className="notice">Complete the required customer fields and select a valid product before review.</p> : null}
    <button className="direct-order-review-button" disabled={!canReview} onClick={() => setReviewing(true)} type="button">Review PDF details</button>
  </section>;
}
