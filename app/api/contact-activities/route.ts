export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { AccountActivityType } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '../../../lib/auth';
import { getAccountContactWhere, getAccountLocation } from '../../../lib/accountMemory';
import { requireOrganizationContext } from '../../../lib/organizations';
import { prisma } from '../../../lib/prisma';

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { organizationId } = await requireOrganizationContext(user);
  const body = await request.json().catch(() => null) as { accountId?: string; accountType?: string; contactId?: string; kind?: string } | null;
  const location = body?.accountId ? getAccountLocation(body.accountType ?? '', body.accountId) : null;
  const kind = body?.kind === AccountActivityType.EMAIL_INITIATED || body?.kind === AccountActivityType.CALL_INITIATED ? body.kind : null;
  if (!location || !kind || !body?.contactId) return NextResponse.json({ error: 'Invalid activity.' }, { status: 400 });
  const contact = await prisma.locationContact.findFirst({ where: { id: body.contactId, ...getAccountContactWhere(organizationId, location) }, select: { id: true } });
  if (!contact) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 });
  await prisma.accountActivity.create({ data: {
    organizationId, activityType: kind, contactId: contact.id, createdByUserId: user.id,
    agencyId: location.accountType === 'AGENCY' ? location.agencyId : null,
    wholesaleAccountId: location.accountType === 'WHOLESALE' ? location.wholesaleAccountId : null,
  } });
  return new NextResponse(null, { status: 204 });
}
