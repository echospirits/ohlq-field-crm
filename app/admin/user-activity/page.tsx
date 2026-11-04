import Link from 'next/link';
import '../admin-workspace.css';
import { requireEchoAdmin } from '../../../lib/auth';
import { requireOrganizationContext } from '../../../lib/organizations';
import { prisma } from '../../../lib/prisma';
import { buildPageMetadata } from '../../../lib/appBrand';
import { getUserActivityReport } from '../../../lib/userActivityReport';
import { PageHeader, SectionHeading, EmptyState } from '../../components/PageChrome';
import { LiveFilterForm } from '../../components/LiveFilterForm';

export const dynamic = 'force-dynamic';
export const metadata = buildPageMetadata('User activity');
const dateText = (date: Date) => date.toISOString().slice(0, 10);
const timeText = (date: Date) => `${date.toISOString().slice(11, 16)} UTC`;

export default async function UserActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireEchoAdmin();
  await requireOrganizationContext(user);
  const raw = await searchParams;
  const params = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, typeof value === 'string' ? value : undefined]));
  const report = await getUserActivityReport(prisma, user, params);
  const { filters, rows, total, page, pages, summaries } = report;
  const link = (changes: Record<string, string>) => {
    const query = new URLSearchParams({ from: dateText(filters.from), to: dateText(filters.to), q: filters.q, activity: filters.activity, sort: filters.sort, ...changes });
    return `/admin/user-activity?${query}`;
  };
  return <div className="admin-workspace">
    <PageHeader title="User activity" meta="Echo Spirits users · UTC" />
    <LiveFilterForm className="card activity-filters" label="Filter user activity" key={`${dateText(filters.from)}-${dateText(filters.to)}-${filters.organizationId}`}>
      <input type="hidden" name="page" value="1" />
      <label>Search users<input type="search" name="q" defaultValue={filters.q} placeholder="Name or email" /></label>
      <label>From (UTC)<input type="date" name="from" defaultValue={dateText(filters.from)} /></label>
      <label>Through (UTC)<input type="date" name="to" defaultValue={dateText(filters.to)} /></label>
      <label>Activity<select name="activity" defaultValue={filters.activity}><option value="all">All usage</option><option value="login">Login days</option></select></label>
      <label>Sort history<select name="sort" defaultValue={filters.sort}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="logins">Most logins</option></select></label>
      <Link className="btn secondary" href="/admin/user-activity">Clear filters</Link>
    </LiveFilterForm>
    <details className="activity-help compact-details"><summary>What counts as activity?</summary><p>A successful sign-in counts as a login and an active day. Opening or interacting with Neat in the foreground also counts as an active day, even if the user stays signed in. Idle tabs and background refreshes do not count. Multiple visits on a day share one record.</p><p>Days and times use UTC. Tracking starts with this feature; earlier activity is unavailable. This measures access, not time spent or work completed. History remains after sign-out or user deactivation.</p></details>
    <section className="content-section">
      <SectionHeading title="Activity summary" description={`Matching activity from ${dateText(filters.from)} through ${dateText(filters.to)} (UTC). Earlier activity before tracking began is unavailable.`} />
      <div className="activity-summaries">{summaries.map((summary) => <article className="card" key={summary.organizationId ?? 'none'}>
        <h3>{summary.organizationName}</h3>
        {summary.userDays ? <dl className="activity-stats"><div><dt>Active users</dt><dd>{summary.activeUsers}</dd></div><div><dt>Logins</dt><dd>{summary.logins}</dd></div><div><dt>Days with activity</dt><dd>{summary.activeDays}</dd></div><div><dt>Active days per active user (avg.)</dt><dd>{(summary.userDays / summary.activeUsers).toFixed(1)}</dd></div></dl> : <p className="muted">No recorded activity matches these filters.</p>}
      </article>)}</div>
    </section>
    <section className="content-section" aria-label="Daily user history">
      <SectionHeading title="Daily user history" count={total} description={total ? `Page ${page} of ${pages} · up to 50 daily records per page` : undefined} />
      {rows.length ? <div className="table-scroll" role="region" aria-label="Daily user activity comparison" tabIndex={0}><table className="comparison-table activity-history-table"><thead><tr><th scope="col">User</th><th scope="col">Activity date · UTC</th><th scope="col" className="numeric">Logins / access</th></tr></thead><tbody>{rows.map(row => <tr key={`${row.userId}-${dateText(row.day)}`}>
        <th scope="row">{row.userName}{row.email ? <small>{row.email}</small> : null}</th>
        <td data-label="Activity date · UTC"><time dateTime={dateText(row.day)}>{dateText(row.day)}</time><small>First activity {timeText(row.firstActivityAt)}</small></td>
        <td data-label="Logins / access" className="numeric"><strong>{row.loginCount ? `${row.loginCount} ${row.loginCount === 1 ? 'login' : 'logins'}` : 'App use'}</strong><small>{row.lastLoginAt ? `Latest login ${timeText(row.lastLoginAt)}` : 'Used an existing session'}</small></td>
      </tr>)}</tbody></table></div> : <EmptyState title="No recorded activity matches" description="Try another date range or clear filters. Tracking begins when this feature is deployed; older activity is unavailable." action={<Link className="btn secondary" href="/admin/user-activity">Clear filters</Link>} />}
      {pages > 1 ? <nav className="activity-pagination" aria-label="Activity history pages">{page > 1 ? <Link className="btn secondary" href={link({ page: String(page - 1) })}>Previous</Link> : <span aria-disabled="true" className="muted">Previous</span>}<span>Page {page} of {pages}</span>{page < pages ? <Link className="btn secondary" href={link({ page: String(page + 1) })}>Next</Link> : <span aria-disabled="true" className="muted">Next</span>}</nav> : null}
    </section>
  </div>;
}
