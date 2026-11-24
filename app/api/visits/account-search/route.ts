export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { UserRole } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/auth';
import { parseCoordinates } from '../../../../lib/location/distance';
import {
  getVisitPickerSuggestions,
  searchAgenciesForVisitPicker,
  searchWholesaleAccountsForVisitPicker,
} from '../../../../lib/visitPickerOptions';
import { requireOrganizationContext } from '../../../../lib/organizations';
import { startVisitServerTiming } from '../../../../lib/visitTimingServer';

export async function GET(request: NextRequest) {
  const timing = startVisitServerTiming(request.nextUrl.searchParams.get('timing'), 'search');
  try {
    const user = await getCurrentUser();
    if (!user) {
      timing?.finish('failed');
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }
    const { organizationId } = await requireOrganizationContext(user);
    timing?.mark('authenticated');
    const headers = { 'Cache-Control': 'private, no-store' };

    if (request.nextUrl.searchParams.get('suggestions') === '1' && user.role !== UserRole.TASTER) {
      const suggestions = await getVisitPickerSuggestions(organizationId);
      timing?.mark('loaded');
      timing?.finish('success');
      return NextResponse.json(suggestions, { headers });
    }

    const locationType = request.nextUrl.searchParams.get('type') === 'agency' ? 'agency' : 'wholesale';
    if (user.role === UserRole.TASTER && locationType !== 'agency') {
      timing?.finish('failed');
      return NextResponse.json({ error: 'Taster accounts can only search retail accounts.' }, { status: 403 });
    }

    const query = request.nextUrl.searchParams.get('q')?.trim().slice(0, 200) ?? '';
    if (query.length < 2) {
      timing?.finish('success');
      return NextResponse.json({ results: [] }, { headers });
    }

    const coordinates = parseCoordinates(
      request.nextUrl.searchParams.get('latitude'),
      request.nextUrl.searchParams.get('longitude'),
    );

    const results =
      locationType === 'agency'
        ? await searchAgenciesForVisitPicker({ query, coordinates, organizationId })
        : await searchWholesaleAccountsForVisitPicker({ query, coordinates, organizationId });

    timing?.mark('loaded');
    timing?.finish('success');
    return NextResponse.json({ results }, { headers });
  } catch (error) {
    timing?.finish('failed');
    throw error;
  }
}
