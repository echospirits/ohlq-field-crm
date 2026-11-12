import { NextResponse } from 'next/server';
import { supplyJobsEnabled } from '../../../../lib/productionSupplies/config';
import { isSupplyJobAuthorized } from '../../../../lib/productionSupplies/jobAuth';
import { runSupplyJobs } from '../../../../lib/productionSupplies/jobs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function GET(request: Request) {
  if (!isSupplyJobAuthorized(request.headers.get('authorization'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!supplyJobsEnabled()) return NextResponse.json({ environmentDisabled: true });
  return NextResponse.json(await runSupplyJobs());
}
