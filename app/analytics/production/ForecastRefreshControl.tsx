'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ForecastRefreshState } from '../../../lib/productionForecasting/refreshState';
import { getForecastRefreshStatus, requestForecastRefresh } from './refreshActions';

const active = (job: ForecastRefreshState['job']) => job?.status === 'QUEUED' || job?.status === 'RUNNING';
const incomplete = (job: ForecastRefreshState['job']) => job && ['PARTIAL', 'FAILED', 'TIMED_OUT'].includes(job.status);
const completedTime = (value: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value));

export function ForecastRefreshControl({ organizationId, initialState }: { organizationId: string; initialState: ForecastRefreshState }) {
  const router = useRouter(), descriptionId = useId();
  const [state, setState] = useState(initialState);
  const [operation, setOperation] = useState<'request' | 'check' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const mounted = useRef(true), inFlight = useRef(false);
  const watchedJob = useRef<string | null>(active(initialState.job) ? initialState.job!.id : null);
  const busy = operation !== null || active(state.job);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const accept = (next: ForecastRefreshState) => {
    if (!mounted.current) return;
    setState(next); setError(null); setUncertain(false);
    if (active(next.job)) watchedJob.current = next.job!.id;
    else if (next.job && watchedJob.current && (watchedJob.current === next.job.id || watchedJob.current === 'unknown')) {
      watchedJob.current = null;
      // Revalidate this route in place: filters, horizon and return context stay put.
      // A partial/failed result refreshes its source warnings without claiming fresh data.
      router.refresh();
    }
  };

  useEffect(() => {
    if (!active(state.job) || uncertain) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const result = await getForecastRefreshStatus(organizationId);
        if (cancelled || !mounted.current) return;
        if (result.ok) accept(result.state);
        else { setState(result.state); setError(result.error ?? 'Could not check refresh progress.'); setUncertain(true); }
      } catch {
        if (!cancelled && mounted.current) { setError('Could not check progress. Your refresh may still be running.'); setUncertain(true); }
      } finally { inFlight.current = false; }
    }, 5000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [organizationId, state.job, uncertain, router]);

  const run = async () => {
    if (inFlight.current || (!uncertain && (!state.configured || active(state.job)))) return;
    const checking = uncertain;
    inFlight.current = true; setOperation(checking ? 'check' : 'request'); setError(null);
    if (!checking) watchedJob.current = 'unknown';
    try {
      const result = await (checking ? getForecastRefreshStatus(organizationId) : requestForecastRefresh(organizationId));
      if (!mounted.current) return;
      if (result.ok) accept(result.state);
      else {
        setState(result.state); setError(result.error ?? 'Could not start the refresh. Try again.'); setUncertain(checking);
        watchedJob.current = active(result.state.job) ? result.state.job!.id : null;
      }
    } catch {
      if (mounted.current) { setError(checking ? 'Could not check progress. Your refresh may still be running.' : 'Could not confirm the request. Check progress before starting another refresh.'); setUncertain(true); }
    } finally {
      inFlight.current = false;
      if (mounted.current) setOperation(null);
    }
  };

  const label = operation === 'request' ? 'Requesting refresh…' : operation === 'check' ? 'Checking progress…' : uncertain ? 'Check progress' : active(state.job) ? state.job!.status === 'QUEUED' ? 'Refresh queued…' : 'Refreshing forecasts…' : incomplete(state.job) ? 'Retry refresh' : 'Refresh forecasts';
  const settings = `/analytics/production/settings?${new URLSearchParams({ organization: organizationId })}`;
  return <section className="pf-refresh-control" aria-label="Refresh forecasts" aria-busy={busy}>
    <button type="button" className="btn" disabled={operation !== null || (!uncertain && (!state.configured || active(state.job)))} aria-describedby={descriptionId} onClick={() => void run()}>{label}</button>
    <div id={descriptionId} className="pf-refresh-feedback">
      {error ? <p role="alert" className="pf-refresh-error">{error}</p> : null}
      {!state.configured && !uncertain ? <p>{state.unavailableReason ?? 'Automatic refresh is unavailable.'} <Link href={settings}>Review source settings</Link></p> : state.job ? <p role="status" className={incomplete(state.job) ? 'pf-refresh-warning' : undefined}>{state.job.message}</p> : <p>Downloads source reports and saves forecasts; allow a few minutes.</p>}
      {state.configured ? <p>Today’s demand and warehouse snapshots may be reused.</p> : null}
      {state.lastSuccessfulAt ? <p className="pf-refresh-last">Last completed <time dateTime={state.lastSuccessfulAt}>{completedTime(state.lastSuccessfulAt)}</time> · report dates below</p> : null}
    </div>
  </section>;
}
