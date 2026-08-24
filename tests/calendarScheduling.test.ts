import assert from 'node:assert/strict';
import test from 'node:test';
import { WorklistCategory, WorklistSource, WorklistStatus } from '@prisma/client';
import { decryptCalendarToken, encryptCalendarToken } from '../lib/calendar/crypto';
import { buildGoogleCalendarChangesQuery } from '../lib/calendar/google';
import {
  buildWorklistCalendarInput,
  getWorklistScheduleFromExternalEvent,
  getWorklistScheduleHash,
} from '../lib/calendar/worklistSync';
import { formatDateOnlyInputValue, formatTimeMinutesInput, parseTimeInputToMinutes } from '../lib/dateTime';

const item = (overrides: Record<string, unknown> = {}) => ({
  id: 'task-1',
  title: 'Call buyer',
  detail: 'Confirm the tasting date',
  status: WorklistStatus.OPEN,
  source: WorklistSource.MANUAL,
  category: WorklistCategory.WHOLESALE,
  agencyId: null,
  wholesaleAccountId: null,
  loggedVisitId: null,
  dueDate: new Date('2026-08-21T00:00:00.000Z'),
  dueTimeMinutes: null,
  assignedTo: 'Joe',
  createdBy: 'Joe',
  createdByUserId: 'user-1',
  assignedToUserId: 'user-1',
  completedByUserId: null,
  cancelledByUserId: null,
  completedAt: null,
  cancelledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  assignedToUser: null,
  calendarEvents: [],
  ...overrides,
});

test('date-only worklist items create provider-neutral all-day events', () => {
  const event = buildWorklistCalendarInput({ item: item() as never, accountName: 'Example Account' });
  assert.deepEqual(event.schedule, { kind: 'all-day', date: '2026-08-21' });
  assert.equal(event.privateMetadata.worklistItemId, 'task-1');
  assert.match(event.description ?? '', /Example Account/);
});

test('timed worklist items create 30-minute Eastern events', () => {
  const event = buildWorklistCalendarInput({ item: item({ dueTimeMinutes: 14 * 60 + 30 }) as never });
  assert.equal(event.schedule.kind, 'timed');
  if (event.schedule.kind !== 'timed') return;
  assert.equal(event.schedule.timeZone, 'America/New_York');
  assert.equal(event.schedule.startsAt.toISOString(), '2026-08-21T18:30:00.000Z');
  assert.equal(event.schedule.endsAt.getTime() - event.schedule.startsAt.getTime(), 30 * 60 * 1000);
});

test('Google all-day changes map back to date-only CRM schedules', () => {
  const schedule = getWorklistScheduleFromExternalEvent({
    id: 'event-1', status: 'confirmed', title: null, description: null,
    startDate: '2026-08-24', startDateTime: null, updatedAt: null, etag: null, privateMetadata: {},
  });
  assert.equal(formatDateOnlyInputValue(schedule?.dueDate), '2026-08-24');
  assert.equal(schedule?.dueTimeMinutes, null);
});

test('Google timed changes map back to Eastern date and time', () => {
  const schedule = getWorklistScheduleFromExternalEvent({
    id: 'event-1', status: 'confirmed', title: null, description: null,
    startDate: null, startDateTime: '2026-08-24T19:45:00.000Z', updatedAt: null, etag: null, privateMetadata: {},
  });
  assert.equal(formatDateOnlyInputValue(schedule?.dueDate), '2026-08-24');
  assert.equal(schedule?.dueTimeMinutes, 15 * 60 + 45);
});

test('schedule hashes are stable and change for material scheduling updates', () => {
  const first = getWorklistScheduleHash(item() as never);
  assert.equal(first, getWorklistScheduleHash(item() as never));
  assert.notEqual(first, getWorklistScheduleHash(item({ dueTimeMinutes: 60 }) as never));
  assert.notEqual(first, getWorklistScheduleHash(item({ assignedToUserId: 'user-2' }) as never));
});

test('optional time inputs round-trip as minutes after midnight', () => {
  assert.equal(parseTimeInputToMinutes('14:30'), 870);
  assert.equal(formatTimeMinutesInput(870), '14:30');
  assert.equal(parseTimeInputToMinutes(''), null);
  assert.equal(parseTimeInputToMinutes('25:00'), null);
});

test('calendar tokens are encrypted and authenticated', () => {
  const previous = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
  process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = 'test-only-calendar-key-that-is-long-enough';
  try {
    const encrypted = encryptCalendarToken('refresh-secret');
    assert.notEqual(encrypted, 'refresh-secret');
    assert.equal(decryptCalendarToken(encrypted), 'refresh-secret');
    const parts = encrypted.split('.');
    parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
    assert.throws(() => decryptCalendarToken(parts.join('.')));
  } finally {
    process.env.CALENDAR_TOKEN_ENCRYPTION_KEY = previous;
  }
});

test('Google incremental sync does not combine sync tokens with restricted event filters', () => {
  const query = buildGoogleCalendarChangesQuery('next-sync-token', 'next-page-token');
  assert.equal(query.get('syncToken'), 'next-sync-token');
  assert.equal(query.get('pageToken'), 'next-page-token');
  assert.equal(query.get('showDeleted'), 'true');
  assert.equal(query.get('singleEvents'), 'true');
  assert.equal(query.has('privateExtendedProperty'), false);
  assert.equal(buildGoogleCalendarChangesQuery(null, null).has('privateExtendedProperty'), false);
});

test('calendar sync cron rejects unauthenticated requests', async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'calendar-cron-test-secret';
  try {
    const { GET } = await import('../app/api/cron/calendar-sync/route');
    const response = await GET(new Request('http://localhost/api/cron/calendar-sync'));
    assert.equal(response.status, 401);
  } finally {
    process.env.CRON_SECRET = previous;
  }
});
