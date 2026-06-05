export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../lib/auth';
import { getTenantConfig } from '../../lib/tenantConfig';

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
  const tenantConfig = getTenantConfig();
  const [params, user] = await Promise.all([(await searchParams) ?? {}, getCurrentUser()]);

  if (user) {
    redirect('/');
  }

  return (
    <div className="login-panel">
      <h1>{tenantConfig.entityName}</h1>
      <p className="muted">Sign in with your {tenantConfig.appName} account.</p>
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
