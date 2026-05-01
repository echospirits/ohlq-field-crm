import { createHash, randomBytes } from 'crypto';
import { User } from '@prisma/client';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from './prisma';

export const SESSION_COOKIE = 'echo_session';
export const OAUTH_STATE_COOKIE = 'echo_oauth_state';

const SESSION_DAYS = 30;

export const getSessionCookieOptions = (expires?: Date) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  expires,
});

export const createSessionToken = () => randomBytes(32).toString('base64url');

export const hashSessionToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const getSessionExpiresAt = () => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);
  return expiresAt;
};

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  const session = await prisma.userSession.findFirst({
    where: {
      tokenHash: hashSessionToken(token),
      expiresAt: { gt: new Date() },
    },
    include: { user: true },
  });

  return session?.user ?? null;
}

export async function requireUser() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  return user;
}

export const getUserDisplayName = (user: Pick<User, 'email' | 'name'> | null | undefined) =>
  user?.name || user?.email || 'Unknown user';
