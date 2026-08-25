export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { requireUser } from '../../../../../lib/auth';
import { encryptCalendarToken } from '../../../../../lib/calendar/crypto';
import {
  GOOGLE_PROVIDER,
  exchangeGoogleOAuthCode,
  getGoogleIdentity,
  googleCalendarProvider,
} from '../../../../../lib/calendar/google';
import { syncOutstandingWorklistItemsForUser } from '../../../../../lib/calendar/worklistSync';
import { prisma } from '../../../../../lib/prisma';
import { isSideEffectEnabled } from '../../../../../lib/appEnvironment';

const redirectWithStatus = (request: Request, status: string) =>
  NextResponse.redirect(new URL(`/settings/calendar?status=${encodeURIComponent(status)}`, request.url));

export async function GET(request: Request) {
  const user = await requireUser();
  if (!isSideEffectEnabled('calendar')) return redirectWithStatus(request, 'environment-disabled');
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (url.searchParams.get('error')) return redirectWithStatus(request, 'authorization-cancelled');
  if (!code || !state) return redirectWithStatus(request, 'invalid-oauth-response');

  const stateHash = createHash('sha256').update(state).digest('hex');
  const oauthState = await prisma.calendarOAuthState.findUnique({ where: { stateHash } });
  if (!oauthState || oauthState.userId !== user.id || oauthState.provider !== GOOGLE_PROVIDER || oauthState.expiresAt <= new Date()) {
    return redirectWithStatus(request, 'invalid-state');
  }
  await prisma.calendarOAuthState.delete({ where: { id: oauthState.id } });

  try {
    const token = await exchangeGoogleOAuthCode(code);
    const identity = await getGoogleIdentity(token.access_token);
    const current = await prisma.calendarConnection.findUnique({
      where: { userId_provider: { userId: user.id, provider: GOOGLE_PROVIDER } },
    });
    const temporaryConnection = {
      id: current?.id ?? 'oauth-pending',
      accessTokenEncrypted: encryptCalendarToken(token.access_token),
      refreshTokenEncrypted: token.refresh_token ? encryptCalendarToken(token.refresh_token) : current?.refreshTokenEncrypted ?? null,
      tokenExpiresAt: new Date(Date.now() + (token.expires_in ?? 3600) * 1000),
      selectedCalendarId: current?.selectedCalendarId ?? 'primary',
    };
    const calendars = await googleCalendarProvider.listCalendars(temporaryConnection);
    const selected = calendars.find((calendar) => calendar.id === current?.selectedCalendarId) ?? calendars.find((calendar) => calendar.primary) ?? calendars[0];
    if (!selected) throw new Error('No writable Google calendar is available.');
    await prisma.calendarConnection.upsert({
      where: { userId_provider: { userId: user.id, provider: GOOGLE_PROVIDER } },
      create: {
        userId: user.id,
        provider: GOOGLE_PROVIDER,
        providerAccountId: identity.sub,
        providerEmail: identity.email ?? null,
        accessTokenEncrypted: temporaryConnection.accessTokenEncrypted,
        refreshTokenEncrypted: temporaryConnection.refreshTokenEncrypted,
        tokenExpiresAt: temporaryConnection.tokenExpiresAt,
        scope: token.scope ?? '',
        selectedCalendarId: selected.id,
        selectedCalendarName: selected.name,
      },
      update: {
        providerAccountId: identity.sub,
        providerEmail: identity.email ?? null,
        accessTokenEncrypted: temporaryConnection.accessTokenEncrypted,
        refreshTokenEncrypted: temporaryConnection.refreshTokenEncrypted ?? undefined,
        tokenExpiresAt: temporaryConnection.tokenExpiresAt,
        scope: token.scope ?? current?.scope ?? '',
        selectedCalendarId: selected.id,
        selectedCalendarName: selected.name,
        syncEnabled: true,
        requiresReconnect: false,
        syncError: null,
        syncToken: null,
      },
    });
    await syncOutstandingWorklistItemsForUser(user.id);
    return redirectWithStatus(request, 'connected');
  } catch (error) {
    console.error('Google Calendar OAuth callback failed', { userId: user.id, error: error instanceof Error ? error.message : String(error) });
    return redirectWithStatus(request, 'connection-failed');
  }
}
