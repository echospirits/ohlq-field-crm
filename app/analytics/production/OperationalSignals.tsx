import Link from 'next/link';
import type { getDeliveryAvailabilitySignals } from '../../../lib/productionForecasting/operationalSignals/persistence';
import type { getCurrentDemandSignals } from '../../../lib/productionForecasting/operationalSignals/demandIngestion';
import { cases } from '../../../lib/productionForecasting/presentation';

export type DemandRow = Awaited<ReturnType<typeof getCurrentDemandSignals>>['rows'][number];
type DeliveryData = Awaited<ReturnType<typeof getDeliveryAvailabilitySignals>>;
const demandIssues: Record<string, string> = {
  SOURCE_INELIGIBLE: 'OPS identifies this item as A-3a Dist or inactive. It is excluded from immediate-demand totals.',
  STALE_SOURCE: 'The latest published coverage is older than this snapshot day. The last successful estimate is retained.',
  MISSING_CASE_PACK: 'Bottles per case could not be verified. No case estimate is calculated.',
  MISSING_QUANTITY: 'An agency MIN or inventory quantity is missing. Missing values are not zero.',
  NEGATIVE_INVENTORY: 'OPS reports negative agency inventory. This needs review before estimating cases.',
  INVALID_QUANTITY: 'An agency quantity or case unit could not be verified.',
  CONFLICTING_AGENCY_ROWS: 'OPS returned conflicting rows for an agency. No combined estimate is shown.',
  INCOMPLETE_SOURCE: 'The source coverage counts do not agree with the returned agency rows.',
  AUTH_FAILED: 'The OPS connection could not sign in. An administrator can review the saved connection.',
};
export function operationalTime(value: string | null, timezone = 'America/New_York') {
  return value ? new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value)) : 'Not yet observed';
}
export function CurrentDemandSummary({ row, forecast30, expanded = false }: { row?: DemandRow; forecast30?: number | null; expanded?: boolean }) {
  const available = row?.demandCases !== null && row?.demandCases !== undefined;
  const current = available && !row?.stale && row?.status === 'AVAILABLE' && !row?.retained;
  const significant = current && forecast30 !== null && forecast30 !== undefined && forecast30 > 0 && row.demandCases! / forecast30 >= .8;
  return <div className={`pf-current-demand${significant ? ' pf-significant-demand' : ''}`}>
    <strong>{current ? `${cases(row.demandCases)} cases` : available && row?.stale ? 'Stale estimate' : 'Unavailable'}</strong>
    {!current && available ? <small>Last estimate: {cases(row.demandCases)} cases</small> : null}
    {expanded || available ? <small>{current && row.demandCases === 0 ? 'No agency replenishment gap' : expanded ? 'Agency replenishment to MIN' : 'To agency MIN'}</small> : null}
    {significant ? <small>{Math.round(row.demandCases! / forecast30! * 100)}% of the 30-day forecast · separate estimate</small> : null}
    {expanded ? <>
      {!current && row?.reason ? <p className="muted">{demandIssues[row.reason] ?? 'The latest source check did not provide a complete estimate. The last successful observation is retained where available.'}</p> : null}
      {available ? <p>GPT: {cases(row.byWarehouse.GPT)} · GRN: {cases(row.byWarehouse.GRN)}{(row.byWarehouse.UNASSIGNED ?? 0) > 0 ? ` · Unassigned: ${cases(row.byWarehouse.UNASSIGNED)}` : ''}</p> : row?.reason === 'SOURCE_INELIGIBLE' ? null : <p>Warehouse demand is unavailable until a complete source check succeeds.</p>}
      <p>Last successful observation: {operationalTime(row?.sourceObservedAt ?? null)}</p>
      <p>Coverage source as of: {row?.sourceUpdatedAt ? operationalTime(row.sourceUpdatedAt) : 'Source refresh time could not be verified'}</p>
      {row?.checkedAt && (!current || row.retained) ? <p>Latest attempt: {operationalTime(row.checkedAt)} · {row.status.toLowerCase()}</p> : null}
      <p className="muted">Only MIN agencies are included. Each agency’s bottle gap is rounded up to whole cases before summing. Agency inventory may lag same-day shipments and receipts; in-transit stock is not independently reconciled. This estimate is separate from the statistical forecast.</p>
    </> : <small>{row?.sourceUpdatedAt ? `Source as of ${operationalTime(row.sourceUpdatedAt)}` : row?.sourceObservedAt ? `Observed ${operationalTime(row.sourceObservedAt)} · source refresh time unverified` : row?.reason === 'SOURCE_INELIGIBLE' ? 'Excluded by OPS status' : row?.status === 'FAILED' ? 'Latest check failed' : row?.status === 'UNAVAILABLE' ? 'Source unavailable' : 'Awaiting morning check'}</small>}
  </div>;
}
export function DeliveryAvailability({ data, showSetup = false, now = new Date() }: { data: DeliveryData; showSetup?: boolean; now?: Date }) {
  return <section className="pf-operational-section" aria-labelledby="delivery-availability-heading">
    <div className="pf-operational-heading"><h2 id="delivery-availability-heading">OHLQ Delivery Availability</h2>{showSetup ? <Link href="/analytics/production/settings">Configure OpenDock</Link> : null}</div>
    <p className="muted">Next available LTL delivery · calendar days from the observation date.</p>
    <div className="pf-delivery-grid">{data.warehouses.map(w => {
      const observation = w.latestObservation;
      const passed = observation?.earliestAvailableAt ? Date.parse(observation.earliestAvailableAt) <= now.getTime() : false;
      const failed = w.latestCheck && !['SUCCESS', 'NO_AVAILABILITY'].includes(w.latestCheck.status);
      return <article key={w.locationCode} className="pf-delivery-location">
        <h3>{w.locationCode} <span>{w.locationName}</span></h3>
        {observation?.status === 'SUCCESS' && observation.earliestAvailableAt ? <>
          <p><span>{w.freshness === 'current' && !passed ? 'Next available' : 'Last observed availability'}: </span><strong>{operationalTime(observation.earliestAvailableAt, w.timezone)}</strong></p>
          <p><strong>{observation.calendarDays} calendar days out</strong>{observation.businessDays !== null ? ` · ${observation.businessDays} operating business days` : ''}{w.freshness !== 'current' ? ' · stale observation' : ''}</p>
          {passed ? <p className="muted">This observed slot has passed. The next morning check will update availability.</p> : null}
        </> : observation?.status === 'NO_AVAILABILITY' ? <p>{w.freshness === 'current' ? 'No appointments' : 'Last observed: no appointments'} in the checked range through {operationalTime(observation.checkedThrough, w.timezone)}{w.freshness !== 'current' ? ' · stale observation' : ''}.</p> : <p>{w.configured ? 'Awaiting a successful OpenDock check.' : 'OpenDock is not configured.'}</p>}
        {w.baseline.typicalDays !== null ? <p>{w.baseline.classification ?? 'Comparison unavailable'}<small>Typical {w.baseline.stage === 'PRIOR_YEAR_SEASONAL' ? 'this time of year' : 'for the available history'}: {cases(w.baseline.typicalDays)} days · {w.baseline.sampleDays} observations</small></p> : <p className="muted">Insufficient history for a typical lead time.</p>}
        <small>Last successful check: {operationalTime(w.lastSuccessfulCheckAt, w.timezone)}</small>
        {failed ? <p className="pf-warning" role="status">Latest check did not succeed ({operationalTime(w.latestCheck!.attemptedAt, w.timezone)}). The last successful observation is retained.</p> : null}
        <details className="compact-details"><summary>{w.locationCode} availability history</summary>
          <p className="muted">Observed daily. A failed check never means zero days. Seasonal comparisons need at least 14 distinct historical days; nearby-season and trailing 90-day history provide fallbacks. Differences within one day or 20% of typical stay about average.</p>
          {w.history.length ? <div className="pf-operational-history" role="region" aria-label={`${w.locationCode} daily delivery history`} tabIndex={0}><table><thead><tr><th scope="col">Observed</th><th scope="col">Days out</th><th scope="col">Next available</th></tr></thead><tbody>{w.history.map(o => <tr key={o.id}><td>{o.observedOn}</td><td>{o.calendarDays ?? 'No slot in range'}</td><td>{o.earliestAvailableAt ? operationalTime(o.earliestAvailableAt, w.timezone) : 'None in checked range'}</td></tr>)}</tbody></table></div> : <p>No historical observations yet.</p>}
        </details>
      </article>;
    })}</div>
  </section>;
}
