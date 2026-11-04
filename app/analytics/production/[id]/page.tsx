import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUserSession } from '../../../../lib/auth';
import { requireProductionForecastContext } from '../../../../lib/productionForecasting/access';
import { getProductionProduct } from '../../../../lib/productionForecasting/service';
import { parseForecastHorizon } from '../../../../lib/productionForecasting/model';
import { cases } from '../../../../lib/productionForecasting/presentation';
import { ForecastDetail } from '../ForecastDetail';
import { ForecastHorizonSelector } from '../ForecastHorizonSelector';
import { getDeliveryAvailabilitySignals } from '../../../../lib/productionForecasting/operationalSignals/persistence';
import { getCurrentDemandSignals, getCurrentDemandHistory } from '../../../../lib/productionForecasting/operationalSignals/demandIngestion';
import { CurrentDemandSummary, DeliveryAvailability, operationalTime } from '../OperationalSignals';
import '../forecast.css';
import '../operational-signals.css';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Production forecast detail' };
export default async function ProductionProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requireUserSession();
  const query = await searchParams;
  const context = await requireProductionForecastContext(user, typeof query.organization === 'string' ? query.organization : undefined);
  if (!context.organization) notFound();
  const organizationId = context.organization.id;
  const { id } = await params;
  const horizon = parseForecastHorizon(query.horizon);
  const result = await getProductionProduct(organizationId, id, undefined, horizon);
  if (!result) notFound();
  const [delivery, demand, demandHistory] = await Promise.all([getDeliveryAvailabilitySignals(organizationId), getCurrentDemandSignals(organizationId), getCurrentDemandHistory(organizationId, id)]);
  const operationalContext = <>
    <section className="pf-operational-section"><h2>Current Demand</h2><CurrentDemandSummary row={demand.rows.find(row => row.productId === id)} forecast30={horizon === 30 ? result.forecast?.point : null} expanded />
      <details className="compact-details"><summary>Recent agency demand history</summary>{demandHistory.length ? <div className="pf-operational-history" role="region" aria-label="Daily agency demand history" tabIndex={0}><table><thead><tr><th scope="col">Observation</th><th scope="col">Estimated cases</th><th scope="col">GPT / GRN</th></tr></thead><tbody>{demandHistory.map(row => <tr key={row.id}><td>{operationalTime(row.sourceObservedAt)}</td><td>{cases(row.demandCases)}</td><td>{cases(row.byWarehouse.GPT)} / {cases(row.byWarehouse.GRN)}</td></tr>)}</tbody></table></div> : <p>No daily demand observations yet.</p>}</details>
    </section>
    <DeliveryAvailability data={delivery} />
  </>;
  const backQuery = new URLSearchParams(Object.fromEntries(['q', 'market', 'confidence', 'sort'].flatMap(key => typeof query[key] === 'string' ? [[key, query[key]]] : [])));
  backQuery.set('horizon', String(horizon));
  if (context.platform) backQuery.set('organization', organizationId);
  return <div className="pf-page"><Link href={`/analytics/production?${backQuery}`}>← Production Forecasting</Link>
    <ForecastHorizonSelector horizon={horizon} query={backQuery.toString()} path={`/analytics/production/${encodeURIComponent(id)}`} />
    {result.forecast ? <ForecastDetail forecast={result.forecast} operationalContext={operationalContext} /> : <><p role="status">This product is awaiting a source import and forecast refresh.</p>{operationalContext}</>}
    <details className="pf-saved-history compact-details"><summary>Saved forecasts and actual demand</summary><p>Saved {horizon}-day predictions stay unchanged. Actual demand is evaluated only after the complete horizon has source coverage.</p>{result.history.length ? result.history.map(h => <p key={h.id}>{h.start} – {h.end} · forecast {cases(h.point)}{h.point === null ? '' : ' cases'} · actual {h.actual === null ? 'awaiting complete source history' : `${cases(h.actual)} cases`}<small>Generated {h.generatedAt.slice(0, 16).replace('T', ' ')} UTC</small></p>) : <p>No saved {horizon}-day forecasts yet. The next successful refresh will generate this horizon.</p>}</details>
  </div>;
}
