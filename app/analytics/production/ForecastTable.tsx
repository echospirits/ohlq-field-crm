'use client';
import Link from 'next/link';
import { useState } from 'react';
import { EmptyState } from '../../components/PageChrome';
import type { ForecastSummary } from '../../../lib/productionForecasting/service';
import { cases, trend } from '../../../lib/productionForecasting/presentation';
export function ConfidenceBadge({ value }: { value: string }) { return <span className={`pill pf-confidence pf-${value.toLowerCase()}`}>{value} confidence</span>; }
export function ForecastTable({ rows, initial = {}, organizationId }: { rows: ForecastSummary[]; initial?: Record<string, string>; organizationId?: string }) {
  const [query, setQuery] = useState(initial.q ?? ''), [market, setMarket] = useState(initial.market ?? 'all'), [confidence, setConfidence] = useState(initial.confidence ?? 'all'), [sort, setSort] = useState(initial.sort ?? 'need');
  const [filtersOpen, setFiltersOpen] = useState(Boolean((initial.market && initial.market !== 'all') || (initial.confidence && initial.confidence !== 'all') || (initial.sort && initial.sort !== 'need')));
  const selected = rows.filter(r => `${r.product.name} ${r.product.code}`.toLowerCase().includes(query.toLowerCase().trim()) && (market === 'all' || r.product.market === market) && (confidence === 'all' || r.confidence === confidence));
  selected.sort((a, b) => sort === 'name' ? a.product.name.localeCompare(b.product.name) : sort === 'change' ? Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0) : (b.target ?? -1) - (a.target ?? -1));
  const known = selected.filter(r => r.point !== null);
  const params = new URLSearchParams({ q: query, market, confidence, sort });
  if (organizationId) params.set('organization', organizationId);
  const href = (row: ForecastSummary) => `/analytics/production/${encodeURIComponent(row.product.id)}?${params}`;
  const guidance = (r: ForecastSummary) => r.guidanceThrough ? <>{cases(r.guidanceMinimum)}–{cases(r.guidanceMaximum)}<small>Min/max · through {r.guidanceThrough}</small></> : 'Not imported';
  return <>
    <label className="pf-product-search">Find product<input type="search" placeholder="Name or item code" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <details className="pf-filter-disclosure compact-details" open={filtersOpen} onToggle={e => setFiltersOpen(e.currentTarget.open)}><summary>Filters and sorting</summary><div className="pf-filters" role="search" aria-label="Find production forecasts">
      <label>Market<select value={market} onChange={e => setMarket(e.target.value)}><option value="all">All markets</option>{[...new Set(rows.map(r => r.product.market))].map(m => <option key={m}>{m}</option>)}</select></label>
      <label>Confidence<select value={confidence} onChange={e => setConfidence(e.target.value)}><option value="all">All confidence levels</option>{['High', 'Medium', 'Low'].map(c => <option key={c}>{c}</option>)}</select></label>
      <label>Sort by<select value={sort} onChange={e => setSort(e.target.value)}><option value="need">Planning target</option><option value="name">Product name</option><option value="change">Forecast change</option></select></label>
      <button className="secondary" onClick={() => { setQuery(''); setMarket('all'); setConfidence('all'); setSort('need'); }}>Clear filters</button>
    </div></details>
    <p className="muted" role="status">{selected.length} of {rows.length} products · {known.length ? `${cases(known.reduce((n, r) => n + r.point!, 0))} forecast cases · ${cases(known.reduce((n, r) => n + r.target!, 0))} planning target cases` : 'No forecastable history yet'}{known.length !== selected.length ? ` · ${selected.length - known.length} unavailable` : ''}</p>
    <div className="pf-desktop" role="region" aria-label="Product production forecasts" tabIndex={0}><table><thead><tr><th scope="col">Product</th><th scope="col">30-day forecast / range</th><th scope="col">Planning target</th><th scope="col">Prior-year period</th><th scope="col">90-day YoY / recent trend</th><th scope="col">DC guidance</th><th scope="col">Confidence / change</th></tr></thead><tbody>{selected.map(r => <tr key={r.product.id}>
      <th scope="row"><Link href={href(r)}>{r.product.name} ↗</Link><small>{r.product.code} · {r.product.market}</small>{r.alerts.map(a => <span className="pf-alert" key={a}>{a}</span>)}</th>
      <td><strong>{cases(r.point)}</strong>{r.point !== null ? <small>{cases(r.lower)}–{cases(r.upper)} cases</small> : <small>{r.note}</small>}</td>
      <td><strong>{cases(r.target)}</strong>{r.target !== null ? <small>Includes {Math.round(r.safetyFactor * 100)}% margin</small> : null}</td>
      <td>{cases(r.priorYear)}<small>Comparable 30 days</small></td><td>{trend(r.yoy)}<small>Recent: {trend(r.recentTrend)}</small></td>
      <td>{guidance(r)}</td><td><ConfidenceBadge value={r.confidence} /><small>{r.change === null ? 'No comparable previous forecast' : `${trend(r.change)} since previous forecast`}</small></td>
    </tr>)}</tbody></table></div>
    <div className="pf-mobile">{selected.map(r => <article key={r.product.id} className="pf-product-card"><div><Link href={href(r)}><strong>{r.product.name} ↗</strong></Link><small>{r.product.code} · {r.product.market}</small></div><ConfidenceBadge value={r.confidence} /><div className="pf-card-numbers"><span>30-day forecast<strong>{cases(r.point)}{r.point === null ? '' : ' cases'}</strong></span><span>Planning target<strong>{cases(r.target)}{r.target === null ? '' : ' cases'}</strong></span></div>{r.point !== null ? <p className="muted">Range {cases(r.lower)}–{cases(r.upper)} · prior year {cases(r.priorYear)}</p> : <p className="muted">{r.note}</p>}{r.alerts.map(a => <span className="pf-alert" key={a}>{a}</span>)}</article>)}</div>
    {!selected.length ? <EmptyState title={rows.length ? 'No matching products' : 'No eligible products'} description={rows.length ? 'Clear the filters to see every eligible Organization product.' : 'An administrator can review Organization product selection and current distribution status.'} /> : null}
  </>;
}
