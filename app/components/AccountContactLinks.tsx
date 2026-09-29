'use client';

import type { ReactNode } from 'react';
import { getDirectionsHref } from '../../lib/crmActionContext';

export function AddressLink({ address, children }: { address?: string | null; children?: ReactNode }) {
  const destination = address?.trim();
  if (!destination) return <span>Address unavailable</span>;
  return <a className="account-contact-link" href={getDirectionsHref(destination)!} aria-label={`Open maps for ${destination}`} onClick={(event) => {
    const query = encodeURIComponent(destination);
    const agent = navigator.userAgent;
    if (/Android/i.test(agent)) event.currentTarget.href = `geo:0,0?q=${query}`;
    else if (/iPhone|iPad|iPod|Macintosh/i.test(agent)) event.currentTarget.href = `https://maps.apple.com/?q=${query}`;
  }}>{children ?? destination}</a>;
}

export function PhoneLink({ phone }: { phone?: string | null }) {
  const value = phone?.trim();
  return value ? <a className="account-contact-link" href={`tel:${value}`} aria-label={`Call ${value}`}>{value}</a> : <span>Phone unavailable</span>;
}
