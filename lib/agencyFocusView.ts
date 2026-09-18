/** Keep the selected account and search when changing action filters or logging a visit. */
export function agencyFocusHref(query: { agencyId?: string; state?: string; q?: string }) {
  const params = new URLSearchParams();
  for (const key of ['agencyId', 'state', 'q'] as const) {
    const value = query[key]?.trim();
    if (value) params.set(key, value);
  }
  return `/agency-focus${params.size ? `?${params}` : ''}`;
}
