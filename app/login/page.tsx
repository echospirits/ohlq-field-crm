export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { redirect } from 'next/navigation';
import { getCurrentUser } from '../../lib/auth';

const statusMessages: Record<string, string> = {
  'google-not-configured': 'Google sign-in is not configured yet.',
  'invalid-google-state': 'The Google sign-in session expired. Try again.',
  'google-token-error': 'Google sign-in could not be completed.',
  'google-profile-error': 'Google did not return a verified email address.',
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
      <p className="muted">Sign in with your Google account to use the field CRM.</p>
      {params.status ? <p className="pill">{statusMessages[params.status] ?? params.status}</p> : null}
      <a className="btn" href="/api/auth/google/start">
        Continue with Google
      </a>
    </div>
  );
}
