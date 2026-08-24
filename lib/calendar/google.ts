import { CalendarProviderName } from '@prisma/client';
import { prisma } from '../prisma';
import { decryptCalendarToken, encryptCalendarToken } from './crypto';
import type { CalendarProvider } from './provider';
import {
  CalendarProviderError,
  type CalendarChangePage,
  type CalendarEventInput,
  type CalendarEventResult,
  type CalendarListEntry,
  type CalendarProviderConnection,
  type ExternalCalendarEvent,
} from './types';

const API_ROOT = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

type GoogleEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  updated?: string;
  etag?: string;
  start?: { date?: string; dateTime?: string };
  extendedProperties?: { private?: Record<string, string> };
};

const parseGoogleEvent = (event: GoogleEvent): ExternalCalendarEvent => ({
  id: event.id ?? '',
  status: event.status === 'cancelled' ? 'cancelled' : 'confirmed',
  title: event.summary ?? null,
  description: event.description ?? null,
  startDate: event.start?.date ?? null,
  startDateTime: event.start?.dateTime ?? null,
  updatedAt: event.updated ? new Date(event.updated) : null,
  etag: event.etag ?? null,
  privateMetadata: event.extendedProperties?.private ?? {},
});

const toGoogleEvent = (input: CalendarEventInput) => ({
  summary: input.title,
  description: input.description ?? undefined,
  start:
    input.schedule.kind === 'all-day'
      ? { date: input.schedule.date }
      : { dateTime: input.schedule.startsAt.toISOString(), timeZone: input.schedule.timeZone },
  end:
    input.schedule.kind === 'all-day'
      ? { date: getNextDate(input.schedule.date) }
      : { dateTime: input.schedule.endsAt.toISOString(), timeZone: input.schedule.timeZone },
  extendedProperties: { private: input.privateMetadata },
});

const getNextDate = (date: string) => {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
};

async function parseError(response: Response) {
  const body = await response.text();
  let message = body || `Google Calendar request failed (${response.status}).`;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string };
    message = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? message;
  } catch {}
  return message.slice(0, 1000);
}

async function getAccessToken(connection: CalendarProviderConnection) {
  if (!connection.tokenExpiresAt || connection.tokenExpiresAt.getTime() > Date.now() + 60_000) {
    return decryptCalendarToken(connection.accessTokenEncrypted);
  }
  if (!connection.refreshTokenEncrypted) {
    throw new CalendarProviderError('Google authorization must be renewed.', 'missing_refresh_token', true);
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new CalendarProviderError('Google OAuth is not configured.', 'not_configured');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: decryptCalendarToken(connection.refreshTokenEncrypted),
    }),
  });
  if (!response.ok) {
    const message = await parseError(response);
    throw new CalendarProviderError(message, 'token_refresh_failed', response.status === 400 || response.status === 401);
  }
  const token = (await response.json()) as { access_token: string; expires_in?: number; refresh_token?: string };
  const expiresAt = new Date(Date.now() + (token.expires_in ?? 3600) * 1000);
  await prisma.calendarConnection.update({
    where: { id: connection.id },
    data: {
      accessTokenEncrypted: encryptCalendarToken(token.access_token),
      refreshTokenEncrypted: token.refresh_token ? encryptCalendarToken(token.refresh_token) : undefined,
      tokenExpiresAt: expiresAt,
      requiresReconnect: false,
      syncError: null,
    },
  });
  connection.accessTokenEncrypted = encryptCalendarToken(token.access_token);
  connection.tokenExpiresAt = expiresAt;
  return token.access_token;
}

async function googleFetch(connection: CalendarProviderConnection, path: string, init?: RequestInit) {
  const accessToken = await getAccessToken(connection);
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (response.status === 404 || response.status === 410) return response;
  if (!response.ok) {
    const message = await parseError(response);
    throw new CalendarProviderError(message, `google_${response.status}`, response.status === 401);
  }
  return response;
}

