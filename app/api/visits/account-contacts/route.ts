import { UserRole } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../../lib/auth';
import { requireOrganizationContext } from '../../../../lib/organizations';
import { prisma } from '../../../../lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (user.role === UserRole.TASTER) {
    return NextResponse.json({ error: 'Visit contacts are unavailable for this role.' }, { status: 403 });
  }
  const { organizationId } = await requireOrganizationContext(user);
  const { searchParams } = request.nextUrl;
  const id = searchParams.get('id')?.trim();
  const type = searchParams.get('type');
  if (!id || id.length > 128 || (type !== 'agency' && type !== 'wholesale')) {
    return NextResponse.json({ error: 'A valid account is required.' }, { status: 400 });
  }

  // Older retail contacts can reference the source directory ID.
  const agency = type === 'agency' ? await prisma.agency.findUnique({
    where: { id }, select: { agencyId: true },
  }) : null;
  const contacts = await prisma.locationContact.findMany({
    where: {
      organizationId,
      active: true,
      ...(type === 'agency' ? { agencyId: { in: agency ? [id, agency.agencyId] : [id] } } : { wholesaleAccountId: id }),
    },
    orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      role: true,
      phone: true,
      email: true,
      agencyId: true,
      wholesaleAccountId: true,
      active: true,
      isPrimary: true,
    },
  });
  return NextResponse.json({ contacts }, { headers: { 'Cache-Control': 'private, no-store' } });
}
