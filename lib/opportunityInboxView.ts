export const OPPORTUNITY_INBOX_PAGE_SIZE = 25;

export type OpportunityInboxQuery = {
  q?: string; state?: string; priority?: string; rating?: string; mode?: string;
  sort?: string; territory?: string; page?: string; view?: string;
};

export function opportunityInboxPageNumber(value?: string) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? Math.min(page, 10_000) : 1;
}

/** Filtering starts at the first page; action returns retain the page being browsed. */
export function opportunityInboxHref(query: OpportunityInboxQuery, change?: Partial<OpportunityInboxQuery>) {
  const next = change ? { ...query, page: undefined, ...change } : query;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(next)) {
    if (value?.trim() && key !== 'page') params.set(key, value.trim());
  }
  const page = opportunityInboxPageNumber(next.page);
  if (page > 1) params.set('page', String(page));
  return `/opportunities${params.size ? `?${params}` : ''}`;
}
