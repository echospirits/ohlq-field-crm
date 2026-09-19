'use client';
export default function AnalyticsError({ reset }: { reset: () => void }) { return <section role="alert"><h1>Analytics couldn’t load</h1><p>Your filters are preserved. Retry, or check Data Status if imports are unavailable.</p><button onClick={reset}>Try again</button><a className="button secondary" href="/admin/data-status">Data Status</a></section>; }
