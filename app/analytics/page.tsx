import { requireUser } from '../../lib/auth';
import { requireFeatureForUser } from '../../lib/organizations';
import { formatDateInputValue } from '../../lib/dateTime';
import { parseFilters } from '../../lib/analytics/model';
import { getAnalytics } from '../../lib/analytics/service';
import { AnalyticsView } from './AnalyticsView';
import { PageHeader } from '../components/PageChrome';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Analytics' };
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const { organizationId, organization } = await requireFeatureForUser(user, 'ANALYTICS');
  const query = await searchParams;
  let filters;
  try { filters = parseFilters(query, formatDateInputValue(new Date(), organization.timezone)); }
  catch { return <><PageHeader title="Analytics" /><p role="alert">Choose valid dates in order, no later than today, spanning at most 366 days.</p><form action="/analytics" method="get"><input type="hidden" name="preset" value="custom" />{['market', 'channel', 'product', 'comparison', 'view', 'group', 'q', 'sort'].map(key => typeof query[key] === 'string' ? <input key={key} type="hidden" name={key} value={query[key]} /> : null)}<label>Start date<input required type="date" name="start" defaultValue={typeof query.start === 'string' ? query.start : ''} /></label><label>End date<input required type="date" name="end" defaultValue={typeof query.end === 'string' ? query.end : ''} /></label><button type="submit">Update date range</button></form><Link href="/analytics">Reset Analytics filters</Link></>; }
  const result = await getAnalytics(organizationId, filters);
  return <AnalyticsView result={result} filters={filters} />;
}
