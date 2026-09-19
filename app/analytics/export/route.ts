import { requireUser } from '../../../lib/auth';
import { requireOrganizationContext } from '../../../lib/organizations';
import { formatDateInputValue } from '../../../lib/dateTime';
import { parseFilters } from '../../../lib/analytics/model';
import { getAnalytics } from '../../../lib/analytics/service';
import { analyticsCsv } from '../../../lib/analytics/csv';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const user = await requireUser();
  const { organizationId, organization } = await requireOrganizationContext(user);
  const params = new URL(request.url).searchParams;
  let filters;
  try { filters = parseFilters(Object.fromEntries(params), formatDateInputValue(new Date(), organization.timezone)); }
  catch { return new Response('Choose valid dates in order, no later than today, spanning at most 366 days.', { status: 400 }); }
  const report = params.get('report') === 'products' ? 'products' : 'accounts';
  if (report === 'products' && filters.group !== 'all') return new Response('Product exports use the Sales Overview report. Clear the account group filter.', { status: 400 });
  const result = await getAnalytics(organizationId, filters);
  return new Response(analyticsCsv(result, filters, organizationId, report), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="neat-${report}-${filters.start}-${filters.end}.csv"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
}
