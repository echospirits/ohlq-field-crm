import Link from 'next/link';
import { directoryPage, directoryPageHref, DIRECTORY_PAGE_SIZE } from '../../lib/directoryPagination';

export function DirectoryPagination({ path, params, total, page, label = 'accounts' }: { path: string; params: Record<string, string | undefined>; total: number; page: number; label?: string }) {
  const pagination = directoryPage(page, total);
  return <nav aria-label={`${label} pages`} className="directory-pagination">
    <p role="status">{total ? `${pagination.skip + 1}–${Math.min(pagination.skip + DIRECTORY_PAGE_SIZE, total)} of ${total.toLocaleString()} ${label}` : `No matching ${label}`}</p>
    {pagination.pages > 1 ? <div>
      {pagination.page > 1 ? <Link className="btn secondary compact-btn" href={directoryPageHref(path, params, pagination.page - 1)}>Previous</Link> : <span className="pagination-disabled" aria-disabled="true">Previous</span>}
      <span>Page {pagination.page} of {pagination.pages}</span>
      {pagination.page < pagination.pages ? <Link className="btn secondary compact-btn" href={directoryPageHref(path, params, pagination.page + 1)}>Next</Link> : <span className="pagination-disabled" aria-disabled="true">Next</span>}
    </div> : null}
  </nav>;
}
