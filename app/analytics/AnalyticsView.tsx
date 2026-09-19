import Link from 'next/link';
import { EmptyState, PageHeader, SectionHeading } from '../components/PageChrome';
import { LiveFilterForm } from '../components/LiveFilterForm';
import { AnalyticsFilters } from './Filters';
import { analyticsHref, analyticsRules, groupLabels, type AnalyticsResult, type Filters, type Product } from '../../lib/analytics/model';
import './analytics.css';

export type AnalyticsViewData = AnalyticsResult & { availableProducts: Product[]; markets: string[] };
const number = (value: number | null) => value === null ? 'Unavailable' : value.toLocaleString();
export function AnalyticsView({ result: r, filters: f }: { result: AnalyticsViewData; filters: Filters }) {
  const accountLink = (group: string, patch: Partial<Filters> = {}) => analyticsHref(f, { view: 'accounts', group, page: 1, q: '', ...patch });
  const metric = (label: string, value: number | null, group?: string, note?: string) => <div className="analytics-kpi" key={label}>{group && value !== null ? <Link href={accountLink(group)}><span>{label}</span><strong>{number(value)} <small aria-hidden="true">↗</small></strong></Link> : <><span>{label}</span><strong className={value === null ? 'analytics-unavailable' : ''}>{number(value)}</strong></>}{note ? <small>{note}</small> : null}</div>;
  const pageCount = Math.max(1, Math.ceil(r.filtered.length / 40));
  const page = Math.min(f.page, pageCount);
  const visible = r.filtered.slice((page - 1) * 40, page * 40);
  const bucketSize = Math.max(1, Math.ceil(r.trend.length / 12));
  const trend = Array.from({ length: Math.ceil(r.trend.length / bucketSize) }, (_, i) => {
    const days = r.trend.slice(i * bucketSize, (i + 1) * bucketSize);
    return { start: days[0].date, end: days.at(-1)!.date, quantity: days.some(d => d.quantity === null) ? null : days.reduce((n, d) => n + d.quantity!, 0) };
  });
  const max = Math.max(1, ...trend.map(t => Math.abs(t.quantity ?? 0)));
  return <div className="analytics-page">
    <PageHeader title="Analytics" description="Sales, distribution and the account activity behind them." />
    <nav aria-label="Analytics views" className="analytics-tabs">{[['sales', 'Sales Overview'], ['accounts', 'Account Performance'], ['activity', 'Activity & Effectiveness']].map(([key, label]) => <Link key={key} href={analyticsHref(f, { view: key, page: 1 })} aria-current={f.view === key ? 'page' : undefined}>{label}</Link>)}</nav>
    <AnalyticsFilters filters={f} products={r.availableProducts} markets={r.markets} />
    <div className="analytics-coverage" role="status"><strong>{r.currentCoverage.complete ? 'Complete sales coverage' : r.currentCoverage.covered ? 'Partial sales coverage' : 'Sales coverage unavailable'}</strong><span>{r.currentCoverage.covered} of {r.currentCoverage.expected} days covered by every selected source. {r.currentCoverage.complete ? '' : 'Observed totals may understate the selected period.'}</span>
      {r.coverage.map(c => <span key={`${c.market}:${c.channel}`}>{c.market} {c.channel}: {c.days.at(-1) ? `retained data through ${c.days.at(-1)}` : 'no retained data in this window'}</span>)}
      {f.comparison !== 'none' && !r.canCompare ? <span>Comparison unavailable: both periods need complete, equal-length coverage.</span> : null}
    </div>
    {r.warnings.map(w => <p className="analytics-warning" key={w}>{w}</p>)}
    {f.view === 'sales' ? <>
      <section className="analytics-kpis" aria-label="Sales summary">
        {metric('Bottles observed', r.quantity, undefined, r.previousQuantity !== null ? `Previous: ${number(r.previousQuantity)} · change: ${number(r.quantity! - r.previousQuantity)}` : 'Net bottles, including corrections')}
        {metric('Purchasing accounts', r.groupCounts.purchasing, 'purchasing', 'Linked accounts with a positive purchase')}
        {metric('First observed purchases', r.groupCounts.new, 'new', 'First known in retained history, not first ever')}
        {metric('Lapsed buyers', r.groupCounts.lapsed, 'lapsed', `Purchased in ${analyticsRules.lapseDays} days; none in the last ${analyticsRules.recentPurchaseDays}`)}
      </section>
      {r.quantity !== null ? <section className="card"><SectionHeading title="Sales trend" description="Daily source quantities grouped for readability. Gaps mean unavailable data, not zero sales." />
        <div className="analytics-trend">{trend.map(t => <div className="analytics-trend-row" key={t.start}><span>{t.start.slice(5)}{t.end !== t.start ? ` – ${t.end.slice(5)}` : ''}</span><div aria-hidden="true" className="analytics-track">{t.quantity !== null ? <span className={t.quantity < 0 ? 'negative' : ''} style={{ width: `${Math.max(1, Math.abs(t.quantity) / max * 100)}%` }} /> : <span className="missing" />}</div><strong>{number(t.quantity)}</strong></div>)}</div>
      </section> : null}
      <section className="card"><SectionHeading title="Sales by product" description="Product distribution counts linked purchasing accounts in the selected period." actions={<a className="button secondary" href={analyticsHref(f, { group: 'all', q: '', page: 1 }, '/analytics/export') + '&report=products'}>Export products CSV</a>} />
        <nav className="analytics-pagination" aria-label="Sort products"><Link href={analyticsHref(f, { sort: 'quantity' })}>Sort by bottles</Link><Link href={analyticsHref(f, { sort: 'name' })}>Sort by name</Link></nav>
        <div className="analytics-table"><table><thead><tr><th>Product</th><th>Bottles observed</th><th>Purchasing accounts</th></tr></thead><tbody>{r.products.map(p => <tr key={p.key}><td data-label="Product"><Link href={accountLink('purchasing', { product: p.key })}>{p.name}</Link><small>{p.code} · {p.market}</small></td><td data-label="Bottles observed">{number(p.quantity)}</td><td data-label="Purchasing accounts">{p.accounts === null ? 'Unavailable' : <Link href={accountLink('purchasing', { product: p.key })}>{number(p.accounts)} accounts ↗</Link>}</td></tr>)}</tbody></table></div>
        {!r.products.length ? <EmptyState title="No matching products" description="Clear the product or market filter, or review your Organization products." action={<Link href="/analytics">Clear filters</Link>} /> : null}
      </section>
      {r.quantity !== null ? <section className="card"><SectionHeading title="Distribution & channels" /><div className="analytics-kpis">{metric('One product purchased', r.groupCounts.single, 'single')}{metric('Multiple products purchased', r.groupCounts.multiple, 'multiple')}{r.channels.map(c => metric(`${c.market} ${c.channel} bottles`, c.quantity))}</div><p className="muted">Product penetration uses the current product selection. Retail agencies and wholesale buyers are distinct account types.</p></section> : null}
    </> : null}
    {f.view === 'activity' ? <>
      <section className="analytics-kpis" aria-label="CRM activity summary">{metric('Visits logged', r.visits)}{metric('Accounts visited', r.visitedAccounts)}{metric('Visit follow-ups completed', r.followups)}{metric('Opportunities created', r.opportunitiesCreated)}{metric('Opportunities completed', r.opportunitiesCompleted)}</section>
      <section className="card"><SectionHeading title="Sales following visits" description="Association, not attribution. Same-day purchases are excluded because sales have no transaction time." /><div className="analytics-kpis">{metric('Purchased after visit', r.groupCounts.after, 'after', 'Observed within 30 days, through the selected end date')}{metric('No purchase within 30 days', r.groupCounts.without, 'without', 'Only fully observed follow-up windows')}{metric('Outcome not yet known', r.groupCounts.pending, 'pending', 'Window still open or sales history incomplete')}</div></section>
    </> : null}
    {f.view !== 'sales' ? <section className="card">
      <SectionHeading title={f.view === 'activity' ? 'Account activity & performance' : 'Sales by account'} count={r.filtered.length} description="Open an account to continue its existing sales workflow. Open work is current; dated activity uses the selected period." actions={<a className="button secondary" href={analyticsHref(f, {}, '/analytics/export')}>Export current results</a>} />
      <LiveFilterForm className="analytics-filter-grid" label="Filter account results" key={`${f.group}:${f.sort}:${f.q}`}><input type="hidden" name="page" value="1" /><label>Find an account<input type="search" name="q" defaultValue={f.q} placeholder="Name, city or ID" /></label><label>Account group<select name="group" defaultValue={f.group}>{Object.entries(groupLabels).map(([key, label]) => <option key={key} value={key} disabled={r.groupCounts[key] === null}>{label}{r.groupCounts[key] === null ? ' — unavailable' : ` (${r.groupCounts[key]})`}</option>)}</select></label><label>Sort<select name="sort" defaultValue={f.sort}><option value="quantity">Most bottles</option><option value="name">Account name</option><option value="change">Largest increase</option><option value="visits">Most visits</option></select></label></LiveFilterForm>
      {r.groupCounts[f.group] === null ? <p className="analytics-warning">This group needs more retained sales coverage. Choose another account group.</p> : null}
      {visible.length ? <div className="analytics-table"><table><thead><tr><th>Account</th><th>Bottles</th><th>Change</th><th>Products</th><th>Visits / open work</th><th>Following visit</th></tr></thead><tbody>{visible.map(a => <tr key={a.key}><td data-label="Account"><Link href={a.href}>{a.name} ↗</Link><small>{a.city ? `${a.city} · ` : ''}{a.market} · {a.channel}</small></td><td data-label="Bottles">{number(a.quantity)}</td><td data-label="Change">{number(a.change)}</td><td data-label="Products">{a.quantity === null ? 'Unavailable' : a.products.length}</td><td data-label="Visits / open work">{a.visits} visits · {a.openWork} open</td><td data-label="Following visit">{a.afterVisit ? <>{a.afterVisit}<small>{a.daysToPurchase} days · {a.purchaseKind}</small></> : a.groups.includes('without') ? 'No purchase in 30 days' : a.visits ? 'Not yet known' : 'No visit in period'}</td></tr>)}</tbody></table></div> : <EmptyState title="No matching accounts" description={r.currentCoverage.covered ? 'No accounts match this group and search. Try another group or clear the search.' : 'Sales history is unavailable for this selection. CRM activity may still be available; try All accounts or a recent date range.'} action={<Link href={analyticsHref(f, { group: 'all', q: '', page: 1 })}>Clear account filters</Link>} />}
      <nav className="analytics-pagination" aria-label="Account results pages">{page > 1 ? <Link href={analyticsHref(f, { page: page - 1 })}>← Previous</Link> : null}<span>Page {page} of {pageCount} · {r.filtered.length} results</span>{page < pageCount ? <Link href={analyticsHref(f, { page: page + 1 })}>Next →</Link> : null}</nav>
    </section> : null}
    <details className="card analytics-definitions"><summary>Sources, definitions & limitations</summary>
      <p>Ohio imports are daily sales despite the Annual Sales report name. Revenue is unavailable. Net bottles retain corrections; positive purchase observations determine distribution. Observed totals include each source’s available days; coverage counts days when every selected source is present. Agency wholesale totals are never added to account wholesale sales.</p>
      <p>History retention is unchanged. Last 7 Days, Last 30 Days and Last 12 Months end yesterday; to-date presets include today, which may not yet be imported. First observed purchases refer only to the retained observation window. Lapsed buyers require complete {analyticsRules.lapseDays}-day coverage, a purchase in that window and none in the last {analyticsRules.recentPurchaseDays} days. No recent visit means none in {analyticsRules.recentVisitDays} days.</p>
      <p>Visits and follow-ups are account-level, not product-specific. Product filters select subsequent sales. Follow-ups completed counts tasks originating as visit follow-ups; opportunities completed counts resolved or converted opportunities. Communication reach is unavailable.</p>
      <p>A purchase following any selected visit within {analyticsRules.followingVisitDays} days places the account in Purchased after visit. Otherwise, every selected visit needs a complete 30-day observation window to classify no subsequent purchase. The first observed qualifying relationship supplies days-to-purchase. Sales dates and CRM calendar dates use the source market timezone (Ohio: Eastern).</p>
      <p>All Markets combines only sources with comparable quantity units. Unsupported sources and missing import days are disclosed. Counts exclude ambiguous or unlinked sales identities. Exports include all filtered results, not just the visible page.</p>
      <Link href="/admin/data-status">View Data Status</Link>
    </details>
  </div>;
}
