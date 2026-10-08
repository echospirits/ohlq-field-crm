export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { APP_NAME, buildPageMetadata } from '../../lib/appBrand';
import { hashPasswordResetToken, isValidPasswordResetToken } from '../../lib/passwordReset';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../lib/passwordPolicy';
import { prisma } from '../../lib/prisma';
import { ResetPasswordForm } from './ResetPasswordForm';

export const metadata = buildPageMetadata('Reset Password');

const statusMessages: Record<string, string> = {
  'password-mismatch': 'Password and confirmation must match.',
  'password-too-short': `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
  'password-too-long': `Password must be no more than ${PASSWORD_MAX_LENGTH} characters.`,
  'try-again': 'We could not update your password. Try submitting the form again.',
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string; token?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const token = String(params.token ?? '').trim();
  const reset = isValidPasswordResetToken(token)
    ? await prisma.passwordResetToken.findFirst({
        where: {
          tokenHash: hashPasswordResetToken(token),
          usedAt: null,
          expiresAt: { gt: new Date() },
          user: { isActive: true, passwordHash: { not: null } },
        },
        select: { id: true },
      })
    : null;

  if (!reset) {
    return (
      <div className="login-panel">
        <h1>Reset link unavailable</h1>
        <p className="muted">This link has expired or has already been used. Request a new password reset from the sign-in page.</p>
        <Link className="btn" href="/login">Return to sign in</Link>
      </div>
    );
  }

  return (
    <div className="login-panel">
      <h1>Choose a new password</h1>
      <p className="muted">Set a new password for your {APP_NAME} account.</p>
      {params.status ? <p className="pill" role="alert">{statusMessages[params.status] ?? 'Check the form and try again.'}</p> : null}
      <ResetPasswordForm token={token} />
    </div>
  );
}
