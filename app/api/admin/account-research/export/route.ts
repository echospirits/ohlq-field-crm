export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { requirePlatformAdminSession } from '../../../../../lib/auth';
import { createAccountResearchCsv, getAccountResearchQueue, normalizeResearchExportLimit } from '../../../../../lib/accountResearch';
import { requireFeatureForUser, requireOrganizationContext } from '../../../../../lib/organizations';

export async function GET(request: Request) {
  const session = await requirePlatformAdminSession();
  await requireOrganizationContext(session.user);
  await requireFeatureForUser(session.user, 'ADVANCED_INTELLIGENCE');
  const url = new URL(request.url);
  const limit = normalizeResearchExportLimit(url.searchParams.get('limit'));
  const includeFresh = url.searchParams.get('scope') === 'all';
  const rows = await getAccountResearchQueue({ limit, includeFresh });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(`\uFEFF${createAccountResearchCsv(rows)}`, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="account-research-${date}-${rows.length}-accounts.csv"`,
      'Content-Type': 'text/csv; charset=utf-8',
    },
  });
}
