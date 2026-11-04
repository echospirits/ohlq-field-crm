import type { AgencyMarketProfile, AgencyProductMarketFit } from '@prisma/client';
import { formatDateOnly } from '../../lib/dateTime';
import { contextSourceIsStale, readCategoryMix, type StoreContext } from '../../lib/agencyStoreContext';
import { AgencyStoreContextForm } from './AgencyStoreContextForm';

const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 0 });
const money = (value: number | null) => value === null ? 'Unknown' : value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const percent = (value: number) => `${Math.round(value * 100)}%`;
const label = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
const confidence = (value: string) => value === 'INSUFFICIENT_DATA' ? 'Insufficient data' : `${label(value)} confidence`;

function ProductFitRows({ fits }: { fits: AgencyProductMarketFit[] }) {
  return <div className="table-scroll" role="region" aria-label="Product fit comparison" tabIndex={0}><table className="comparison-table product-fit-comparison-table"><thead><tr><th scope="col">Product</th><th scope="col">Fit</th><th scope="col" className="numeric">Price / 750ml</th><th scope="col" className="numeric">Peer buyers</th><th scope="col">Evidence</th></tr></thead><tbody>{fits.map((fit) => {
    const reasons = Array.isArray(fit.reasons) ? fit.reasons.filter((reason): reason is string => typeof reason === 'string') : [];
    return <tr key={fit.id}>
      <th scope="row" data-label="Product"><strong>{fit.itemName}</strong><small>{fit.category ? label(fit.category) : 'Category unknown'}</small></th>
      <td data-label="Fit"><strong>{fit.confidence === 'INSUFFICIENT_DATA' ? 'Collecting evidence' : `${fit.fitScore}/100`}</strong><small>{label(fit.recommendationType)} · {confidence(fit.confidence)}</small></td>
      <td className="numeric" data-label="Price / 750ml">{money(fit.targetPrice750)}</td><td className="numeric" data-label="Peer buyers">{fit.peerBuyerCount}</td>
      <td data-label="Evidence">{reasons[0] ? <p className="intelligence-key-reason">{reasons[0]}</p> : null}<small>Through {formatDateOnly(fit.asOfDate)}</small>{reasons.length > 1 ? <details className="compact-details"><summary>More evidence ({reasons.length - 1})</summary><ul>{reasons.slice(1).map((reason, index) => <li key={index}>{reason}</li>)}</ul></details> : null}</td>
    </tr>;
  })}</tbody></table></div>;
}

function Evidence({ source }: { source: StoreContext['store']['source'] }) {
  if (!source.name) return <small className="muted">Not yet confirmed.</small>;
  return <small className="store-evidence">Source: {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.name}</a> : source.name} · Observed {formatDateOnly(source.observedOn)}{contextSourceIsStale(source.observedOn) ? ' · Review due (over 6 months old)' : ''}</small>;
}

export function AgencyStoreSummary({ context, market, d8Permit, county }: { context: StoreContext | null; market: AgencyMarketProfile | null; d8Permit: boolean; county: string | null }) {
  const category = readCategoryMix(market?.categoryMix).filter(([name]) => name !== 'UNKNOWN')[0]?.[0];
  return <section className="store-quick-context account-workspace-section" aria-label="Store at a glance">
    <dl>
      <div><dt>Store</dt><dd>{context?.store.format !== 'Unknown' && context?.store.format || 'Format unconfirmed'}</dd></div>
      <div><dt>Ownership</dt><dd>{context?.store.chainName || (context?.store.ownership !== 'Unknown' && context?.store.ownership) || 'Unconfirmed'}</dd></div>
      <div><dt>Area</dt><dd>{context?.area.neighborhood || (county ? /county$/i.test(county.trim()) ? county : `${county} County` : 'Unconfirmed')}</dd></div>
      <div><dt>Retail strength</dt><dd>{category ? label(category) : 'Not yet available'}</dd></div>
      <div><dt>Tasting permit</dt><dd>{d8Permit ? 'D8 on record' : 'No D8 on record'}</dd></div>
    </dl>
    <a href="#store-intelligence">{context ? 'Store details & evidence' : 'Add store context'}</a>
    {market ? <small className="muted">Retail through {formatDateOnly(market.asOfDate)} · {market.observedDayCount}/30 days observed</small> : null}
  </section>;
}

