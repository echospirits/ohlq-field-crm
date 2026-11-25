import { NextResponse } from 'next/server';
import { supplyJobsEnabled } from '../../../../lib/productionSupplies/config';
import { isSupplyJobAuthorized } from '../../../../lib/productionSupplies/jobAuth';
import { runSupplyCronBatches } from '../../../../lib/productionSupplies/scheduler';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function GET(request: Request) {
  if (!isSupplyJobAuthorized(request.headers.get('authorization'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!supplyJobsEnabled()) return NextResponse.json({ environmentDisabled: true });
  const organizationId = new URL(request.url).searchParams.get('organizationId');
  if (organizationId !== null && organizationId.length > 128) return NextResponse.json({ error: 'Invalid organization.' }, { status: 400 });
  // Existing hosted Workflow runs consult this probe before any provider call.
  // An empty owner list retires them without an extra batch.
  if (organizationId !== null) return NextResponse.json({ schedulers: [] }, { headers: { 'Cache-Control': 'no-store' } });
  try {
    const result = await runSupplyCronBatches();
    return NextResponse.json(result, { status: result.errors ? 503 : 200, headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Supply import could not run.' }, { status: 503 }); }
}
