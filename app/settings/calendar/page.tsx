export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

import { SubmitButton } from '../../components/SubmitButton';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { buildPageMetadata } from '../../../lib/appBrand';
import { assertSideEffectEnabled, isSideEffectEnabled } from '../../../lib/appEnvironment';
import { requireUser } from '../../../lib/auth';

import { GOOGLE_PROVIDER, googleCalendarProvider } from '../../../lib/calendar/google';
import { changeGoogleCalendarSettings, syncGoogleCalendarConnection } from '../../../lib/calendar/worklistSync';
import { formatEasternDateTime } from '../../../lib/dateTime';
import { prisma } from '../../../lib/prisma';
import { PageHeader } from '../../components/PageChrome';

export const metadata = buildPageMetadata('Calendar Settings');

const messages: Record<string, string> = {
  connected: 'Google Calendar connected.',
  disconnected: 'Google Calendar disconnected.',
  updated: 'Calendar settings updated.',
  resynced: 'Outstanding Neat tasks were pushed to Google Calendar.',
  checked: 'Calendar check completed. Task schedules are up to date.',
  partial: 'Google changes were checked, but some tasks could not finish syncing. Retry the check.',
  busy: 'Another calendar operation is running. Try again shortly.',
  paused: 'Sync is paused. Enable Sync Neat follow-ups to check for changes.',
  reconnect: 'Reconnect Google Calendar before checking for changes.',
  'not-connected': 'Connect Google Calendar before checking for changes.',
  'cleanup-failed': 'Some events could not be removed. Your old calendar links were retained and sync is paused. Reconnect if needed, then retry.',
  'settings-failed': 'Calendar settings could not be saved. Try again.',
  'invalid-calendar': 'Choose an available writable calendar.',
  'account-change-blocked': 'Disconnect your current Google account before connecting a different account.',
  'calendar-unavailable': 'Your linked calendar is unavailable. Choose an available calendar in settings.',
  'check-failed': 'Google Calendar could not be checked. Review the sync status below and try again.',
  'authorization-cancelled': 'Google authorization was cancelled.',
  'invalid-oauth-response': 'Google returned an invalid authorization response.',
  'invalid-state': 'The authorization request expired or was not valid. Try connecting again.',
  'connection-failed': 'Google Calendar could not be connected. Check the setup and try again.',
  'not-configured': 'Google Calendar OAuth is not configured for this environment.',
  'environment-disabled': 'Google Calendar side effects are disabled in this environment.',
};

function refreshWorklistViews() {
  for (const path of ['/settings/calendar', '/alerts', '/my-day', '/my-week', '/wholesale', '/agencies']) revalidatePath(path);
}
function checkStatus(result: Awaited<ReturnType<typeof syncGoogleCalendarConnection>>) {
  if (result.skipped) return result.reason ?? 'check-failed';
  return result.failed ? 'partial' : 'checked';
}
async function updateCalendarSettings(formData: FormData) {
  'use server';
  assertSideEffectEnabled('calendar');
  const user = await requireUser();
  const syncEnabled = formData.get('syncEnabled') === 'on';
  const result = await changeGoogleCalendarSettings(user.id, String(formData.get('calendarId') ?? '').trim(), syncEnabled);
  let status = result.status;
  if (status === 'updated' && syncEnabled) {
    const connection = await prisma.calendarConnection.findUnique({ where: { userId_provider: { userId: user.id, provider: GOOGLE_PROVIDER } } });
    try { if (connection) status = checkStatus(await syncGoogleCalendarConnection(connection.id)); }
    catch { status = 'check-failed'; }
  }
  refreshWorklistViews();
  redirect('/settings/calendar?status=' + encodeURIComponent(status));
}
async function checkCalendarChanges(formData: FormData) {
  'use server';
  assertSideEffectEnabled('calendar');
  const user = await requireUser();
  const connection = await prisma.calendarConnection.findUnique({ where: { userId_provider: { userId: user.id, provider: GOOGLE_PROVIDER } } });
  if (!connection) redirect('/settings/calendar?status=not-connected');
  let status: string;
  try {
    status = checkStatus(await syncGoogleCalendarConnection(connection.id, { restoreRemoved: formData.get('restoreRemoved') === 'true' }));
  } catch (error) {
    status = 'check-failed';
    console.error('Manual calendar check failed', { userId: user.id, error: error instanceof Error ? error.message : String(error) });
  }
  refreshWorklistViews();
  redirect('/settings/calendar?status=' + encodeURIComponent(status));
}
async function disconnectCalendar() {
  'use server';
  assertSideEffectEnabled('calendar');
  const user = await requireUser();
  const result = await changeGoogleCalendarSettings(user.id, '', false, true);
  refreshWorklistViews();
  redirect('/settings/calendar?status=' + encodeURIComponent(result.status));
}

