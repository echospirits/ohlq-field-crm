'use client';

import { usePathname } from 'next/navigation';
import { navigationItems } from './navigationConfig';

export function RouteLoading() {
  const pathname = usePathname();
  const destination = pathname === '/visits/new' ? 'Log Visit'
    : navigationItems.filter(item => pathname === item.href || item.href !== '/' && pathname.startsWith(`${item.href}/`)).sort((a, b) => b.href.length - a.href.length)[0]?.label ?? 'Workspace';
  return <section aria-busy="true" aria-label={`Loading ${destination}`} className="workspace-loading">
    <header className="page-heading"><h1>{destination}</h1></header>
    <p role="status">Loading {destination.toLowerCase()}…</p>
    <div aria-hidden="true" className="loading-placeholder loading-row" />
    <div aria-hidden="true" className="loading-placeholder loading-row" />
    <div aria-hidden="true" className="loading-placeholder loading-row" />
  </section>;
}
