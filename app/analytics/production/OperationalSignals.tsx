import Link from 'next/link';
import type { getDeliveryAvailabilitySignals } from '../../../lib/productionForecasting/operationalSignals/persistence';
import type { getCurrentDemandSignals } from '../../../lib/productionForecasting/operationalSignals/demandIngestion';
import type { WarehouseBalanceSignal } from '../../../lib/productionForecasting/operationalSignals/warehouseBalance';
import { caseBalance, caseQuantity, cases } from '../../../lib/productionForecasting/presentation';

export type DemandRow = Awaited<ReturnType<typeof getCurrentDemandSignals>>['rows'][number];
export type WarehouseBalanceRow = WarehouseBalanceSignal;

export function WarehousePairHeader() {
  return <span className="pf-warehouse-pair-header" aria-label="Groveport, then Green"><span>GPT</span><span aria-hidden="true">|</span><span>GRN</span></span>;
}

/** The same warehouse order is used in every operational comparison. */
export function WarehousePair({ values, signed = false }: { values: { GPT: number | null; GRN: number | null }; signed?: boolean }) {
  return <span className="pf-warehouse-pair">{(['GPT', 'GRN'] as const).map((warehouse, index) => {
    const raw = values[warehouse], value = raw !== null && Number.isFinite(raw) ? raw : null;
    const displayed = value === null ? '—' : signed ? caseBalance(value) : caseQuantity(value);
    return <span className="pf-warehouse-pair-part" key={warehouse}>{index ? <span className="pf-warehouse-separator" aria-hidden="true">|</span> : null}<span className={signed && value !== null && value < 0 ? 'pf-warehouse-shortfall' : undefined}><span className="sr-only">{warehouse}: {value === null ? 'Unavailable' : ''}</span><span aria-hidden={value === null ? true : undefined}>{displayed}</span>{value !== null ? <span className="sr-only"> cases{signed ? value < 0 ? ' shortfall' : value > 0 ? ' excess' : ' balanced' : ''}</span> : null}</span></span>;
  })}</span>;
}

const currentDemand = (row?: DemandRow) => row?.demandCases !== null && row?.demandCases !== undefined && !row.stale && row.status === 'AVAILABLE' && !row.retained;
const missingWarehouses = (values: { GPT: number | null; GRN: number | null }) => (['GPT', 'GRN'] as const).filter(warehouse => values[warehouse] === null);

export function WarehouseInventorySummary({ row, expanded = false }: { row?: WarehouseBalanceRow; expanded?: boolean }) {
  const inventory = row?.inventory;
  const currentAt = (warehouse: 'GPT' | 'GRN') => inventory?.warehouses[warehouse].status === 'AVAILABLE' && !inventory.warehouses[warehouse].stale && !inventory.warehouses[warehouse].retained;
  const values = { GPT: currentAt('GPT') ? inventory!.byWarehouse.GPT : null, GRN: currentAt('GRN') ? inventory!.byWarehouse.GRN : null };
  const missing = missingWarehouses(values);
  const issue = missing.map(warehouse => `${warehouse} ${inventory?.warehouses[warehouse].stale && inventory.byWarehouse[warehouse] !== null ? 'stale' : 'unavailable'}`).join(' · ');
  const dates = (['GPT', 'GRN'] as const).flatMap(warehouse => inventory?.warehouses[warehouse].sourceBusinessDate ? [{ warehouse, date: inventory.warehouses[warehouse].sourceBusinessDate }] : []);
  const businessDates = dates.length === 2 && dates[0].date === dates[1].date ? dates[0].date : dates.length ? dates.map(({ warehouse, date }) => `${warehouse} ${date}`).join(' · ') : inventory?.sourceBusinessDate;
  return <div className="pf-warehouse-summary">
    <span className="pf-warehouse-mobile-heading" aria-hidden="true"><WarehousePairHeader /></span>
    <strong><WarehousePair values={values} /></strong>
    {missing.length ? <small>{!inventory ? 'Inventory unavailable' : issue}</small> : null}
    {businessDates ? <small>As of {businessDates}</small> : null}
    {inventory?.sourceObservedAt ? <small>Observed {operationalTime(inventory.sourceObservedAt)}</small> : <small>Awaiting DC Inventory report</small>}
    {expanded ? <><p>Stock Quantity + Picked Quantity; Rstock is excluded.</p><p>Report refresh time: {inventory?.sourceUpdatedAt ? operationalTime(inventory.sourceUpdatedAt) : 'Not provided by the source'}</p>{missing.length && inventory?.retained ? <p>Last observed inventory: GPT {caseQuantity(inventory.byWarehouse.GPT)} · GRN {caseQuantity(inventory.byWarehouse.GRN)} cases. Retained amounts are not used for a current balance.</p> : null}</> : null}
  </div>;
}

