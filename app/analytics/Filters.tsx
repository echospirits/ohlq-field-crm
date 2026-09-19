'use client';

import Link from 'next/link';
import { useState } from 'react';
import { LiveFilterForm } from '../components/LiveFilterForm';
import { analyticsHref, type Filters, type Product } from '../../lib/analytics/model';

export function AnalyticsFilters({ filters: f, products, markets }: { filters: Filters; products: Product[]; markets: string[] }) {
  const [productSearch, setProductSearch] = useState('');
  const currentProduct = products.find(p => p.key === f.product);
  return <details className="analytics-filters">
    <summary>Filters · {f.start} – {f.end} · {f.channel === 'all' ? 'All channels' : f.channel}{currentProduct ? ` · ${currentProduct.name}` : ''}</summary>
    <LiveFilterForm label="Analytics filters" className="analytics-filter-grid" key={`${f.preset}:${f.start}:${f.end}:${f.channel}:${f.market}:${f.comparison}`}>
      <input type="hidden" name="page" value="1" />
      <label>Date range<select name="preset" defaultValue={f.preset}><option value="7">Last 7 Days</option><option value="30">Last 30 Days</option><option value="mtd">Month to Date</option><option value="qtd">Quarter to Date</option><option value="ytd">Year to Date</option><option value="12m">Last 12 Months</option><option value="custom">Custom</option></select></label>
      {f.preset === 'custom' ? <><label>Start<input type="date" name="start" defaultValue={f.start} /></label><label>End<input type="date" name="end" defaultValue={f.end} /></label></> : null}
      <label>Comparison<select name="comparison" defaultValue={f.comparison}><option value="previous">Previous Period</option><option value="year">Prior Year</option><option value="none">None</option></select></label>
      <label>Market<select name="market" defaultValue={f.market}><option value="all">All Markets</option>{markets.map(m => <option key={m} value={m}>{m === 'OH' ? 'Ohio' : m}</option>)}</select></label>
      <label>Sales channel<select name="channel" defaultValue={f.channel}><option value="all">All</option><option value="retail">Retail</option><option value="wholesale">Wholesale</option></select></label>
    </LiveFilterForm>
    <details className="analytics-product-picker"><summary>Product: {currentProduct?.name ?? (f.product ? 'Unavailable product' : 'All Organization products')}</summary>
      <label>Find a product<input type="search" value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder="Search name or item code" /></label>
      <div className="analytics-product-options"><Link href={analyticsHref(f, { product: '', page: 1 })}>All Organization products</Link>{products.filter(p => (f.market === 'all' || p.market === f.market) && `${p.name} ${p.code}`.toLowerCase().includes(productSearch.toLowerCase())).map(p => <Link key={p.key} href={analyticsHref(f, { product: p.key, page: 1 })} aria-current={p.key === f.product ? 'true' : undefined}>{p.name} <span className="muted">{p.code} · {p.market}</span></Link>)}</div>
    </details>
    <Link href="/analytics">Reset filters</Link>
  </details>;
}
