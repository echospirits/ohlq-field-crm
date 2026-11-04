import { parseForecastHorizon, shift, type ProductForecast } from '../../../lib/productionForecasting/model';
import { cases, trend } from '../../../lib/productionForecasting/presentation';
import { PageHeader, SectionHeading } from '../../components/PageChrome';
import { ForecastConfidenceHelp } from './ForecastConfidenceHelp';
import type { ReactNode } from 'react';

export function ForecastDetail({ forecast: f, operationalContext }: { forecast: ProductForecast; operationalContext?: ReactNode }) {
  const horizon = parseForecastHorizon(f.horizonDays);
  const maximum = Math.max(1, ...f.history.flatMap(h => [h.actual ?? 0, h.priorYear ?? 0]), horizon === 30 ? f.point ?? 0 : 0);
  return <>
    <PageHeader title={f.product.name} meta={`${f.product.market} · ${f.product.code} · ${f.start} – ${f.end} · Forecast data through ${f.dataThrough ?? 'unavailable'}`} />
    <dl className="pf-summary metric-strip" aria-label={`${horizon}-day production planning summary`}>
      <div><dt>{horizon}-day demand forecast</dt><dd><strong>{cases(f.point)}{f.point === null ? '' : ' cases'}</strong><small>Range {cases(f.lower)}–{cases(f.upper)}</small></dd></div>
      <div><dt>Suggested planning target</dt><dd><strong>{cases(f.target)}{f.target === null ? '' : ' cases'}</strong><small>{Math.round(f.safetyFactor * 100)}% uncertainty margin</small></dd></div>
      <div><dt>Forecast confidence</dt><dd><strong>{f.confidence}</strong><small>Prior-year {horizon} days: {cases(f.priorYear)} cases</small></dd></div>
    </dl>
    <p className="muted pf-plan-note">Outbound cases before finished inventory. Location ranges are summed conservatively, not a calibrated product-level probability interval.</p>
    {f.alerts.map(a => <p className="pf-alert" key={a}>{a}</p>)}
    {operationalContext}
    <section className="pf-data-section workspace-section"><SectionHeading title="Why this forecast?" /><ul>{f.reasons.map(r => <li key={r}>{r}</li>)}</ul><p className="pf-plan-note">Trailing 90-day YoY: {trend(f.yoy)} · recent 30-day trend: {trend(f.recentTrend)}.</p><ForecastConfidenceHelp /></section>
    <section className="pf-data-section workspace-section"><SectionHeading title={`Next ${horizon} days`} description={horizon === 30 ? 'Weekly demand buckets sum to the product forecast.' : '30-day segments sum to the selected forecast; these are consecutive periods, not cumulative totals.'} />
      {f.buckets.length ? <div className="pf-data-table table-scroll" role="region" aria-label="Forecast period breakdown" tabIndex={0}><table className="comparison-table"><thead><tr><th scope="col">Period</th><th scope="col">Dates</th><th scope="col" className="numeric">Forecast cases</th></tr></thead><tbody>{f.buckets.map(b => <tr key={b.start}><th scope="row">{b.label}</th><td>{b.start} – {b.end}</td><td className="numeric">{cases(b.cases)}</td></tr>)}</tbody></table></div> : <p>Forecast breakdown unavailable until this horizon has a saved forecast with usable source history.</p>}
    </section>
    <section className="pf-data-section workspace-section"><SectionHeading title="Fulfillment locations" description={`${horizon}-day outbound cases · A-3a Dist excluded`} />
      {!f.locations.length ? <p>No verified outbound locations for this product.</p> : <>
        <div className="pf-data-table table-scroll" role="region" aria-label="Location forecast comparison" tabIndex={0}><table className="comparison-table"><thead><tr><th scope="col">Location</th><th scope="col" className="numeric">Forecast cases</th><th scope="col" className="numeric">Range</th><th scope="col" className="numeric">Trailing 30 / 60 / 90</th><th scope="col">Confidence</th><th scope="col">Data through</th></tr></thead><tbody>{f.locations.map(l => <tr key={l.location.code}><th scope="row">{l.location.name}<small>{l.location.code}</small></th><td className="numeric">{cases(l.point)}</td><td className="numeric">{cases(l.lower)}–{cases(l.upper)}</td><td className="numeric">{cases(l.signals.trailing30)} / {cases(l.signals.trailing60)} / {cases(l.signals.trailing90)}</td><td>{l.confidence}</td><td>{l.dataThrough ?? 'Unavailable'}</td></tr>)}</tbody></table></div>
        {f.locations.map(l => {
          const checks = l.backtests.find(b => b.method === l.method)?.folds ?? [];
          return <details className="pf-location-evidence compact-details" key={l.location.code}><summary>{l.location.name} · forecast evidence and historical checks</summary>
            <ul>{l.reasons.map(r => <li key={r}>{r}</li>)}</ul><p>Range method: {l.rangeMethod}.</p>
            {checks.length ? <div className="pf-backtests" role="region" aria-label={`${l.location.name} historical forecast checks`} tabIndex={0}><table><caption>Historical {horizon}-day checks for the selected method. Only data known at each start was used.</caption><thead><tr><th scope="col">Period</th><th scope="col">Forecast</th><th scope="col">Actual</th></tr></thead><tbody>{checks.map(b => <tr key={b.origin}><th scope="row">{shift(b.origin, 1)}<small>to {shift(b.origin, horizon)}</small></th><td>{cases(b.predicted)}</td><td>{cases(b.actual)}</td></tr>)}</tbody></table></div> : <p>Historical checks need more complete source history.</p>}
            <div className="pf-models">{l.backtests.filter(b => b.folds.length).map(b => <div key={b.method}><strong>{b.method}{b.method === l.method ? ' · selected' : ''}</strong><span>{b.folds.length} checks · WAPE {b.wape === null ? 'unavailable (zero actual demand)' : `${Math.round(b.wape * 100)}%`} · MASE {b.mase === null ? 'unavailable (constant scale)' : b.mase.toFixed(2)} · bias {trend(b.bias)}</span></div>)}</div>
          </details>;
        })}
      </>}
    </section>
    <section className="pf-data-section workspace-section"><SectionHeading title={horizon === 30 ? 'Actuals, prior year and forecast' : 'Actuals and prior year'} description={`Historical 30-day outbound totals. Gaps mean unavailable coverage.${horizon === 30 ? ' Forecast is the dashed bar.' : ` The ${horizon}-day forecast is shown above.`}`} />
      <div className="pf-trend-legend"><span>Actual</span><span>Prior year</span>{horizon === 30 ? <span>Forecast</span> : null}</div><div className="pf-trend">{f.history.map(h => <div className="pf-trend-row" key={h.start}><span>{h.start.slice(5)} – {h.end.slice(5)}</span><div className="pf-trend-pair" aria-hidden="true"><i style={{ width: `${Math.max(0, (h.actual ?? 0) / maximum * 100)}%` }} /><i className="pf-prior" style={{ width: `${Math.max(0, (h.priorYear ?? 0) / maximum * 100)}%` }} /></div><small>{cases(h.actual)} / {cases(h.priorYear)}</small></div>)}{horizon === 30 ? <div className="pf-trend-row"><strong>Next 30 days</strong><div aria-hidden="true" className="pf-trend-pair"><i className="pf-forecast-bar" style={{ width: `${Math.max(0, (f.point ?? 0) / maximum * 100)}%` }} /></div><strong>{cases(f.point)} cases</strong></div> : null}</div>
    </section>
    <section className="pf-data-section workspace-section"><SectionHeading title="Distribution Center guidance" description="Minimum ≈ two weeks · maximum ≈ 45 days · context, not a production cap" />
      {f.guidance.length ? <div className="pf-data-table table-scroll" role="region" aria-label="Distribution Center guidance" tabIndex={0}><table className="comparison-table"><thead><tr><th scope="col">Location</th><th scope="col" className="numeric">Minimum cases</th><th scope="col" className="numeric">Maximum cases</th><th scope="col">Observed</th></tr></thead><tbody>{f.guidance.map(g => <tr key={g.location.code}><th scope="row">{g.location.name}<small>{g.location.code}</small></th><td className="numeric">{cases(g.minimum)}</td><td className="numeric">{cases(g.maximum)}</td><td>{g.date}</td></tr>)}</tbody></table></div> : <p>No Distribution Center guidance imported for this product. Demand is based on outbound history.</p>}
    </section>
  </>;
}
