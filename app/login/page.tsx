export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { redirect } from 'next/navigation';
import { APP_COMPANY, APP_NAME, buildPageMetadata } from '../../lib/appBrand';
import { getCurrentUser } from '../../lib/auth';
import { getSignedInHomePath } from '../../lib/userAccess';

export const metadata = buildPageMetadata('Sign in');

const statusMessages: Record<string, string> = {
  'invalid-credentials': 'Email or password is incorrect.',
  'missing-credentials': 'Email and password are required.',
  'invite-accepted': 'Your password was created. Sign in to continue.',
  locked: 'Too many failed sign-in attempts. Wait 15 minutes and try again.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const [params, user] = await Promise.all([(await searchParams) ?? {}, getCurrentUser()]);

  if (user) {
    redirect(getSignedInHomePath(user.role));
  }

  return (
    <div className="login-panel">
      <div className="login-brand">
        <span className="login-brand-mark" aria-hidden="true">N.</span>
        <div>
          <h1>{APP_NAME}</h1>
          <p>Sales intelligence for {APP_COMPANY}</p>
        </div>
      </div>
      <p className="muted">Sign in to your {APP_NAME} account.</p>
      {params.status ? <p className="pill">{statusMessages[params.status] ?? params.status}</p> : null}
      <form action="/api/auth/login" method="post">
        <label>
          Email
          <input autoComplete="email" name="email" type="email" required />
        </label>
        <label>
          Password
          <input autoComplete="current-password" name="password" type="password" required />
        </label>
        <button type="submit">Sign in</button>
      </form>
    </div>
  );
}
