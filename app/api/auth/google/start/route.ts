import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { OAUTH_STATE_COOKIE, getSessionCookieOptions } from '../../../../../lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const getBaseUrl = (request: NextRequest) => process.env.AUTH_BASE_URL || new URL(request.url).origin;

export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;

  if (!clientId) {
    return NextResponse.redirect(new URL('/login?status=google-not-configured', request.url));
  }

  const state = randomBytes(24).toString('base64url');
  const redirectUri = `${getBaseUrl(request)}/api/auth/google/callback`;
  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');

  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  }).toString();

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    ...getSessionCookieOptions(new Date(Date.now() + 10 * 60 * 1000)),
    maxAge: 10 * 60,
  });

  return response;
}
