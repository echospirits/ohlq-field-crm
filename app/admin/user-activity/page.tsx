import Link from 'next/link';
import { UserRole } from '@prisma/client';
import { redirect } from 'next/navigation';
import { requireUserSession } from '../../../lib/auth';
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
  const { user } = await requireUserSession();
  const platform = user.role === UserRole.PLATFORM_ADMIN;
  if (!platform && user.role !== UserRole.ADMIN) redirect('/');
  if (!platform) await requireOrganizationContext(user);
  const raw = await searchParams;
  const params = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, typeof value === 'string' ? value : undefined]));
  const report = await getUserActivityReport(prisma, user, params);
  const { filters, rows, total, page, pages, summaries } = report;
  const link = (changes: Record<string, string>) => {
    const query = new URLSearchParams({ from: dateText(filters.from), to: dateText(filters.to), q: filters.q, activity: filters.activity, sort: filters.sort, ...(platform && filters.organizationId ? { organization: filters.organizationId } : {}), ...changes });
    return `/admin/user-activity?${query}`;
  };
  return <>
    <PageHeader eyebrow={platform ? 'Platform administration' : 'Organization administration'} title="User activity" description={platform ? 'See logins and active days across organizations.' : 'See logins and active days for your organization’s users.'} />
    <LiveFilterForm className="card activity-filters" label="Filter user activity" key={`${dateText(filters.from)}-${dateText(filters.to)}-${filters.organizationId}`}>
      <input type="hidden" name="page" value="1" />
      {platform && filters.organizationId ? <input type="hidden" name="organization" value={filters.organizationId} /> : null}
      <label>Search users{platform ? ' or organizations' : ''}<input type="search" name="q" defaultValue={filters.q} placeholder="Name or email" /></label>
      <label>From (UTC)<input type="date" name="from" defaultValue={dateText(filters.from)} /></label>
      <label>Through (UTC)<input type="date" name="to" defaultValue={dateText(filters.to)} /></label>
      <label>Activity<select name="activity" defaultValue={filters.activity}><option value="all">All usage</option><option value="login">Login days</option></select></label>
      <label>Sort history<select name="sort" defaultValue={filters.sort}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="logins">Most logins</option></select></label>
      <Link className="btn secondary" href="/admin/user-activity">Clear filters</Link>
    </LiveFilterForm>
    {platform && filters.organizationId ? <p className="muted">Filtered to one organization. <Link href={link({ organization: '', page: '1' })}>Show all organizations</Link></p> : null}
    <details className="card activity-help"><summary>What counts as activity?</summary><p>A successful sign-in counts as a login and an active day. Opening or interacting with Neat in the foreground also counts as an active day, even if the user stays signed in. Idle tabs and background refreshes do not count. Multiple visits on a day share one record.</p><p>Days and times use UTC. Tracking starts with this feature; earlier activity is unavailable. This measures access, not time spent or work completed. History remains after sign-out or user deactivation. Support View is attributed to the platform admin’s home organization.</p></details>
    <section className="content-section">
      <SectionHeading title={platform ? 'Organization activity' : 'Activity summary'} description={`Matching activity from ${dateText(filters.from)} through ${dateText(filters.to)} (UTC). Earlier activity before tracking began is unavailable.`} />
      <div className="activity-summaries">{summaries.map((summary) => <article className="card" key={summary.organizationId ?? 'none'}>
        <h3>{platform && summary.organizationId ? <Link href={link({ organization: summary.organizationId, page: '1' })}>{summary.organizationName}</Link> : summary.organizationName}</h3>
        {summary.userDays ? <dl className="activity-stats"><div><dt>Active users</dt><dd>{summary.activeUsers}</dd></div><div><dt>Logins</dt><dd>{summary.logins}</dd></div><div><dt>Days with activity</dt><dd>{summary.activeDays}</dd></div><div><dt>Active days per active user (avg.)</dt><dd>{(summary.userDays / summary.activeUsers).toFixed(1)}</dd></div></dl> : <p className="muted">No recorded activity matches these filters.</p>}
      </article>)}</div>
    </section>
    <section className="content-section" aria-label="Daily user history">
      <SectionHeading title="Daily user history" count={total} description={total ? `Page ${page} of ${pages} · up to 50 daily records per page` : undefined} />
      {rows.length ? <div className="activity-history">{rows.map((row) => <article className="activity-row" key={`${row.userId}-${dateText(row.day)}`}>
        <div className="activity-identity"><strong>{row.userName}</strong>{row.email ? <span className="muted">{row.email}</span> : null}{platform ? <span className="muted">{row.organizationName}</span> : null}</div>
        <div><time dateTime={dateText(row.day)}>{dateText(row.day)}</time><span className="muted">First activity {timeText(row.firstActivityAt)}</span></div>
        <div><strong>{row.loginCount ? `${row.loginCount} ${row.loginCount === 1 ? 'login' : 'logins'}` : 'App use'}</strong><span className="muted">{row.lastLoginAt ? `Latest login ${timeText(row.lastLoginAt)}` : 'Used an existing session'}</span></div>
      </article>)}</div> : <EmptyState title="No recorded activity matches" description="Try another date range or clear filters. Tracking begins when this feature is deployed; older activity is unavailable." action={<Link className="btn secondary" href="/admin/user-activity">Clear filters</Link>} />}
      {pages > 1 ? <nav className="activity-pagination" aria-label="Activity history pages">{page > 1 ? <Link className="btn secondary" href={link({ page: String(page - 1) })}>Previous</Link> : <span aria-disabled="true" className="muted">Previous</span>}<span>Page {page} of {pages}</span>{page < pages ? <Link className="btn secondary" href={link({ page: String(page + 1) })}>Next</Link> : <span aria-disabled="true" className="muted">Next</span>}</nav> : null}
    </section>
  </>;
}
