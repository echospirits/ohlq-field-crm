/** Keep the selected account and search when changing action filters or logging a visit. */
export function agencyFocusHref(query: { agencyId?: string; state?: string; q?: string; page?: string | number }) {
  const params = new URLSearchParams();
  for (const key of ['agencyId', 'state', 'q'] as const) {
    const value = query[key]?.trim();
    if (value) params.set(key, value);
  }
  const page = agencyFocusPageNumber(query.page);
  if (page > 1) params.set('page', String(page));
  return `/agency-focus${params.size ? `?${params}` : ''}`;
}

export const AGENCY_FOCUS_PAGE_SIZE = 250;

export function agencyFocusPageNumber(value?: string | number) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? Math.min(page, 1_000_000) : 1;
}
