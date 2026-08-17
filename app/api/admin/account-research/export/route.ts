export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { requireAdminSession } from '../../../../../lib/auth';
import { createAccountResearchCsv, getAccountResearchQueue, normalizeResearchExportLimit } from '../../../../../lib/accountResearch';

export async function GET(request: Request) {
  await requireAdminSession();
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
