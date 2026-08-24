export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { CalendarSyncStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { buildPageMetadata } from '../../../lib/appBrand';
import { requireUser } from '../../../lib/auth';
import { getCalendarProvider } from '../../../lib/calendar';
import { GOOGLE_PROVIDER, googleCalendarProvider } from '../../../lib/calendar/google';
import { syncGoogleCalendarConnection, syncOutstandingWorklistItemsForUser } from '../../../lib/calendar/worklistSync';
import { formatEasternDateTime } from '../../../lib/dateTime';
import { prisma } from '../../../lib/prisma';
import { PageHeader } from '../../components/PageChrome';

export const metadata = buildPageMetadata('Calendar Settings');

const messages: Record<string, string> = {
  connected: 'Google Calendar connected.',
  disconnected: 'Google Calendar disconnected.',
  updated: 'Calendar settings updated.',
  resynced: 'Outstanding Neat tasks were pushed to Google Calendar.',
  checked: 'Google Calendar changes were checked and applied to Neat.',
  'check-failed': 'Google Calendar could not be checked. Review the sync status below and try again.',
  'authorization-cancelled': 'Google authorization was cancelled.',
  'invalid-oauth-response': 'Google returned an invalid authorization response.',
  'invalid-state': 'The authorization request expired or was not valid. Try connecting again.',
  'connection-failed': 'Google Calendar could not be connected. Check the setup and try again.',
  'not-configured': 'Google Calendar OAuth is not configured for this environment.',
};

async function updateCalendarSettings(formData: FormData) {
  'use server';
  const user = await requireUser();
  const connection = await prisma.calendarConnection.findUnique({ where: { userId_provider: { userId: user.id, provider: GOOGLE_PROVIDER } } });
  if (!connection) redirect('/settings/calendar');
  const calendarId = String(formData.get('calendarId') ?? '').trim();
  const calendars = await googleCalendarProvider.listCalendars(connection);
  const selected = calendars.find((calendar) => calendar.id === calendarId);
  if (!selected) redirect('/settings/calendar?status=invalid-calendar');
  const syncEnabled = formData.get('syncEnabled') === 'on';
  if (selected.id !== connection.selectedCalendarId || !syncEnabled) {
    const links = await prisma.worklistCalendarEvent.findMany({ where: { connectionId: connection.id, externalEventId: { not: null } } });
    for (const link of links) {
      try { await googleCalendarProvider.deleteEvent(connection, link.externalEventId!); }
      catch (error) { console.error('Old calendar event cleanup failed', { linkId: link.id, error: error instanceof Error ? error.message : String(error) }); }
    }
    await prisma.worklistCalendarEvent.updateMany({
      where: { connectionId: connection.id },
      data: {
        externalEventId: null,
        calendarId: null,
        syncStatus: syncEnabled ? CalendarSyncStatus.PENDING : CalendarSyncStatus.DISABLED,
        eventEtag: null,
        eventUpdatedAt: null,
        syncError: syncEnabled ? null : 'Calendar sync is disabled.',
      },
    });
  }
  await prisma.calendarConnection.update({
    where: { id: connection.id },
    data: { selectedCalendarId: selected.id, selectedCalendarName: selected.name, syncEnabled, syncToken: null, syncError: null },
  });
  await prisma.worklistCalendarEvent.updateMany({
    where: { connectionId: connection.id },
    data: {
      syncStatus: syncEnabled ? CalendarSyncStatus.PENDING : CalendarSyncStatus.DISABLED,
      syncError: syncEnabled ? null : 'Calendar sync is disabled.',
    },
  });
  if (syncEnabled) await syncOutstandingWorklistItemsForUser(user.id);
  revalidatePath('/settings/calendar');
  redirect('/settings/calendar?status=updated');
}

async function resyncCalendar() {
  'use server';
  const user = await requireUser();
  await prisma.worklistCalendarEvent.updateMany({ where: { worklistItem: { assignedToUserId: user.id }, provider: GOOGLE_PROVIDER }, data: { syncStatus: CalendarSyncStatus.PENDING, syncError: null } });
  await syncOutstandingWorklistItemsForUser(user.id);
  revalidatePath('/settings/calendar');
  redirect('/settings/calendar?status=resynced');
}

async function checkCalendarChanges() {
  'use server';
  const user = await requireUser();
  const connection = await prisma.calendarConnection.findUnique({
    where: { userId_provider: { userId: user.id, provider: GOOGLE_PROVIDER } },
  });
  if (!connection) redirect('/settings/calendar');
  let status = 'checked';
  try {
    await syncGoogleCalendarConnection(connection.id);
  } catch (error) {
    status = 'check-failed';
    console.error('Manual Google Calendar check failed', { userId: user.id, error: error instanceof Error ? error.message : String(error) });
  }
  revalidatePath('/settings/calendar');
  redirect(`/settings/calendar?status=${status}`);
}

async function disconnectCalendar() {
  'use server';
  const user = await requireUser();
  const connection = await prisma.calendarConnection.findUnique({
    where: { userId_provider: { userId: user.id, provider: GOOGLE_PROVIDER } },
    include: { worklistCalendarEvents: true },
  });
  if (!connection) redirect('/settings/calendar');
  const provider = getCalendarProvider(GOOGLE_PROVIDER);
  for (const link of connection.worklistCalendarEvents) {
    if (link.externalEventId) {
      try { await provider.deleteEvent(connection, link.externalEventId); }
      catch (error) { console.error('Calendar event cleanup during disconnect failed', { linkId: link.id, error: error instanceof Error ? error.message : String(error) }); }
    }
  }
  await prisma.worklistCalendarEvent.updateMany({
    where: { connectionId: connection.id },
    data: { connectionId: null, externalEventId: null, calendarId: null, syncStatus: CalendarSyncStatus.DISABLED, syncError: 'Calendar disconnected.' },
  });
  await prisma.calendarConnection.delete({ where: { id: connection.id } });
  revalidatePath('/settings/calendar');
  redirect('/settings/calendar?status=disconnected');
}

export default async function CalendarSettingsPage({ searchParams }: { searchParams?: Promise<{ status?: string }> }) {
  const user = await requireUser();
  const params = (await searchParams) ?? {};
  const connection = await prisma.calendarConnection.findUnique({ where: { userId_provider: { userId: user.id, provider: GOOGLE_PROVIDER } } });
  let calendars: Array<{ id: string; name: string }> = [];
  if (connection && !connection.requiresReconnect) {
    try { calendars = await googleCalendarProvider.listCalendars(connection); }
    catch (error) { console.error('Unable to list Google calendars', { userId: user.id, error: error instanceof Error ? error.message : String(error) }); }
  }
  return (
    <>
      <PageHeader eyebrow="Account" title="Calendar integration" description="Put dated Neat follow-ups on your calendar and keep schedule changes in sync." />
      {params.status ? <p className="toast-notice page-status">{messages[params.status] ?? params.status}</p> : null}
      <div className="workflow-shell"><section className="card admin-panel calendar-settings-card">
        <div className="section-heading"><div><h2>Google Calendar</h2><p className="muted">Each user connects their own account. Neat follow-ups continue to work when no calendar is connected.</p></div><span className="pill">{connection ? (connection.requiresReconnect ? 'Reconnect required' : 'Connected') : 'Not connected'}</span></div>
        {!connection ? <a className="button-link" href="/api/calendar/google/connect">Connect Google Calendar</a> : (
          <>
            <dl className="integration-summary">
              <div><dt>Google account</dt><dd>{connection.providerEmail ?? 'Connected account'}</dd></div>
              <div><dt>Calendar</dt><dd>{connection.selectedCalendarName ?? connection.selectedCalendarId}</dd></div>
              <div><dt>Last checked</dt><dd>{formatEasternDateTime(connection.lastSyncAt) || 'Not yet'}</dd></div>
              {connection.syncError ? <div><dt>Sync status</dt><dd className="error-text">{connection.syncError}</dd></div> : null}
            </dl>
            {connection.requiresReconnect ? <a className="button-link" href="/api/calendar/google/connect">Reconnect Google Calendar</a> : (
              <form action={updateCalendarSettings}>
                <label>Calendar<select name="calendarId" defaultValue={connection.selectedCalendarId}>{calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</select></label>
                <label className="checkbox-row"><input name="syncEnabled" type="checkbox" defaultChecked={connection.syncEnabled} /> Sync Neat follow-ups</label>
                <button type="submit">Save calendar settings</button>
              </form>
            )}
            <div className="action-row">
              <form action={checkCalendarChanges}><button className="secondary" type="submit">Check Google for changes</button></form>
              <form action={resyncCalendar}><button className="secondary" type="submit">Push Neat tasks to Google</button></form>
              <form action={disconnectCalendar}><button className="secondary" type="submit">Disconnect</button></form>
            </div>
          </>
        )}
      </section></div>
    </>
  );
}
