export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import Link from 'next/link';
import { APP_NAME, buildPageMetadata } from '../../lib/appBrand';
import { getUserDisplayName } from '../../lib/auth';
import { formatEasternDateTime } from '../../lib/dateTime';
import { prisma } from '../../lib/prisma';
import { hashUserInvitationToken } from '../../lib/userInvitations';
import { acceptUserInvitation } from './actions';

export const metadata = buildPageMetadata('Accept Invitation');

const statusMessages: Record<string, string> = {
  invalid: 'This invitation link is invalid, expired, or has already been used.',
  'password-mismatch': 'Password and confirmation must match.',
  'password-too-short': 'Password must be at least 10 characters.',
};

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams?: Promise<{
    status?: string;
    token?: string;
  }>;
}) {
  const params = (await searchParams) ?? {};
  const token = String(params.token ?? '').trim();
  const invitation = token
    ? await prisma.userInvitation.findFirst({
        where: {
          tokenHash: hashUserInvitationToken(token),
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: {
          expiresAt: true,
          user: {
            select: {
              email: true,
              firstName: true,
              lastName: true,
              name: true,
            },
          },
        },
      })
    : null;

  if (!invitation) {
    return (
      <div className="login-panel">
        <h1>Invitation unavailable</h1>
        <p className="pill">{statusMessages.invalid}</p>
        <Link className="btn" href="/login">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="login-panel">
      <h1>Create your password</h1>
      <p className="muted">
        Finish setting up the {APP_NAME} account for {getUserDisplayName(invitation.user)}.
      </p>
      {params.status ? <p className="pill">{statusMessages[params.status] ?? params.status}</p> : null}
      <form action={acceptUserInvitation}>
        <input name="token" type="hidden" value={token} />
        <label>
          Password
          <input autoComplete="new-password" minLength={10} name="password" type="password" required />
        </label>
        <label>
          Confirm password
          <input autoComplete="new-password" minLength={10} name="confirmPassword" type="password" required />
        </label>
        <button type="submit">Create password</button>
      </form>
      <p className="muted">This invitation expires {formatEasternDateTime(invitation.expiresAt)}.</p>
    </div>
  );
}
