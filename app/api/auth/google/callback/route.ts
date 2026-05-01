import { NextRequest, NextResponse } from 'next/server';
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  createSessionToken,
  getSessionCookieOptions,
  getSessionExpiresAt,
  hashSessionToken,
} from '../../../../../lib/auth';
import { prisma } from '../../../../../lib/prisma';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
};

type GoogleUserInfo = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

const getBaseUrl = (request: NextRequest) => process.env.AUTH_BASE_URL || new URL(request.url).origin;

const redirectToLogin = (request: NextRequest, status: string) =>
  NextResponse.redirect(new URL(`/login?status=${encodeURIComponent(status)}`, request.url));

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const storedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!code || !state || !storedState || state !== storedState) {
    return redirectToLogin(request, 'invalid-google-state');
  }

  if (!clientId || !clientSecret) {
    return redirectToLogin(request, 'google-not-configured');
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${getBaseUrl(request)}/api/auth/google/callback`,
    }),
  });
  const tokenJson = (await tokenResponse.json()) as GoogleTokenResponse;

  if (!tokenResponse.ok || !tokenJson.access_token) {
    return redirectToLogin(request, tokenJson.error || 'google-token-error');
  }

  const userInfoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${tokenJson.access_token}` },
  });
  const userInfo = (await userInfoResponse.json()) as GoogleUserInfo;

  if (!userInfoResponse.ok || !userInfo.sub || !userInfo.email || userInfo.email_verified === false) {
    return redirectToLogin(request, 'google-profile-error');
  }

  const sessionToken = createSessionToken();
  const expiresAt = getSessionExpiresAt();
  const user = await prisma.user.upsert({
    where: { email: userInfo.email },
    create: {
      googleId: userInfo.sub,
      email: userInfo.email,
      name: userInfo.name,
      image: userInfo.picture,
    },
    update: {
      googleId: userInfo.sub,
      name: userInfo.name,
      image: userInfo.picture,
    },
  });

  await prisma.userSession.create({
    data: {
      tokenHash: hashSessionToken(sessionToken),
      userId: user.id,
      expiresAt,
    },
  });

  const response = NextResponse.redirect(new URL('/', request.url));
  response.cookies.set(SESSION_COOKIE, sessionToken, getSessionCookieOptions(expiresAt));
  response.cookies.set(OAUTH_STATE_COOKIE, '', {
    ...getSessionCookieOptions(new Date(0)),
    maxAge: 0,
  });

  return response;
}
