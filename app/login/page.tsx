export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../lib/auth';

const statusMessages: Record<string, string> = {
  'invalid-credentials': 'Email or password is incorrect.',
  'missing-credentials': 'Email and password are required.',
  locked: 'Too many failed sign-in attempts. Wait 15 minutes and try again.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string }>;
}) {
  const [params, user] = await Promise.all([(await searchParams) ?? {}, getCurrentUser()]);

  if (user) {
    redirect('/');
  }

  return (
    <div className="login-panel">
      <h1>Echo Spirits Distilling Co.</h1>
      <p className="muted">Sign in with your Echo Field CRM account.</p>
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
