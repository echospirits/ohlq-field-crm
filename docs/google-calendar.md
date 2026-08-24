# Google Calendar integration

The CRM remains the source of truth for task identity, account, assignment, notes, and status. Google Calendar may change only the linked task's date and optional time. Personal events are never imported.

## Architecture

- `CalendarConnection` stores one provider connection per CRM user. OAuth tokens are AES-256-GCM encrypted and are only decrypted in server code.
- `WorklistCalendarEvent` links a Worklist item to its provider event and records the Google event ID, calendar, etag, provider update time, schedule hash, last sync, and error/status.
- `lib/calendar/provider.ts` defines the provider contract. Google implements it in `lib/calendar/google.ts`; Microsoft or Apple can implement the same interface without changing Worklist UI/actions.
- CRM writes call `syncWorklistItemCalendar` after the database write. Provider errors are caught and recorded, so task creation, edits, reassignment, completion, and cancellation still succeed.
- `/api/cron/calendar-sync` uses Google incremental sync tokens. Google forbids combining a sync token with an extended-property filter, so Neat reads the change feed but applies and stores changes only when the Google event ID already exists in `WorklistCalendarEvent`. Unlinked personal events are ignored and never imported. Only date/time may be updated in Neat.

Date-only tasks remain `dueDate` plus a null `dueTimeMinutes` and become all-day events. A timed task stores minutes after midnight in `dueTimeMinutes`; Google receives a 30-minute event in `America/New_York`. This avoids mixing a wall-clock choice with UTC/DST conversion in the database.

## Google Cloud Console setup

1. Create or select a Google Cloud project and enable **Google Calendar API**.
2. Configure the OAuth consent screen. Add the production users as test users while the app is in Testing status, or complete Google's production publishing/verification steps before broad use.
3. Create an **OAuth client ID** of type **Web application**.
4. Add the exact authorized redirect URI:
   - Local: `http://localhost:3000/api/calendar/google/callback`
   - Production: `https://YOUR_APP_DOMAIN/api/calendar/google/callback`
5. Configure these scopes on the consent screen:
   - `openid`
   - `email`
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`

`calendar.events` creates, edits, reads, and removes events; Calendar List read access is used only to let the user select a writable calendar. The integration does not request broad read access to arbitrary calendar contents.

## Environment variables

Set these in each environment that should support calendar connection, then redeploy:

```text
APP_BASE_URL=https://YOUR_APP_DOMAIN
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://YOUR_APP_DOMAIN/api/calendar/google/callback
CALENDAR_TOKEN_ENCRYPTION_KEY=a-stable-random-secret-at-least-32-characters
CRON_SECRET=...
```

`GOOGLE_REDIRECT_URI` may be omitted when `APP_BASE_URL` is correct. Do not rotate `CALENDAR_TOKEN_ENCRYPTION_KEY` without first planning for users to reconnect; old tokens cannot be decrypted with a new key. Never expose these variables with a `NEXT_PUBLIC_` prefix.

Apply the migration before deploying code that uses it:

```powershell
npm run db:migrate
```

## Sync behavior

- Create/update: a dated, active task assigned to a connected user is created or updated in that user's selected calendar.
- Reassignment: the old event is removed, then a new event is created for the new assignee. If the new user is not connected, the task remains valid and is marked Calendar disabled/not connected.
- Complete/cancel: the linked event is removed, whether future or past.
- Calendar reschedule: the polling job updates `dueDate` and `dueTimeMinutes` only. Google title/description edits do not overwrite CRM content.
- Manual pull: **Check Google for changes** in Calendar settings runs the same safe Google-to-Neat check immediately instead of waiting for the daily poll.
- Manual event deletion: the link becomes `REMOVED` and is not automatically recreated. The user may choose **Push Neat tasks to Google** in Calendar settings.
- Disconnect: linked events are removed on a best-effort basis, tokens are deleted, and CRM tasks remain unchanged.
- Failure/revocation: failures are stored on the link/connection. Revoked credentials disable syncing and show a reconnect state. CRM mutations are not rolled back.

Mirrored-update loops are prevented with the Google etag/provider timestamp plus a deterministic CRM schedule hash. A provider change that matches the stored etag or current CRM schedule is acknowledged without writing the task or sending another provider update.

## Vercel scheduling and limits

`vercel.json` polls once daily at 10:00 UTC (6:00 AM EDT / 5:00 AM EST), which is compatible with the current Vercel Hobby plan. Vercel sends `Authorization: Bearer $CRON_SECRET`, and the route rejects any other request. Vercel cron runs only on Production deployments. If faster Google-to-CRM updates are needed later, upgrade to Pro and shorten this interval.

## Manual QA

1. Apply the database migration and configure/redeploy the environment variables.
2. In Profile > Calendar settings, connect Google and select a writable calendar.
3. On mobile, log a Wholesale visit, choose Create worklist item, enter note/date, optionally enter time, confirm the responsible person defaults to you, choose another active user, and save.
4. Confirm the Worklist item has the selected owner/date/time. If that owner is connected, confirm the Google event exists.
5. Edit the task date/time/title and confirm the existing event updates without duplication.
6. Move the event in Google; after the cron runs, confirm only the CRM date/time changed.
7. Reassign the task between two connected users and confirm the event leaves the first calendar and appears on the second.
8. Reassign to a user with no connection and confirm the CRM task remains while no new event is created.
9. Complete and cancel test tasks and confirm their events disappear.
10. Delete a linked event in Google, run the cron, confirm the task shows removed/unsynced, then use Resync outstanding tasks to recreate it.

## Current limitations

- Google is the only implemented provider.
- Sync is polling-based, so Google-to-CRM changes can currently take up to 24 hours. CRM-to-Google changes still sync immediately after the CRM write.
- Calendar edits affect scheduling only; title and description remain one-way from CRM to Google.
- Timed events use a fixed 30-minute duration and the shared `America/New_York` timezone because the CRM has no per-user timezone setting.
- One connected provider account per user is supported. The schema and event links are provider-neutral, so Microsoft Graph or an Apple/CalDAV adapter can be added behind `CalendarProvider` later.