export function WarehouseBalanceSummary({ row }: { row?: WarehouseBalanceRow }) {
  const values = {
    GPT: row?.warehouses.GPT.status === 'AVAILABLE' ? row.warehouses.GPT.balanceCases : null,
    GRN: row?.warehouses.GRN.status === 'AVAILABLE' ? row.warehouses.GRN.balanceCases : null,
  };
  const missing = missingWarehouses(values);
  const issue = missing.map(warehouse => `${warehouse} ${row?.warehouses[warehouse].status === 'STALE' ? 'stale' : 'unavailable'}`).join(' · ');
  return <div className="pf-warehouse-summary">
    <span className="pf-warehouse-mobile-heading" aria-hidden="true"><WarehousePairHeader /></span>
    <strong><WarehousePair values={values} signed /></strong>
    {missing.length ? <small>{row ? issue : 'Balance unavailable'}</small> : null}
  </div>;
}

export function WarehouseBalanceDetail({ row }: { row?: WarehouseBalanceRow }) {
  return <div className="pf-warehouse-detail table-scroll" role="region" aria-label="Warehouse demand and inventory comparison" tabIndex={0}><table className="comparison-table"><caption>Cases · balance is inventory minus immediate demand</caption><thead><tr><th scope="col">Immediate demand estimate<WarehousePairHeader /></th><th scope="col">Warehouse inventory<WarehousePairHeader /></th><th scope="col">Warehouse balance<WarehousePairHeader /></th></tr></thead><tbody><tr><td><CurrentDemandSummary row={row?.demand} /></td><td><WarehouseInventorySummary row={row} /></td><td><WarehouseBalanceSummary row={row} /></td></tr></tbody></table></div>;
}
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
  const current = currentDemand(row);
  const significant = current && forecast30 !== null && forecast30 !== undefined && forecast30 > 0 && row!.demandCases! / forecast30 >= .8;
  return <div className={`pf-current-demand${significant ? ' pf-significant-demand' : ''}`}>
    {!expanded ? <span className="pf-warehouse-mobile-heading" aria-hidden="true"><WarehousePairHeader /></span> : null}
    <strong>{expanded ? current ? `${cases(row!.demandCases)} cases` : available && row?.stale ? 'Stale estimate' : 'Unavailable' : <WarehousePair values={current ? row!.byWarehouse : { GPT: null, GRN: null }} />}</strong>
    {!expanded && !current ? <small>{available && row?.stale ? 'Stale estimate' : 'Demand unavailable'}</small> : null}
    {!current && available ? <small>Last estimate: {cases(row.demandCases)} cases</small> : null}
    {expanded || available ? <small>{current && row!.demandCases === 0 ? 'No agency replenishment gap' : expanded ? 'Agency replenishment to MIN' : 'To agency MIN'}</small> : null}
    {significant ? <small>{Math.round(row!.demandCases! / forecast30! * 100)}% of the 30-day forecast · separate estimate</small> : null}
    {!expanded && (row?.byWarehouse.UNASSIGNED ?? 0) > 0 ? <small>{current ? 'Unassigned' : 'Last unassigned'}: {cases(row!.byWarehouse.UNASSIGNED)} cases</small> : null}
    {expanded ? <>
      {!current && row?.reason ? <p className="muted">{demandIssues[row.reason] ?? 'The latest source check did not provide a complete estimate. The last successful observation is retained where available.'}</p> : null}
      {available ? <p>GPT: {cases(row.byWarehouse.GPT)} · GRN: {cases(row.byWarehouse.GRN)}{(row.byWarehouse.UNASSIGNED ?? 0) > 0 ? ` · Unassigned: ${cases(row.byWarehouse.UNASSIGNED)}` : ''}</p> : row?.reason === 'SOURCE_INELIGIBLE' ? null : <p>Warehouse demand is unavailable until a complete source check succeeds.</p>}
      <p>Last successful observation: {operationalTime(row?.sourceObservedAt ?? null)}</p>
      <p>Coverage source as of: {row?.sourceUpdatedAt ? operationalTime(row.sourceUpdatedAt) : 'Source refresh time could not be verified'}</p>
      {row?.checkedAt && (!current || row.retained) ? <p>Latest attempt: {operationalTime(row.checkedAt)} · {row.status.toLowerCase()}</p> : null}
      <p className="muted">Overnight agency inventory may lag same-day shipments and receipts; in-transit stock is not independently reconciled.</p><details className="compact-details"><summary>Agency replenishment method and limits</summary><p className="muted">Only MIN agencies are included. Each agency’s bottle gap is rounded up to whole cases before summing. This estimate is separate from the statistical forecast.</p></details>
    </> : <small>{row?.sourceUpdatedAt ? `Source as of ${operationalTime(row.sourceUpdatedAt)}` : row?.sourceObservedAt ? `Observed ${operationalTime(row.sourceObservedAt)} · source refresh time unverified` : row?.reason === 'SOURCE_INELIGIBLE' ? 'Excluded by OPS status' : row?.status === 'FAILED' ? 'Latest check failed' : row?.status === 'UNAVAILABLE' ? 'Source unavailable' : 'Awaiting morning check'}</small>}
  </div>;
}
export function DeliveryAvailability({ data, showSetup = false, now = new Date() }: { data: DeliveryData; showSetup?: boolean; now?: Date }) {
  const firstCheck = data.warehouses[0]?.lastSuccessfulCheckAt;
  const checkTimezone = data.warehouses[0]?.timezone;
  const sharedCheck = firstCheck && data.warehouses.every(w => w.lastSuccessfulCheckAt === firstCheck && w.timezone === checkTimezone) ? firstCheck : null;
  const allBaselinesUnknown = data.warehouses.length > 0 && data.warehouses.every(w => w.baseline.typicalDays === null);
  return <section className="pf-operational-section" aria-labelledby="delivery-availability-heading">
    <div className="pf-operational-heading"><h2 id="delivery-availability-heading">OHLQ Delivery Availability</h2>{showSetup ? <Link href="/analytics/production/settings">Configure OpenDock</Link> : null}</div>
    <div className="pf-delivery-comparison table-scroll" role="region" aria-label="Warehouse LTL delivery availability" tabIndex={0}><table className="comparison-table"><caption className="sr-only">Next available LTL delivery. Calendar days are counted from the observation date.</caption><thead><tr><th scope="col">Warehouse</th><th scope="col">Next LTL delivery</th><th scope="col" className="numeric">Calendar days out</th></tr></thead><tbody>{data.warehouses.map(w => {
      const observation = w.latestObservation;
      const passed = observation?.earliestAvailableAt ? Date.parse(observation.earliestAvailableAt) <= now.getTime() : false;
      const failed = w.latestCheck && !['SUCCESS', 'NO_AVAILABILITY'].includes(w.latestCheck.status);
      return <tr key={w.locationCode}>
        <th scope="row"><strong>{w.locationCode}</strong><small>{w.locationName}</small></th>
        <td className="pf-delivery-slot">
          {observation?.status === 'SUCCESS' && observation.earliestAvailableAt ? <><span className="sr-only">{w.freshness === 'current' && !passed ? 'Next available' : 'Last observed availability'}: </span><strong>{operationalTime(observation.earliestAvailableAt, w.timezone)}</strong>{w.freshness !== 'current' || passed ? <small className="pf-delivery-stale">Last observed availability · {w.freshness !== 'current' ? 'stale observation' : 'slot has passed'}</small> : null}</> : observation?.status === 'NO_AVAILABILITY' ? <span>{w.freshness === 'current' ? 'No appointments' : 'Last observed: no appointments'} in the checked range through {operationalTime(observation.checkedThrough, w.timezone)}{w.freshness !== 'current' ? ' · stale observation' : ''}.</span> : <span>{w.configured ? 'Awaiting a successful OpenDock check.' : 'OpenDock is not configured.'}</span>}
          {!sharedCheck ? <small className="pf-delivery-checked">Last successful check: {operationalTime(w.lastSuccessfulCheckAt, w.timezone)}</small> : null}
          {passed ? <small className="pf-delivery-stale">This observed slot has passed. The next morning check will update availability.</small> : null}
          {failed ? <p className="pf-warning" role="status">Latest check did not succeed ({operationalTime(w.latestCheck!.attemptedAt, w.timezone)}). The last successful observation is retained.</p> : null}
        </td>
        <td className="numeric pf-delivery-lead">{observation?.status === 'SUCCESS' && observation.earliestAvailableAt ? <><strong>{observation.calendarDays}<span className="sr-only"> calendar days out{w.freshness !== 'current' ? ' · stale observation' : ''}</span></strong>{observation.businessDays !== null ? <small>{observation.businessDays} operating business days</small> : null}</> : <span>Unavailable</span>}{!allBaselinesUnknown ? w.baseline.typicalDays !== null ? <small>{w.baseline.classification ?? 'Comparison unavailable'} · typical {cases(w.baseline.typicalDays)} days · {w.baseline.sampleDays} observations</small> : <small>Insufficient history for a typical lead time.</small> : null}</td>
      </tr>;
    })}</tbody></table></div>
    {sharedCheck || allBaselinesUnknown ? <div className="pf-delivery-freshness">{sharedCheck ? <span>Last successful check: {operationalTime(sharedCheck, checkTimezone)}</span> : null}{allBaselinesUnknown ? <span>Typical lead time: unavailable<span className="sr-only">. Insufficient history for a typical lead time{data.warehouses.length > 1 ? ' at either warehouse' : ''}.</span></span> : null}</div> : null}
    <details className="compact-details pf-delivery-method"><summary>Availability history and comparison method</summary>
      <p>Availability is an observed slot, not a booking. Lead times use calendar days from the observation date. A failed check never means zero days. Seasonal comparisons need at least 14 distinct historical days; nearby-season and trailing 90-day history provide fallbacks. Differences within one day or 20% of typical stay about average.</p>
      {data.warehouses.map(w => <section key={w.locationCode}><h3>{w.locationCode} availability history</h3>{w.history.length ? <div className="pf-operational-history" role="region" aria-label={`${w.locationCode} daily delivery history`} tabIndex={0}><table><thead><tr><th scope="col">Observed</th><th scope="col" className="numeric">Days out</th><th scope="col">Next available</th></tr></thead><tbody>{w.history.map(o => <tr key={o.id}><td>{o.observedOn}</td><td className="numeric">{o.calendarDays ?? 'No slot in range'}</td><td>{o.earliestAvailableAt ? operationalTime(o.earliestAvailableAt, w.timezone) : 'None in checked range'}</td></tr>)}</tbody></table></div> : <p>No historical observations yet.</p>}</section>)}
    </details>
  </section>;
}
