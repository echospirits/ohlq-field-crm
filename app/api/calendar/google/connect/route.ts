export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { createHash, randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { requireUser } from '../../../../../lib/auth';
import { GOOGLE_PROVIDER, getGoogleOAuthUrl } from '../../../../../lib/calendar/google';
import { prisma } from '../../../../../lib/prisma';
import { isSideEffectEnabled } from '../../../../../lib/appEnvironment';

export async function GET(request: Request) {
  const user = await requireUser();
  if (!isSideEffectEnabled('calendar')) {
    return NextResponse.redirect(new URL('/settings/calendar?status=environment-disabled', request.url));
  }
  const state = randomBytes(32).toString('base64url');
  const stateHash = createHash('sha256').update(state).digest('hex');
  await prisma.calendarOAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.calendarOAuthState.create({
    data: {
      userId: user.id,
      provider: GOOGLE_PROVIDER,
      stateHash,
      returnPath: '/settings/calendar',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });
  try {
    return NextResponse.redirect(getGoogleOAuthUrl(state));
  } catch {
    return NextResponse.redirect(new URL('/settings/calendar?status=not-configured', request.url));
  }
}
