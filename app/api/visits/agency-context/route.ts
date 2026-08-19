export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/auth';
import { getAgencyVisitContext } from '../../../../lib/agencyVisitContext';

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

  const agencyId = request.nextUrl.searchParams.get('agencyId')?.trim();
  if (!agencyId) {
    return NextResponse.json({ error: 'An agency is required.' }, { status: 400 });
  }

  const context = await getAgencyVisitContext({ agencyId });
  if (!context) return NextResponse.json({ error: 'Agency not found.' }, { status: 404 });

  return NextResponse.json(context, { headers: { 'Cache-Control': 'private, no-store' } });
}
