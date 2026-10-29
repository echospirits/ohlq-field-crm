import Link from 'next/link';
import { requireUserSession } from '../../../lib/auth';
import { requireProductionForecastContext } from '../../../lib/productionForecasting/access';
import { getProductionDashboard } from '../../../lib/productionForecasting/service';
import { isAdminRole } from '../../../lib/userAccess';
import { PageHeader } from '../../components/PageChrome';
import { AnchoredDetails } from '../../components/AnchoredDetails';
import { ForecastTable } from './ForecastTable';
import { SourceImportForm } from './SourceImportForm';
import './forecast.css';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const metadata = { title: 'Production Forecasting' };
export default async function ProductionForecastPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requireUserSession();
  const query = await searchParams;
  const context = await requireProductionForecastContext(user, typeof query.organization === 'string' ? query.organization : undefined);
  if (!context.organization) return <div className="pf-page"><PageHeader title="Production Forecasting" /><p>No active organizations have Production Forecasting enabled.</p><Link href="/admin/organization">Echo Settings</Link></div>;
  const organizationId = context.organization.id;
  const { rows, run, today, latestImports } = await getProductionDashboard(organizationId);
  const initial = Object.fromEntries(['q', 'market', 'confidence', 'sort'].flatMap(key => typeof query[key] === 'string' ? [[key, query[key]]] : []));
  return <div className="pf-page"><Link href="/analytics">← Analytics</Link><PageHeader title="Production Forecasting" description="Expected outbound case demand over the next 30 days." actions={isAdminRole(user.role) ? <a className="btn secondary compact-btn" href="#source-import">Import source reports</a> : undefined} />
    <div className="pf-freshness" role="status"><strong>{run ? `${run.horizonStart} – ${run.horizonEnd}` : 'Awaiting first forecast snapshot'}</strong><span>Forecast data through {run?.dataThrough ?? 'unavailable'}{run ? ` · generated ${run.generatedAt.slice(0, 16).replace('T', ' ')} UTC` : ''}</span>{run && run.horizonStart < today ? <span className="pf-warning">This saved horizon is stale. The next successful refresh will create a new 30-day forecast.</span> : null}</div>
    <p className="muted">Targets include an uncertainty margin, before subtracting finished inventory. DC min/max is guidance, not a production limit.</p>
    {latestImports.some(i => i.status !== 'COMPLETE') ? <p className="pf-warning" role="alert">The latest import for a source is incomplete or failed. Forecasts retain its last complete data. Review <a href="#forecast-sources">Sources and data quality</a> before planning.</p> : null}
    <ForecastTable rows={rows} initial={initial} organizationId={context.platform ? organizationId : undefined} />
    <AnchoredDetails className="card compact-details" id="forecast-sources" summary="Sources and data quality"><p>Bailment PO / Invoice outbound cases are the primary demand signal. A-3a Bail is included; A-3a Dist is excluded. Distribution Center minimum (roughly two weeks) and maximum (roughly 45 days) provide context only.</p>{latestImports.length ? <ul>{latestImports.map(i => <li key={`${i.market}:${i.source}`}>{i.market} {i.source === 'BAILMENT_PO_INVOICE' ? 'Bailment outbound' : 'DC guidance'} · report observed {i.observedOn} · {i.status} · {i.excludedRows} excluded source rows</li>)}</ul> : <p className="pf-warning">No verified source reports have been imported. Existing retail sales and agency inventory do not establish outbound case demand.</p>}<p>Zero demand requires complete source coverage. Missing or incomplete periods stay unavailable. Sparse history reduces confidence; forecasts more than seven days behind source data are withheld.</p></AnchoredDetails>
    {isAdminRole(user.role) ? <SourceImportForm key={organizationId} organizationId={organizationId} /> : <p className="muted">An organization administrator can import verified case history and guidance.</p>}
  </div>;
}
