'use client';

import Link from 'next/link';
import { useState } from 'react';
import { EmptyState } from '../../components/PageChrome';
import type { ForecastSummary } from '../../../lib/productionForecasting/service';
import { cases, trend } from '../../../lib/productionForecasting/presentation';
import type { ForecastHorizon } from '../../../lib/productionForecasting/model';
import { ForecastHorizonSelector } from './ForecastHorizonSelector';
import { CurrentDemandSummary, type DemandRow } from './OperationalSignals';

export function ConfidenceBadge({ value }: { value: string }) {
  return <span className={`pill pf-confidence pf-${value.toLowerCase()}`}>{value} confidence</span>;
}

export function ForecastTable({ rows, currentDemand = {}, initial = {}, organizationId, horizon = 30 }: {
  rows: ForecastSummary[];
  currentDemand?: Record<string, DemandRow>;
  initial?: Record<string, string>;
  organizationId?: string;
  horizon?: ForecastHorizon;
}) {
  const [query, setQuery] = useState(initial.q ?? '');
  const [market, setMarket] = useState(initial.market ?? 'all');
  const [confidence, setConfidence] = useState(initial.confidence ?? 'all');
  const [sort, setSort] = useState(initial.sort ?? 'need');
  const selected = rows.filter(r => `${r.product.name} ${r.product.code}`.toLowerCase().includes(query.toLowerCase().trim()) && (market === 'all' || r.product.market === market) && (confidence === 'all' || r.confidence === confidence));
  selected.sort((a, b) => sort === 'name' ? a.product.name.localeCompare(b.product.name) : sort === 'change' ? Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0) : (b.target ?? -1) - (a.target ?? -1));
  const known = selected.filter(r => r.point !== null);
  const params = new URLSearchParams({ q: query, market, confidence, sort, horizon: String(horizon) });
  if (organizationId) params.set('organization', organizationId);
  const href = (row: ForecastSummary) => `/analytics/production/${encodeURIComponent(row.product.id)}?${params}`;
  const reset = () => { setQuery(''); setMarket('all'); setConfidence('all'); setSort('need'); };

  return <section className="pf-results" aria-label="Product forecasts">
    <div className="pf-results-heading"><h2>Products</h2><ForecastHorizonSelector horizon={horizon} query={params.toString()} /></div>
    <div className="pf-filter-toolbar data-toolbar" role="search" aria-label="Find production forecasts">
      <label className="pf-product-search">Find product<input type="search" placeholder="Name or code" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label className="pf-sort">Sort<select value={sort} onChange={e => setSort(e.target.value)}><option value="need">Target</option><option value="name">Name</option><option value="change">Change</option></select></label>
      <details className="pf-optional-filters compact-details"><summary>Filters{market !== 'all' || confidence !== 'all' ? ` (${Number(market !== 'all') + Number(confidence !== 'all')})` : ''}</summary><div className="pf-optional-filter-fields">
        <label>Market<select value={market} onChange={e => setMarket(e.target.value)}><option value="all">All markets</option>{[...new Set(rows.map(r => r.product.market))].map(m => <option key={m}>{m}</option>)}</select></label>
        <label>Confidence<select value={confidence} onChange={e => setConfidence(e.target.value)}><option value="all">All confidence levels</option>{['High', 'Medium', 'Low'].map(c => <option key={c}>{c}</option>)}</select></label>
        <button type="button" className="secondary" onClick={reset}>Clear filters</button>
      </div></details>
    </div>
    {market !== 'all' || confidence !== 'all' ? <div className="pf-active-filters" aria-label="Active forecast filters">{market !== 'all' ? <span>Market: {market}</span> : null}{confidence !== 'all' ? <span>Confidence: {confidence}</span> : null}<button type="button" className="link-button" onClick={reset}>Clear filters</button></div> : null}
    <p className="pf-result-count muted" role="status">{selected.length === rows.length ? `${selected.length} products` : `${selected.length} of ${rows.length} products`} · {known.length ? `${cases(known.reduce((n, r) => n + r.point!, 0))} forecast cases · ${cases(known.reduce((n, r) => n + r.target!, 0))} planning target cases` : 'No forecast available for this horizon yet'}{known.length !== selected.length ? ` · ${selected.length - known.length} unavailable` : ''}</p>
    {selected.length ? <div className="pf-comparison table-scroll" role="region" aria-label="Product production forecasts" tabIndex={0}>
      <table className="comparison-table"><caption className="sr-only">All quantities in cases. Forecast and planning target are separate from immediate agency demand.</caption><thead><tr>
        <th scope="col">Product</th><th scope="col" className="numeric">{horizon}-day forecast / range</th><th scope="col" className="numeric">Immediate demand estimate</th><th scope="col" className="numeric">Planning target</th><th scope="col" className="numeric">Prior-year period</th><th scope="col" className="numeric">90-day YoY / recent trend</th><th scope="col" className="numeric">DC guidance</th><th scope="col">Confidence / change</th>
      </tr></thead><tbody>{selected.map(r => <tr key={r.product.id}>
        <th scope="row" className="pf-product-identity"><Link href={href(r)}>{r.product.name}</Link><small>{r.product.code} · {r.product.market}</small>{r.alerts.map(a => <span className="pf-alert" key={a}>{a}</span>)}</th>
        <td className="numeric" data-label={`${horizon}-day forecast`}><strong>{cases(r.point)}</strong>{r.point !== null ? <small>{cases(r.lower)}–{cases(r.upper)} range</small> : <small>{r.note}</small>}</td>
        <td className="numeric pf-demand-cell" data-label="Immediate demand estimate"><CurrentDemandSummary row={currentDemand[r.product.id]} forecast30={horizon === 30 ? r.point : null} /></td>
        <td className="numeric" data-label="Planning target"><strong>{cases(r.target)}</strong>{r.target !== null ? <small>{Math.round(r.safetyFactor * 100)}% margin</small> : null}</td>
        <td className="numeric" data-label="Prior-year period">{cases(r.priorYear)}<small>Comparable {horizon} days</small></td>
        <td className="numeric" data-label="YoY / recent">{trend(r.yoy)}<small>Recent: {trend(r.recentTrend)}</small></td>
        <td className="numeric" data-label="DC min / max">{r.guidanceThrough ? <>{cases(r.guidanceMinimum)}–{cases(r.guidanceMaximum)}<small>Through {r.guidanceThrough}</small></> : 'Not imported'}</td>
        <td data-label="Confidence / change"><ConfidenceBadge value={r.confidence} /><small>{r.change === null ? 'No previous comparison' : `${trend(r.change)} since previous forecast`}</small></td>
      </tr>)}</tbody></table>
    </div> : <EmptyState title={rows.length ? 'No matching products' : 'No eligible products'} description={rows.length ? 'Clear the filters to see every eligible Organization product.' : 'An administrator can review Organization product selection and current distribution status.'} action={rows.length ? <button type="button" className="secondary" onClick={reset}>Clear filters</button> : undefined} />}
    <p className="muted pf-demand-method">Cases before finished inventory. Immediate demand estimates agency replenishment to MIN from overnight inventory, which can lag same-day activity; it is not added to any forecast or planning target. DC min/max is guidance, not a production limit.</p>
  </section>;
}
