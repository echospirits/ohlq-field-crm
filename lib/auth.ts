import { createHash, randomBytes } from 'crypto';
import { UserRole } from '@prisma/client';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from './prisma';

export const SESSION_COOKIE = 'echo_session';

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

export async function createUserSession(userId: string) {
  const sessionToken = createSessionToken();
  const expiresAt = getSessionExpiresAt();

  await prisma.userSession.create({
    data: {
      tokenHash: hashSessionToken(sessionToken),
      userId,
      expiresAt,
    },
  });

  return { expiresAt, sessionToken };
}

export async function getCurrentUser() {
  const session = await getCurrentSession();

  return session?.user ?? null;
}

export async function getCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  return prisma.userSession.findFirst({
    where: {
      tokenHash: hashSessionToken(token),
      expiresAt: { gt: new Date() },
      user: { isActive: true },
    },
    include: { user: true },
  });
}

export async function requireUserSession() {
  const session = await getCurrentSession();

  if (!session) {
    redirect('/login');
  }

  return session;
}

export async function requireUser() {
  const { user } = await requireUserSession();

  return user;
}

export async function requireAdminSession() {
  const session = await requireUserSession();

  if (session.user.role !== UserRole.ADMIN) {
    redirect('/');
  }

  return session;
}

export async function requireAdmin() {
  const { user } = await requireAdminSession();

  return user;
}

type DisplayUser = {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
};

export const getUserDisplayName = (user: DisplayUser | null | undefined) => {
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();

  return fullName || user?.name || user?.email || 'Unknown user';
};