export function AgencyStoreIntelligence({ agencyId, context }: { agencyId: string; context: StoreContext | null }) {
  return <section id="store-intelligence" className="retail-intelligence-section" aria-labelledby="store-context-heading">
      <div className="store-intelligence-body">
        <h3 id="store-context-heading">Store & neighborhood</h3>
        {!context ? <p className="muted">Store and area context have not been recorded yet.</p> : <div className="store-context-sections">
          <section><h3>Store & buying decisions</h3><dl className="store-facts">
            <div><dt>Ownership</dt><dd>{context.store.ownership}{context.store.chainName ? ` · ${context.store.chainName}` : ''}</dd></div>
            <div><dt>Format</dt><dd>{context.store.format}</dd></div><div><dt>Buying decisions</dt><dd>{context.store.buying}</dd></div>
          </dl>{context.store.notes ? <p className="preserve-lines">{context.store.notes}</p> : null}<Evidence source={context.store.source} /></section>
          <section><h3>Neighborhood & nearby businesses</h3><dl className="store-facts"><div><dt>Setting</dt><dd>{context.area.setting}</dd></div><div><dt>Neighborhood</dt><dd>{context.area.neighborhood || 'Unconfirmed'}</dd></div><div><dt>Nearby mix</dt><dd>{context.area.nearby.join(' · ') || 'Not researched'}</dd></div></dl>{context.area.notes ? <p className="preserve-lines">{context.area.notes}</p> : null}<Evidence source={context.area.source} /></section>
          <section><h3>Area demographics</h3>{context.demographics.medianHouseholdIncome !== null || context.demographics.adultPopulation !== null ? <>
            <p>{context.demographics.geography} · {context.demographics.year}</p><dl className="store-facts"><div><dt>Median household income</dt><dd>{money(context.demographics.medianHouseholdIncome)}</dd></div><div><dt>Adults (18+)</dt><dd>{context.demographics.adultPopulation === null ? 'Unknown' : number(context.demographics.adultPopulation)}</dd></div></dl><small className="muted">Area statistics; not a measurement of this store’s customers.</small>
          </> : <p className="muted">No sourced area statistics yet.</p>}<Evidence source={context.demographics.source} /></section>
        </div>}
        <AgencyStoreContextForm agencyId={agencyId} context={context} />
      </div>
    </section>;
}

export function AgencyRetailMarketIntelligence({ market, fits }: { market: AgencyMarketProfile | null; fits: AgencyProductMarketFit[] }) {
  const categories = readCategoryMix(market?.categoryMix);
  const stale = market ? Date.now() - market.asOfDate.getTime() > 7 * 86_400_000 : false;
  return <section id="retail-market" className="retail-intelligence-section retail-market-grid" aria-label="Retail market and product fit">
      <div className="store-intelligence-body retail-market-evidence">
        {market ? <>
          <div className="section-heading"><h3>What sells here</h3><small>Through {formatDateOnly(market.asOfDate)}{stale ? ' · Data is over 7 days old' : ''}</small></div>
          <p className="muted">{market.observedDayCount} of 30 days observed · {confidence(market.confidence)}. Category, price, and Ohio-brand signals exclude your portfolio. Volumes are 750ml equivalents.</p>
          <dl className="store-market-metrics"><div><dt>Other-brand retail volume</dt><dd>{market.observedDayCount ? number(market.nonTenantRetailEqBottles) : 'Unavailable'}</dd></div><div><dt>Typical price / 750ml</dt><dd>{money(market.medianPrice750)}</dd></div><div><dt>Known Ohio-brand share</dt><dd>{market.nonTenantRetailEqBottles > 0 ? percent(market.localShare) : 'Unavailable'}</dd></div><div><dt>Price coverage</dt><dd>{market.nonTenantRetailEqBottles > 0 ? percent(market.priceCoverage) : 'Unavailable'}</dd></div></dl>
          {categories.length ? <ul className="store-category-list" aria-label="Category retail mix">{categories.map(([name, volume]) => <li key={name}><span>{label(name)}</span><meter aria-label={`${label(name)} share`} min={0} max={market.nonTenantRetailEqBottles || 1} value={volume} /><span>{number(volume)} · {percent(volume / (market.nonTenantRetailEqBottles || 1))}</span></li>)}</ul> : <p className="muted">No category evidence in the observed window.</p>}
        </> : <><h3>What sells here</h3><p className="muted">Retail market data is not available yet. It is prepared after a completed sales import.</p></>}
      </div>
      <div className="store-intelligence-body retail-product-fit">
        <h3>Products to investigate</h3><p className="muted">Exploratory fit · not a success probability. Store context is excluded from scoring.</p>
        {fits.length ? <>
          <ProductFitRows fits={fits.slice(0, 5)} />
          {fits.length > 5 ? <details className="store-fit-more"><summary>More products ({fits.length - 5})</summary><ProductFitRows fits={fits.slice(5)} /></details> : null}
        </> : <p className="muted">No eligible store products have product-fit evidence yet. Delisted and distillery-only items are excluded.</p>}
      </div>
    </section>;
}
