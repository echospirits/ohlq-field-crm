'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatDistanceMiles } from '../../lib/location/distance';
import type { NearbyAccount } from '../../lib/location/nearbyAccounts';
import { useCurrentLocation } from './useCurrentLocation';

const visitFormatter = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short' });
const lastVisitLabel = (value: string | null) =>
  value ? `Last visit ${visitFormatter.format(new Date(value))}` : null;

export function NearbyAccountsSection({ type }: { type: 'agency' | 'wholesale' }) {
  const { location, requestLocation, status } = useCurrentLocation();
  const [accounts, setAccounts] = useState<NearbyAccount[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!location) return;
    const controller = new AbortController();
    const query = new URLSearchParams({
      latitude: String(location.latitude),
      longitude: String(location.longitude),
      type,
    });
    setIsLoading(true);
    fetch(`/api/accounts/nearby?${query}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`Nearby lookup failed: ${response.status}`)))
      .then((data: { results: NearbyAccount[] }) => setAccounts(data.results))
      .catch((error) => {
        if (!controller.signal.aborted) console.error(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [location, type]);

  if (status !== 'ready') {
    return (
      <div className="nearby-location-control">
        <button className="secondary compact-btn" disabled={status === 'loading'} onClick={requestLocation} type="button">
          {status === 'loading' ? 'Finding nearby accounts…' : 'Use my location to show nearby accounts'}
        </button>
        {status === 'denied' || status === 'unavailable' ? (
          <span className="field-note">Location is unavailable. Account lists still work normally.</span>
        ) : null}
      </div>
    );
  }

  if (isLoading) return <p className="field-note nearby-loading">Finding nearby accounts…</p>;
  if (accounts.length === 0) return null;

  return (
    <details className="nearby-accounts section-disclosure">
      <summary><strong>Nearby accounts</strong><span className="disclosure-meta">{accounts.length} shown · Within 10 mi</span></summary>
      <div className="nearby-account-list">
        {accounts.map((account) => (
          <Link
            className="nearby-account-row"
            href={type === 'agency' ? `/agencies/${account.id}` : `/wholesale/${account.id}`}
            key={account.id}
          >
            <strong>{account.name}</strong>
            <span>{[
              account.city,
              location.accuracy > 1609 ? `${Math.round(account.distanceMiles)} mi` : formatDistanceMiles(account.distanceMiles),
              lastVisitLabel(account.lastVisitAt),
            ].filter(Boolean).join(' • ')}</span>
          </Link>
        ))}
      </div>
    </details>
  );
}