export const googleCalendarProvider: CalendarProvider = {
  async createEvent(connection, input) {
    const response = await googleFetch(connection, `/calendars/${encodeURIComponent(connection.selectedCalendarId)}/events`, {
      method: 'POST', body: JSON.stringify(toGoogleEvent(input)),
    });
    return toResult((await response.json()) as GoogleEvent);
  },
  async updateEvent(connection, eventId, input) {
    const response = await googleFetch(connection, `/calendars/${encodeURIComponent(connection.selectedCalendarId)}/events/${encodeURIComponent(eventId)}`, {
      method: 'PATCH', body: JSON.stringify(toGoogleEvent(input)),
    });
    if (response.status === 404 || response.status === 410) throw new CalendarProviderError('Calendar event was removed.', 'event_removed');
    return toResult((await response.json()) as GoogleEvent);
  },
  async deleteEvent(connection, eventId) {
    const response = await googleFetch(connection, `/calendars/${encodeURIComponent(connection.selectedCalendarId)}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
    if (response.status === 404 || response.status === 410 || response.status === 204) return;
  },
  async getEvent(connection, eventId) {
    const response = await googleFetch(connection, `/calendars/${encodeURIComponent(connection.selectedCalendarId)}/events/${encodeURIComponent(eventId)}`);
    if (response.status === 404 || response.status === 410) return null;
    return parseGoogleEvent((await response.json()) as GoogleEvent);
  },
  async listChanges(connection, syncToken, pageToken) {
    const query = buildGoogleCalendarChangesQuery(syncToken, pageToken);
    let response: Response;
    try {
      response = await googleFetch(connection, `/calendars/${encodeURIComponent(connection.selectedCalendarId)}/events?${query}`);
    } catch (error) {
      // Tokens created by the former filtered change feed are rejected when the
      // incompatible filter is removed. Treat that one-time 400 as an expired
      // token so the caller performs a clean full synchronization.
      if (syncToken && error instanceof CalendarProviderError && error.code === 'google_400') {
        throw new CalendarProviderError('Google sync token expired.', 'sync_token_expired');
      }
      throw error;
    }
    if (response.status === 410) throw new CalendarProviderError('Google sync token expired.', 'sync_token_expired');
    const body = (await response.json()) as { items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string };
    return {
      events: (body.items ?? []).map(parseGoogleEvent).filter((event) => event.id),
      nextPageToken: body.nextPageToken ?? null,
      nextSyncToken: body.nextSyncToken ?? null,
    } satisfies CalendarChangePage;
  },
  async listCalendars(connection) {
    const response = await googleFetch(connection, '/users/me/calendarList?minAccessRole=writer');
    const body = (await response.json()) as { items?: Array<{ id?: string; summary?: string; primary?: boolean; accessRole?: string }> };
    return (body.items ?? []).filter((item) => item.id).map((item) => ({
      id: item.id!, name: item.summary ?? item.id!, primary: Boolean(item.primary), accessRole: item.accessRole ?? 'writer',
    })) satisfies CalendarListEntry[];
  },
};

export const buildGoogleCalendarChangesQuery = (syncToken?: string | null, pageToken?: string | null) => {
  const query = new URLSearchParams({ showDeleted: 'true', singleEvents: 'true' });
  if (syncToken) query.set('syncToken', syncToken);
  if (pageToken) query.set('pageToken', pageToken);
  return query;
};

const toResult = (event: GoogleEvent): CalendarEventResult => {
  if (!event.id) throw new CalendarProviderError('Google did not return an event ID.', 'missing_event_id');
  return { externalEventId: event.id, updatedAt: event.updated ? new Date(event.updated) : null, etag: event.etag ?? null };
};

export const GOOGLE_OAUTH_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];

export const getGoogleOAuthRedirectUri = () =>
  process.env.GOOGLE_REDIRECT_URI?.trim() || `${process.env.APP_BASE_URL?.replace(/\/$/, '')}/api/calendar/google/callback`;

export const getGoogleOAuthUrl = (state: string) => {
  if (!process.env.GOOGLE_CLIENT_ID || !getGoogleOAuthRedirectUri().startsWith('http')) throw new Error('Google OAuth is not configured.');
  const query = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: getGoogleOAuthRedirectUri(),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: GOOGLE_OAUTH_SCOPES.join(' '),
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
};

export const exchangeGoogleOAuthCode = async (code: string) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) throw new Error('Google OAuth is not configured.');
  const response = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: getGoogleOAuthRedirectUri(), grant_type: 'authorization_code' }),
  });
  if (!response.ok) throw new CalendarProviderError(await parseError(response), 'oauth_exchange_failed');
  return (await response.json()) as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string };
};

export const getGoogleIdentity = async (accessToken: string) => {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new CalendarProviderError(await parseError(response), 'identity_failed');
  return (await response.json()) as { sub: string; email?: string };
};

export const GOOGLE_PROVIDER = CalendarProviderName.GOOGLE;
