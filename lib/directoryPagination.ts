/** One bounded page for both field browsing and desktop comparison. */
export const DIRECTORY_PAGE_SIZE = 50;

export function directoryPage(requested: string | number | undefined, total: number) {
  const parsed = typeof requested === 'number' ? requested : Number(requested ?? 1);
  const pages = Math.max(1, Math.ceil(total / DIRECTORY_PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number.isFinite(parsed) ? Math.floor(parsed) : 1));
  return { page, pages, skip: (page - 1) * DIRECTORY_PAGE_SIZE, take: DIRECTORY_PAGE_SIZE };
}

export function directoryPageHref(path: string, params: Record<string, string | undefined>, page: number) {
  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
  if (page > 1) query.set('page', String(page));
  else query.delete('page');
  return query.size ? `${path}?${query}` : path;
}