export default async function CalendarSettingsPage({ searchParams }: { searchParams?: Promise<{ status?: string }> }) {
  const user = await requireUser();
  const calendarEnabled = isSideEffectEnabled('calendar');
  const params = (await searchParams) ?? {};
  const connection = await prisma.calendarConnection.findUnique({ where: { userId_provider: { userId: user.id, provider: GOOGLE_PROVIDER } } });
  let calendars: Array<{ id: string; name: string }> = [];
  if (calendarEnabled && connection && !connection.requiresReconnect) {
    try { calendars = await googleCalendarProvider.listCalendars(connection); }
    catch (error) { console.error('Unable to list Google calendars', { userId: user.id, error: error instanceof Error ? error.message : String(error) }); }
  }
  const syncAvailable = Boolean(calendarEnabled && connection?.syncEnabled && !connection.requiresReconnect);
  return (
    <>
      <PageHeader eyebrow="Account" title="Calendar integration" description="Put dated Neat follow-ups on your calendar and keep schedule changes in sync." />
      {!calendarEnabled ? <p className="toast-notice page-status calendar-sync-notice">Calendar connections and synchronization are disabled in this environment.</p> : null}
      {params.status ? <p role="status" className={'toast-notice page-status' + (['connected', 'updated', 'disconnected', 'checked'].includes(params.status) ? '' : ' calendar-sync-notice')}>{messages[params.status] ?? 'Calendar action could not be completed. Try again.'}</p> : null}
      <p className="muted">Google date and time changes update Neat at the daily check. Use Check and sync now for an immediate update. Task titles, notes, owners, and completion are managed in Neat.</p>
      <div className="workflow-shell"><section className="card admin-panel calendar-settings-card">
        <div className="section-heading"><div><h2>Google Calendar</h2><p className="muted">Each user connects their own account. Neat follow-ups continue to work when no calendar is connected.</p></div><span className="pill">{connection ? (connection.requiresReconnect ? 'Reconnect required' : connection.syncEnabled ? 'Connected' : 'Sync paused') : 'Not connected'}</span></div>
        {!connection ? (calendarEnabled ? <a className="button-link" href="/api/calendar/google/connect">Connect Google Calendar</a> : null) : (
          <>
            <dl className="integration-summary">
              <div><dt>Google account</dt><dd>{connection.providerEmail ?? 'Connected account'}</dd></div>
              <div><dt>Calendar</dt><dd>{connection.selectedCalendarName ?? connection.selectedCalendarId}</dd></div>
              <div><dt>Last successful check</dt><dd>{formatEasternDateTime(connection.lastSyncAt) || 'Not yet'}</dd></div>
              {connection.syncError ? <div><dt>Sync status</dt><dd><span className="error-text">Some calendar work needs attention. Retry the check or reconnect if required.</span><details><summary>Sync details</summary><p>{connection.syncError}</p></details></dd></div> : null}
            </dl>
            {connection.requiresReconnect ? (calendarEnabled ? <a className="button-link" href="/api/calendar/google/connect">Reconnect Google Calendar</a> : null) : (calendarEnabled ? (
              <form action={updateCalendarSettings}>
                <label>Calendar<select name="calendarId" defaultValue={connection.selectedCalendarId}>{calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</select></label>
                <label className="checkbox-label"><input name="syncEnabled" type="checkbox" defaultChecked={connection.syncEnabled} /> Sync Neat follow-ups</label>
                <SubmitButton type="submit" disabled={!calendars.length}>Save calendar settings</SubmitButton>
                {!calendars.length ? <p className="muted">Calendars could not be loaded. Reconnect or try again.</p> : null}
              </form>
            ) : null)}
            {calendarEnabled && !syncAvailable ? <p className="muted">{connection.requiresReconnect ? 'Reconnect to resume calendar checks.' : 'Enable Sync Neat follow-ups to resume calendar checks.'}</p> : null}
            {calendarEnabled ? <div className="action-row">
              <form action={checkCalendarChanges}><SubmitButton className="secondary" disabled={!syncAvailable} pendingLabel="Checking…" type="submit">Check and sync now</SubmitButton></form>
              <form action={checkCalendarChanges}><input type="hidden" name="restoreRemoved" value="true" /><SubmitButton className="secondary" disabled={!syncAvailable} pendingLabel="Restoring…" type="submit">Restore removed events</SubmitButton></form>
              <form action={disconnectCalendar}><SubmitButton className="secondary" type="submit">Disconnect</SubmitButton></form>
            </div> : null}
            {calendarEnabled ? <p className="muted">Restore removed events recreates deleted Google events for active, dated Neat follow-ups. It does not delete or complete Neat tasks.</p> : null}
          </>
        )}
      </section></div>
    </>
  );
}
