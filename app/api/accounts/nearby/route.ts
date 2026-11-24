export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { UserRole } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/auth';
import { getOrganizationContext } from '../../../../lib/organizations';
import { parseCoordinates } from '../../../../lib/location/distance';
import { getNearbyAgencies, getNearbyWholesaleAccounts } from '../../../../lib/location/nearbyAccounts';

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const context = await getOrganizationContext(user);
  if (!context) return NextResponse.json({ error: 'Organization unavailable.' }, { status: 403 });
  const { organizationId } = context;

  const type = request.nextUrl.searchParams.get('type') === 'agency' ? 'agency' : 'wholesale';
  if (user.role === UserRole.TASTER && type !== 'agency') {
    return NextResponse.json({ error: 'Taster accounts can only view retail accounts.' }, { status: 403 });
  }

  const coordinates = parseCoordinates(
    request.nextUrl.searchParams.get('latitude'),
    request.nextUrl.searchParams.get('longitude'),
  );
  if (!coordinates) {
    return NextResponse.json({ error: 'Valid latitude and longitude are required.' }, { status: 400 });
  }

  const results = type === 'agency'
    ? await getNearbyAgencies({ ...coordinates, organizationId })
    : await getNearbyWholesaleAccounts({ ...coordinates, organizationId });

  return NextResponse.json(
    { results },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

