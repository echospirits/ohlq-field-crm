import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, createUserSession, getSessionCookieOptions } from '../../../../lib/auth';
import { verifyPassword } from '../../../../lib/password';
import { prisma } from '../../../../lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const redirectToLogin = (request: NextRequest, status: string) =>
  NextResponse.redirect(new URL(`/login?status=${encodeURIComponent(status)}`, request.url));

const getLockedUntil = async (identifier: string) => {
  const throttle = await prisma.loginThrottle.findUnique({ where: { identifier } });

  if (!throttle?.lockedUntil || throttle.lockedUntil <= new Date()) {
    return null;
  }

  return throttle.lockedUntil;
};

const recordFailedLogin = async (identifier: string) => {
  const now = new Date();
  const existing = await prisma.loginThrottle.findUnique({ where: { identifier } });
  const failedCount =
    existing?.lockedUntil && existing.lockedUntil <= now ? 1 : (existing?.failedCount ?? 0) + 1;
  const lockedUntil =
    failedCount >= MAX_FAILED_ATTEMPTS ? new Date(now.getTime() + LOCK_MINUTES * 60 * 1000) : null;

  await prisma.loginThrottle.upsert({
    where: { identifier },
    create: {
      identifier,
      failedCount,
      lockedUntil,
      lastAttemptAt: now,
    },
    update: {
      failedCount,
      lockedUntil,
      lastAttemptAt: now,
    },
  });
};

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return redirectToLogin(request, 'missing-credentials');
  }

  if (await getLockedUntil(email)) {
    return redirectToLogin(request, 'locked');
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
    await recordFailedLogin(email);
    return redirectToLogin(request, 'invalid-credentials');
  }

  await prisma.loginThrottle.deleteMany({ where: { identifier: email } });
  const { expiresAt, sessionToken } = await createUserSession(user.id);
  const response = NextResponse.redirect(new URL('/', request.url));
  response.cookies.set(SESSION_COOKIE, sessionToken, getSessionCookieOptions(expiresAt));

  return response;
}
