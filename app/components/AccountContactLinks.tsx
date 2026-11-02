'use client';

import type { ReactNode } from 'react';

export function AddressLink({ address, children }: { address?: string | null; children?: ReactNode }) {
  const destination = address?.trim();
  if (!destination) return <span>Address unavailable</span>;
  return <a className="account-contact-link" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`} target="_blank" rel="noopener noreferrer" aria-label={`Open Google Maps for ${destination} (opens in a new tab)`}>{children ?? destination}</a>;
}

export function PhoneLink({ phone }: { phone?: string | null }) {
  const value = phone?.trim();
  return value ? <a className="account-contact-link" href={`tel:${value}`} aria-label={`Call ${value}`}>{value}</a> : <span>Phone unavailable</span>;
}
