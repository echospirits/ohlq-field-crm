import { OrganizationAuditAction } from '@prisma/client';
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '../../../../lib/auth';
import { SUPPORT_VIEW_COOKIE, writeOrganizationAudit } from '../../../../lib/organizations';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const user = await requirePlatformAdmin();
  const organizationId = request.headers.get('cookie')?.match(new RegExp(`(?:^|; )${SUPPORT_VIEW_COOKIE}=([^;]+)`))?.[1] ?? null;
  await writeOrganizationAudit(user.id, organizationId, OrganizationAuditAction.SUPPORT_VIEW_ENDED);
  const response = NextResponse.redirect(new URL('/platform', request.url));
  response.cookies.set(SUPPORT_VIEW_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return response;
}
