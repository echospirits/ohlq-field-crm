import { NextResponse } from 'next/server';
import { supplyJobsEnabled } from '../../../../lib/productionSupplies/config';
import { isSupplyJobAuthorized } from '../../../../lib/productionSupplies/jobAuth';
import { ensureSupplySchedulers } from '../../../../lib/productionSupplies/scheduler';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function GET(request: Request) {
  if (!isSupplyJobAuthorized(request.headers.get('authorization'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!supplyJobsEnabled()) return NextResponse.json({ environmentDisabled: true });
  const organizationId = new URL(request.url).searchParams.get('organizationId') || undefined;
  if (organizationId && organizationId.length > 128) return NextResponse.json({ error: 'Invalid organization.' }, { status: 400 });
  try {
    const result = await ensureSupplySchedulers(undefined, undefined, organizationId);
    return NextResponse.json(result, { status: result.errors ? 503 : 200, headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Supply scheduler could not start. Retry the watchdog.' }, { status: 503 }); }
}
