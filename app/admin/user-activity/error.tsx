'use client';

export default function ActivityError({ reset }: { reset: () => void }) {
  return <section className="card" role="alert"><h1>User activity is unavailable</h1><p>We could not load activity history. Please try again.</p><button type="button" onClick={reset}>Try again</button></section>;
}
