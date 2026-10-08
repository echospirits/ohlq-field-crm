# Google Calendar integration

The CRM remains the source of truth for task identity, account, assignment, notes, and status. Google Calendar may change only the linked task's date and optional time. Personal events are never imported.

## Architecture

- `CalendarConnection` stores one provider connection per CRM user. OAuth tokens are AES-256-GCM encrypted and are only decrypted in server code.
- `WorklistCalendarEvent` links a Worklist item to its provider event and records the Google event ID, calendar, etag, provider update time, schedule hash, last sync, and error/status.
- `lib/calendar/provider.ts` defines the provider contract. Google implements it in `lib/calendar/google.ts`; Microsoft or Apple can implement the same interface without changing Worklist UI/actions.
- CRM writes call `syncWorklistItemCalendar` after the database write. Provider errors are caught and recorded, so task creation, edits, reassignment, completion, and cancellation still succeed.
- `/api/cron/calendar-sync` uses Google incremental sync tokens. Google forbids combining a sync token with an extended-property filter, so Neat reads the change feed but applies and stores changes only when the Google event ID already exists in `WorklistCalendarEvent`. Unlinked personal events are ignored and never imported. Only date/time may be updated in Neat.
- Calendar writers, settings cleanup and OAuth connection changes share a transaction-scoped PostgreSQL advisory lock. A busy task save retains its link or queues a pending link; the next check scans active assigned tasks and existing links. CRM saves still succeed. The lock releases automatically when its transaction ends, including failures.
- A new event's random Google-compatible ID is saved before the provider POST. Uncertain responses reuse that ID, including verified recovery from Google's duplicate-ID response. Conditional ETag updates prevent blind overwrites. Existing duplicates without database links are not automatically deleted.

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

`calendar.events` creates, edits, reads, and removes events; Calendar List read access is used to select a writable calendar. The change feed can include personal events; Neat ignores unlinked events and does not store or import them.

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

Apply the original calendar migration before the initial integration deployment, using the environment-checked migration commands. The 0.14 calendar reliability cleanup requires no new migration or environment variables:

```powershell
npm run db:migrate:test
# Production migrations are a separate release task:
# npm run db:migrate:prod
```

## Sync behavior

- Create/update: a dated, active task assigned to a connected user is created or updated in that user's selected calendar. Existing events are read first to reconcile unseen Google edits before any outbound update.
- Reassignment: the old event is removed, then a new event is created for the new assignee. Failed deletion retains the original link and blocks a replacement until cleanup succeeds. If the new user is not connected, the task remains valid and is marked Calendar disabled/not connected.
- Complete/cancel: the linked event is removed, whether future or past.
- Calendar reschedule: the polling job updates `dueDate` and `dueTimeMinutes` only, after checking the current assignee, active task state, connection and calendar. A former owner's event cannot reschedule a reassigned task. Google title/description edits do not overwrite CRM content.
- Manual check: **Check and sync now** pulls changes first, then retries outbound/deferred work. It reports paused, reconnect-required, busy, failed or partial results honestly; **Last successful check** advances only after a complete successful check. Failed/missing-calendar feeds do not advance the cursor. A complete pull with partial outbound failures may retain the new cursor, since outbound work is scanned again on every check.
- Manual event deletion: the link becomes `REMOVED` and is not automatically recreated unless a newer Neat edit wins the existing timestamp conflict policy. **Restore removed events** explicitly recreates removed active, dated tasks with new event IDs; it never PATCHes a deleted ID. Deletion does not complete or delete the Neat task.
- Calendar switch, pause or disconnect: cleanup removes events from their recorded calendar before clearing IDs or replacing credentials. If cleanup fails, sync stays paused and remaining links/tokens are retained for retry. Disconnect deletes credentials only after cleanup succeeds; CRM tasks remain unchanged. Successful pause removes managed events; resume recreates active tasks.
- Reconnect: the same Google account refreshes credentials without moving existing links to a fallback calendar. If its linked calendar is unavailable, it stays selected and paused so the user can explicitly choose another. Connecting a different Google account requires successful disconnect first.
- Failure/revocation: failures are stored on the link/connection. Revoked credentials disable syncing and show a reconnect state. CRM mutations are not rolled back.

Mirrored-update loops are prevented with the Google etag/provider timestamp plus a deterministic CRM schedule hash. A provider change that matches the stored etag or current CRM schedule is acknowledged without writing the task or sending another provider update.

If both sides changed, the more recent task/provider timestamp wins for the schedule (ties favor Google). Titles, notes, assignment and status always remain Neat-owned. An ETag conflict is recorded for the next retry rather than overwriting Google. Checks are bounded; a timeout retains the previous feed cursor for replay. The cron emits aggregate attempt/success/failure/skip counts and returns HTTP 503 for partial or failed connections instead of claiming success.

## Vercel scheduling and limits

`vercel.json` polls once daily at 10:00 UTC (6:00 AM EDT / 5:00 AM EST), which is compatible with the current Vercel Hobby plan. Vercel sends `Authorization: Bearer $CRON_SECRET`, and the route rejects any other request. Vercel cron runs only on Production deployments. If faster Google-to-CRM updates are needed later, upgrade to Pro and shorten this interval.

## Manual QA

1. Apply the database migration and configure/redeploy the environment variables.
2. In Profile > Calendar settings, connect Google and select a writable calendar.
3. On mobile, log a Wholesale visit, choose Create worklist item, enter note/date, optionally enter time, confirm the responsible person defaults to you, choose another active user, and save.
4. Confirm the Worklist item has the selected owner/date/time. If that owner is connected, confirm the Google event exists.
5. Edit the task date/time/title and confirm the existing event updates without duplication.
6. Move the event in Google; use **Check and sync now** (or wait for the daily cron), confirm only the CRM date/time changed, and confirm a second check neither rewrites the task nor duplicates the event.
7. Reassign the task between two connected users and confirm the event leaves the first calendar and appears on the second.
8. Reassign to a user with no connection and confirm the CRM task remains while no new event is created.
9. Complete and cancel test tasks and confirm their events disappear.
10. Delete a linked event in Google, check changes, confirm the task shows removed/unsynced, then use **Restore removed events** to recreate it once.
11. Check paused/reconnect-required/partial-failure feedback; none may display a successful check or advance the last-success timestamp. Try failed reassignment/calendar-switch/disconnect cleanup and confirm the old links remain until retry succeeds.
12. Repeat create/check concurrently and simulate an uncertain create response. Confirm one event ID survives retries. Test an old-owner Google reschedule after reassignment and confirm the current owner's task schedule is unchanged.

## Current limitations

- Google is the only implemented provider.
- Sync is polling-based, so Google-to-CRM changes can currently take up to 24 hours. CRM-to-Google sync is attempted immediately after the CRM write; busy or failed operations retry at the next manual/daily check.
- Calendar edits affect scheduling only; title and description remain one-way from CRM to Google.
- Timed events use a fixed 30-minute duration and the shared `America/New_York` timezone because the CRM has no per-user timezone setting.
- One connected provider account per user is supported. The schema and event links are provider-neutral, so Microsoft Graph or an Apple/CalDAV adapter can be added behind `CalendarProvider` later.
- The global calendar lock favors reliability at the current volume. Large calendars or many users may need a durable per-connection worker/resumable backfill before increasing scale or frequency. Historical orphan/duplicate events cannot be safely identified from missing links and are not automatically repaired.
- TST calendar/cron activation and a real Google round-trip are separate from automated regression success. Keep isolated TST OAuth/resource safeguards intact; do not connect TST to production credentials/calendars accidentally.
