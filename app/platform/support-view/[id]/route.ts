import { OrganizationAuditAction } from '@prisma/client';
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '../../../../lib/auth';
import { SUPPORT_VIEW_COOKIE, writeOrganizationAudit } from '../../../../lib/organizations';
import { prisma } from '../../../../lib/prisma';

export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePlatformAdmin();
  const { id } = await params;
  const organization = await prisma.organization.findUnique({ where: { id }, select: { id: true } });
  if (!organization) return NextResponse.json({ error: 'Organization not found.' }, { status: 404 });
  await writeOrganizationAudit(user.id, id, OrganizationAuditAction.SUPPORT_VIEW_STARTED);
  const response = NextResponse.redirect(new URL('/', request.url));
  response.cookies.set(SUPPORT_VIEW_COOKIE, id, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 8 });
  return response;
}
