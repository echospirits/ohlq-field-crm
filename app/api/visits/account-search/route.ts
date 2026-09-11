export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { UserRole } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/auth';
import { parseCoordinates } from '../../../../lib/location/distance';
import {
  searchAgenciesForVisitPicker,
  searchWholesaleAccountsForVisitPicker,
} from '../../../../lib/visitPickerOptions';
import { requireOrganizationContext } from '../../../../lib/organizations';

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { organizationId } = await requireOrganizationContext(user);

  const locationType = request.nextUrl.searchParams.get('type') === 'agency' ? 'agency' : 'wholesale';
  if (user.role === UserRole.TASTER && locationType !== 'agency') {
    return NextResponse.json({ error: 'Taster accounts can only search agencies.' }, { status: 403 });
  }

  const query = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (query.length < 2) return NextResponse.json({ results: [] });

  const coordinates = parseCoordinates(
    request.nextUrl.searchParams.get('latitude'),
    request.nextUrl.searchParams.get('longitude'),
  );

  const results =
    locationType === 'agency'
      ? await searchAgenciesForVisitPicker({ query, coordinates, organizationId })
      : await searchWholesaleAccountsForVisitPicker({ query, coordinates, organizationId });

  return NextResponse.json(
    { results },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
