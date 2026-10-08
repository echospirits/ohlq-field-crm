import { NextRequest, NextResponse } from 'next/server';
import { hashPassword } from '../../../../lib/password';
import { hashPasswordResetToken, isValidPasswordResetToken } from '../../../../lib/passwordReset';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../../../lib/passwordPolicy';
import { prisma } from '../../../../lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const redirectToReset = (request: NextRequest, token: string, status: string) => {
  const destination = new URL('/reset-password', request.url);
  destination.searchParams.set('status', status);
  if (token) destination.searchParams.set('token', token);
  return NextResponse.redirect(destination, 303);
};

const redirectToLogin = (request: NextRequest, status: string) =>
  NextResponse.redirect(new URL(`/login?status=${encodeURIComponent(status)}`, request.url), 303);

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const token = String(formData.get('token') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');

  if (password !== confirmPassword) {
    return redirectToReset(request, token, 'password-mismatch');
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return redirectToReset(request, token, 'password-too-short');
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return redirectToReset(request, token, 'password-too-long');
  }
  if (!isValidPasswordResetToken(token)) {
    return redirectToReset(request, '', 'invalid');
  }

  const now = new Date();
  const reset = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashPasswordResetToken(token) },
    select: { id: true, userId: true, usedAt: true, expiresAt: true, user: { select: { email: true, isActive: true } } },
  });

  if (!reset || reset.usedAt || reset.expiresAt <= now || !reset.user.isActive) {
    return redirectToReset(request, '', 'invalid');
  }

  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: {
          id: reset.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });

      if (claimed.count !== 1) {
        throw new Error('Password reset token is no longer available.');
      }

      const updatedUser = await tx.user.updateMany({
        where: { id: reset.userId, isActive: true, passwordHash: { not: null } },
        data: { passwordHash: hashPassword(password) },
      });

      if (updatedUser.count !== 1) {
        throw new Error('Password reset account is no longer available.');
      }

      await tx.passwordResetToken.updateMany({
        where: { userId: reset.userId, usedAt: null },
        data: { usedAt: now },
      });
      await tx.userSession.deleteMany({ where: { userId: reset.userId } });
      await tx.loginThrottle.deleteMany({ where: { identifier: reset.user.email } });
    });
  } catch {
    console.error('Password reset completion failed.');
    return redirectToReset(request, token, 'try-again');
  }

  return redirectToLogin(request, 'password-reset');
}
