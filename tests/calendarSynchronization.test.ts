import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { CalendarProviderError } from '../lib/calendar/types';

// Execute the real sync, settings and lock code with a stateful database/provider.
// No external credentials, database connections or Google writes are used.
function fixture() {
  const connection: any = { id: 'conn', userId: 'user', provider: 'GOOGLE', providerAccountId: 'account', selectedCalendarId: 'cal', syncEnabled: true, requiresReconnect: false, syncToken: 'cursor', lastSyncAt: new Date('2026-09-22T10:00Z') };
  const item: any = { id: 'task', title: 'Call buyer', detail: 'Keep these notes', source: 'MANUAL', status: 'OPEN', dueDate: new Date('2026-09-23'), dueTimeMinutes: null, assignedToUserId: 'user', updatedAt: new Date('2026-09-23T08:00Z'), agencyId: null, wholesaleAccountId: null };
  const link: any = { id: 'link', provider: 'GOOGLE', worklistItemId: 'task', connectionId: 'conn', externalEventId: 'event', calendarId: 'cal', eventEtag: 'old', eventUpdatedAt: new Date('2026-09-23T07:00Z'), syncStatus: 'SYNCED' };
  const remote: any = { id: 'event', status: 'confirmed', title: 'Google title', description: 'Google notes', startDate: '2026-09-25', startDateTime: null, updatedAt: new Date('2026-09-23T09:00Z'), etag: 'new', privateMetadata: { echoCrmManaged: 'true', worklistItemId: 'task' } };
  const events = new Map<string, any>([['event', remote]]);
  const calls: string[] = [];
  let linked = true;
  let held = false;
  const matches = (row: any, where: any): boolean => Object.entries(where ?? {}).every(([key, value]: any) => {
    if (key === 'worklistItemId_provider' || key === 'userId_provider') return matches(row, value);
    if (key === 'OR' || key === 'calendarEvents') return true;
    if (value instanceof Date) return row[key]?.getTime() === value.getTime();
    if (value && typeof value === 'object') {
      if ('not' in value) return row[key] !== value.not;
      if ('in' in value) return value.in.includes(row[key]);
      return true;
    }
    return row[key] === value;
  });
  const assign = (row: any, data: any) => { for (const [key, value] of Object.entries(data)) if (value !== undefined) row[key] = value; return { ...row }; };
  const enrichedLink = () => ({ ...link, connection: link.connectionId === connection.id ? { ...connection } : null });
  const prisma: any = {
    calendarConnection: {
      findUnique: async ({ where }: any) => matches(connection, where) ? { ...connection } : null,
      findMany: async () => [{ ...connection }],
      update: async ({ data }: any) => assign(connection, data),
      updateMany: async ({ where, data }: any) => { if (!matches(connection, where)) return { count: 0 }; assign(connection, data); return { count: 1 }; },
      delete: async () => { calls.push('disconnect'); },
    },
    worklistItem: {
      findUnique: async () => ({ ...item, calendarEvents: linked ? [enrichedLink()] : [], assignedToUser: null }),
      findMany: async () => [{ id: item.id }],
      updateMany: async ({ where, data }: any) => { if (!matches(item, where)) return { count: 0 }; assign(item, data); item.updatedAt = new Date(); calls.push('write-task'); return { count: 1 }; },
    },
    worklistCalendarEvent: {
      findFirst: async ({ where }: any) => linked && matches(link, where) ? { ...link } : null,
      findUnique: async () => linked ? { ...link } : null,
      findMany: async ({ where }: any) => linked && matches(link, where) ? [enrichedLink()] : [],
      count: async () => linked && link.externalEventId ? 1 : 0,
      update: async ({ data }: any) => { assign(link, data); return enrichedLink(); },
      updateMany: async ({ where, data }: any) => { if (!matches(link, where)) return { count: 0 }; assign(link, data); return { count: 1 }; },
      upsert: async ({ create, update }: any) => { assign(link, linked ? update : { eventEtag: null, eventUpdatedAt: null, crmScheduleHash: null, ...create }); linked = true; return enrichedLink(); },
    },
  };
  prisma.$transaction = async (fn: any) => {
    let ownsLock = false;
    const tx = { ...prisma, $queryRaw: async () => {
      if (held) return [{ acquired: false }];
      held = true; ownsLock = true; return [{ acquired: true }];
    } };
    try { return await fn(tx); } finally { if (ownsLock) held = false; }
  };
  const provider: any = {
    listChanges: async () => { calls.push('pull'); return { events: [...events.values()].map(e => ({ ...e })), nextPageToken: null, nextSyncToken: 'new-cursor' }; },
    getEvent: async (_conn: any, id: string) => events.has(id) ? { ...events.get(id) } : null,
    createEvent: async (_conn: any, input: any, id: string) => {
      calls.push('create:' + id);
      events.set(id, { ...remote, id, etag: 'created', updatedAt: new Date(), startDate: input.schedule.date, privateMetadata: input.privateMetadata });
      return { externalEventId: id, etag: 'created', updatedAt: new Date() };
    },
    updateEvent: async (_conn: any, id: string, input: any, etag: string) => {
      calls.push('patch');
      if (events.get(id)?.etag !== etag) throw new CalendarProviderError('Precondition failed', 'google_412');
      events.set(id, { ...events.get(id), startDate: input.schedule.date, etag: 'patched' });
      return { externalEventId: id, etag: 'patched', updatedAt: new Date() };
    },
    deleteEvent: async (conn: any, id: string) => { calls.push('delete:' + conn.selectedCalendarId); events.delete(id); },
    listCalendars: async () => [{ id: 'cal', name: 'Calendar' }, { id: 'new-cal', name: 'New Calendar' }],
  };
  const cache = new Map<string, any>();
  function load(path: string): any {
    if (cache.has(path)) return cache.get(path);
    const filename = resolve(process.cwd(), path);
    const require = createRequire(filename);
    const source = readFileSync(filename, 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const exports = {}; cache.set(path, exports);
    const mocks: any = { '../prisma': { prisma }, './index': { getCalendarProvider: () => provider }, '../appEnvironment': { isSideEffectEnabled: () => true, logEnvironmentEvent() {} }, './types': { CalendarProviderError } };
    runInNewContext(code, { exports, process, Date, console: { error() {} }, require: (name: string) => {
      if (name in mocks) return mocks[name];
      if (name === './syncLock' || name === './scheduling') return load('lib/calendar/' + name.slice(2) + '.ts');
      return require(name);
    } }, { filename });
    return exports;
  }
  const api = load('lib/calendar/worklistSync.ts');
  link.crmScheduleHash = api.getWorklistScheduleHash(item);
  return { api, connection, item, link, remote, events, calls, provider, prisma, removeLink: () => { linked = false; } };
}

test('incoming Google reschedule updates only schedule and records a successful cursor', async () => {
  const f = fixture(); const counts = await f.api.syncGoogleCalendarConnection('conn');
  assert.equal(counts.updated, 1); assert.equal(counts.failed, 0);
  assert.equal(f.item.dueDate.toISOString().slice(0, 10), '2026-09-25');
  assert.equal(f.item.title, 'Call buyer'); assert.equal(f.item.detail, 'Keep these notes');
  assert.equal(f.connection.syncToken, 'new-cursor'); assert.ok(!f.calls.includes('patch'));
});

test('bounded check retains the cursor and last success when its budget is exhausted', async () => {
  const f = fixture(); const lastSuccess = f.connection.lastSyncAt;
  await assert.rejects(f.api.syncGoogleCalendarConnection('conn', { budgetMs: -1 }), /time budget/);
  assert.equal(f.connection.syncToken, 'cursor'); assert.equal(f.connection.lastSyncAt, lastSuccess);
  assert.ok(!f.calls.includes('pull')); assert.ok(!f.calls.includes('patch'));
});

test('revoked cleanup preserves identity and marks the paused connection for reconnect', async () => {
  const f = fixture(); f.provider.deleteEvent = async () => { throw new CalendarProviderError('Revoked', 'google_401', true); };
  assert.equal((await f.api.changeGoogleCalendarSettings('user', '', false, true)).status, 'cleanup-failed');
  assert.equal(f.link.externalEventId, 'event'); assert.equal(f.connection.requiresReconnect, true); assert.equal(f.connection.syncEnabled, false);
});
test('personal event has no task link and is never imported', async () => {
  const f = fixture(); f.remote.id = 'personal'; f.events.clear(); f.events.set('personal', f.remote);
  await f.api.syncGoogleCalendarConnection('conn');
  assert.ok(!f.calls.includes('write-task'));
});
test('former owner cannot change a reassigned task schedule', async () => {
  const f = fixture(); f.item.assignedToUserId = 'new-owner';
  await f.api.syncGoogleCalendarConnection('conn');
  assert.equal(f.item.dueDate.toISOString().slice(0, 10), '2026-09-23');
});
test('completed task ignores incoming changes and removes the old event', async () => {
  const f = fixture(); f.item.status = 'COMPLETED';
  await f.api.syncGoogleCalendarConnection('conn');
  assert.ok(!f.calls.includes('write-task')); assert.equal(f.link.externalEventId, null);
});
test('reconnect-disabled outgoing call preserves external identity', async () => {
  const f = fixture(); f.connection.requiresReconnect = true; f.connection.syncEnabled = false;
  assert.equal((await f.api.syncWorklistItemCalendar('task')).status, 'not-connected');
  assert.equal(f.link.externalEventId, 'event'); assert.equal(f.link.connectionId, 'conn');
});
test('failed reassignment cleanup retains original link and creates no replacement', async () => {
  const f = fixture(); f.item.assignedToUserId = 'new-owner';
  f.provider.deleteEvent = async () => { throw new Error('Google unavailable'); };
  assert.equal((await f.api.syncWorklistItemCalendar('task')).status, 'error');
  assert.equal(f.link.externalEventId, 'event'); assert.equal(f.link.connectionId, 'conn'); assert.equal(f.link.syncStatus, 'ERROR');
  assert.ok(!f.calls.some(c => c.startsWith('create')));
});
test('failed calendar switch pauses sync and retains calendar identity and credentials', async () => {
  const f = fixture(); f.provider.deleteEvent = async () => { throw new Error('unavailable'); };
  assert.equal((await f.api.changeGoogleCalendarSettings('user', 'new-cal', true)).status, 'cleanup-failed');
  assert.equal(f.connection.selectedCalendarId, 'cal'); assert.equal(f.connection.syncEnabled, false); assert.equal(f.link.externalEventId, 'event');
});
test('failed disconnect keeps connection available for cleanup retry', async () => {
  const f = fixture(); f.provider.deleteEvent = async () => { throw new Error('unavailable'); };
  assert.equal((await f.api.changeGoogleCalendarSettings('user', '', false, true)).status, 'cleanup-failed');
  assert.ok(!f.calls.includes('disconnect')); assert.equal(f.link.externalEventId, 'event');
});
test('successful calendar switch deletes from the linked calendar and resets cursor', async () => {
  const f = fixture(); f.link.calendarId = 'original-cal';
  assert.equal((await f.api.changeGoogleCalendarSettings('user', 'new-cal', true)).status, 'updated');
  assert.ok(f.calls.includes('delete:original-cal')); assert.equal(f.connection.selectedCalendarId, 'new-cal'); assert.equal(f.connection.syncToken, null);
});
test('overlapping creates use the database lock; one remote event is created', async () => {
  const f = fixture(); f.removeLink(); f.events.clear();
  const results = await Promise.all([f.api.syncWorklistItemCalendar('task'), f.api.syncWorklistItemCalendar('task')]);
  assert.equal(f.calls.filter(c => c.startsWith('create:')).length, 1);
  assert.ok(results.some(r => r.status === 'busy'));
});
test('uncertain create response recovers the reserved event without another POST', async () => {
  const f = fixture(); f.removeLink(); f.events.clear();
  const create = f.provider.createEvent;
  f.provider.createEvent = async (...args: any[]) => { await create(...args); throw new Error('response timed out'); };
  assert.equal((await f.api.syncWorklistItemCalendar('task')).status, 'error');
  const reservedId = f.link.externalEventId;
  await f.api.syncWorklistItemCalendar('task');
  assert.equal(f.link.externalEventId, reservedId); assert.equal(f.calls.filter(c => c.startsWith('create:')).length, 1);
});
test('Google deletion remains removed until explicit restoration', async () => {
  const f = fixture(); f.remote.status = 'cancelled';
  await f.api.syncGoogleCalendarConnection('conn');
  assert.equal(f.link.syncStatus, 'REMOVED'); assert.equal(f.link.externalEventId, null);
  assert.ok(!f.calls.some(c => c.startsWith('create:')));
  await f.api.syncGoogleCalendarConnection('conn', { restoreRemoved: true });
  assert.equal(f.link.syncStatus, 'SYNCED'); assert.notEqual(f.link.externalEventId, 'event');
});
test('legacy removed links with a deleted ID can be explicitly restored', async () => {
  const f = fixture(); f.link.syncStatus = 'REMOVED'; f.events.clear();
  await f.api.syncWorklistItemCalendar('task', { force: true });
  assert.equal(f.link.syncStatus, 'SYNCED'); assert.notEqual(f.link.externalEventId, 'event');
});
test('incoming changes are read before retrying pending outgoing edits', async () => {
  const f = fixture(); f.link.syncStatus = 'PENDING';
  await f.api.syncAllGoogleCalendarConnections();
  assert.equal(f.calls[0], 'pull'); assert.equal(f.item.dueDate.toISOString().slice(0, 10), '2026-09-25');
});
test('newer CRM scheduling edit wins and uses latest provider ETag', async () => {
  const f = fixture(); f.item.dueDate = new Date('2026-09-26'); f.item.updatedAt = new Date('2026-09-23T10:00Z');
  await f.api.syncGoogleCalendarConnection('conn');
  assert.equal(f.item.dueDate.toISOString().slice(0, 10), '2026-09-26'); assert.equal(f.events.get('event').startDate, '2026-09-26'); assert.ok(f.calls.includes('patch'));
});
test('outgoing failure is a partial cron failure and retains last successful check', async () => {
  const f = fixture(); const lastSuccess = f.connection.lastSyncAt;
  f.item.title = 'New title'; f.item.updatedAt = new Date('2026-09-23T10:00Z');
  f.provider.updateEvent = async () => { throw new Error('unavailable'); };
  const result = await f.api.syncAllGoogleCalendarConnections();
  assert.equal(result.failed, 1); assert.equal(result.succeeded, 0); assert.equal(f.link.syncStatus, 'ERROR'); assert.equal(f.connection.lastSyncAt, lastSuccess); assert.match(f.connection.syncError, /could not finish/);
});
test('expired cursor restarts full sync and only advances after the last page', async () => {
  const f = fixture(); const seen: any[] = [];
  f.provider.listChanges = async (_conn: any, cursor: any, page: any) => {
    seen.push([cursor, page]);
    if (cursor) throw new CalendarProviderError('expired', 'sync_token_expired');
    if (!page) return { events: [f.remote], nextPageToken: 'page2', nextSyncToken: null };
    return { events: [], nextPageToken: null, nextSyncToken: 'full-cursor' };
  };
  await f.api.syncGoogleCalendarConnection('conn');
  assert.deepEqual(seen, [['cursor', null], [null, null], [null, 'page2']]); assert.equal(f.connection.syncToken, 'full-cursor');
});
test('failed second page retains cursor and last successful timestamp', async () => {
  const f = fixture(); const lastSuccess = f.connection.lastSyncAt;
  f.provider.listChanges = async (_conn: any, _cursor: any, page: any) => { if (page) throw new Error('second page failed'); return { events: [f.remote], nextPageToken: 'page2', nextSyncToken: null }; };
  await assert.rejects(f.api.syncGoogleCalendarConnection('conn'), /second page failed/);
  assert.equal(f.connection.syncToken, 'cursor'); assert.equal(f.connection.lastSyncAt, lastSuccess);
});
test('paused and reconnect checks return meaningful skipped reasons', async () => {
  const f = fixture(); f.connection.syncEnabled = false;
  assert.equal((await f.api.syncGoogleCalendarConnection('conn')).reason, 'paused');
  f.connection.requiresReconnect = true; assert.equal((await f.api.syncGoogleCalendarConnection('conn')).reason, 'reconnect'); assert.equal(f.calls.length, 0);
});
test('invalid provider dates fail before changing the task or cursor', async () => {
  const f = fixture(); f.remote.startDate = '2026-02-30';
  await assert.rejects(f.api.syncGoogleCalendarConnection('conn'), /invalid event date/);
  assert.equal(f.connection.syncToken, 'cursor'); assert.ok(!f.calls.includes('write-task'));
});
