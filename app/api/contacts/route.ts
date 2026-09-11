export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../lib/auth';
import { accountExists, getAccountLocation } from '../../../lib/accountMemory';
import { requireOrganizationContext } from '../../../lib/organizations';
import { prisma } from '../../../lib/prisma';

const optional = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
};

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { organizationId } = await requireOrganizationContext(user);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const name = optional(body?.name);
  const accountId = optional(body?.accountId);
  const location = accountId ? getAccountLocation(String(body?.accountType ?? ''), accountId) : null;
  if (!name || !location || !(await accountExists(prisma, location))) return NextResponse.json({ error: 'A valid account and name are required.' }, { status: 400 });
  const contact = await prisma.locationContact.create({ data: {
    organizationId, name, role: optional(body?.role), email: optional(body?.email), phone: optional(body?.phone),
    createdByUserId: user.id,
    ...(location.accountType === 'AGENCY' ? { agencyId: location.agencyId } : { wholesaleAccountId: location.wholesaleAccountId }),
  }, select: { id: true, name: true, role: true, email: true, phone: true, agencyId: true, wholesaleAccountId: true, active: true, isPrimary: true } });
  return NextResponse.json(contact, { status: 201 });
}
