import Link from 'next/link';
import { forecastHorizons, type ForecastHorizon } from '../../../lib/productionForecasting/model';

export function ForecastHorizonSelector({ horizon, query = '', path = '/analytics/production' }: { horizon: ForecastHorizon; query?: string; path?: string }) {
  return <nav className="pf-horizon" aria-label="Forecast horizon"><span>Next</span><div className="pf-horizon-options">{forecastHorizons.map(days => {
    const params = new URLSearchParams(query);
    params.set('horizon', String(days));
    return <Link key={days} href={`${path}?${params}`} scroll={false} aria-current={horizon === days ? 'page' : undefined}>{days} days</Link>;
  })}</div></nav>;
}
