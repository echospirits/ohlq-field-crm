import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { CalendarProviderError } from '../lib/calendar/types';

function provider(responses: Response[]) {
  const path = resolve('lib/calendar/google.ts');
  const require = createRequire(path);
  const exports: any = {};
  const requests: any[] = [];
  const source = readFileSync(path, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, process, Date, URLSearchParams, AbortSignal,
    fetch: async (url: string, init: RequestInit) => { requests.push({ url, ...init }); const response = responses.shift(); assert.ok(response, 'Unexpected request'); return response; },
    require: (name: string) => name === '../prisma' ? { prisma: {} } : name === './crypto' ? { decryptCalendarToken: () => 'mock' } : name === './types' ? { CalendarProviderError } : require(name),
  });
  return { api: exports.googleCalendarProvider, requests };
}
const connection = { id: 'conn', selectedCalendarId: 'cal', accessTokenEncrypted: 'mock', tokenExpiresAt: null };
const json = (data: any, status = 200) => new Response(JSON.stringify(data), { status });
const input: any = { title: 'Task', schedule: { kind: 'all-day', date: '2026-10-08' }, privateMetadata: { echoCrmManaged: 'true', worklistItemId: 'task' } };

test('Google missing calendar feed is an error, not an empty successful check', async () => {
  const f = provider([json({ error: { message: 'Not Found' } }, 404)]);
  await assert.rejects(f.api.listChanges(connection, 'cursor', null), (e: CalendarProviderError) => e.code === 'google_404');
});
test('Google 410 feed requests a full sync while 404 event lookup returns missing', async () => {
  const f = provider([json({}, 410), json({}, 404)]);
  await assert.rejects(f.api.listChanges(connection, 'cursor', null), (e: CalendarProviderError) => e.code === 'sync_token_expired');
  assert.equal(await f.api.getEvent(connection, 'event'), null);
});
test('Google create uses reserved ID and recovers a matching 409 event', async () => {
  const f = provider([json({}, 409), json({ id: 'reserved', etag: 'v1', extendedProperties: { private: input.privateMetadata } })]);
  const result = await f.api.createEvent(connection, input, 'reserved');
  assert.equal(JSON.parse(f.requests[0].body).id, 'reserved'); assert.equal(result.externalEventId, 'reserved'); assert.equal(result.etag, 'v1');
});
test('Google 409 cannot attach a personal or unrelated event', async () => {
  const f = provider([json({}, 409), json({ id: 'reserved', extendedProperties: { private: { worklistItemId: 'other' } } })]);
  await assert.rejects(f.api.createEvent(connection, input, 'reserved'), (e: CalendarProviderError) => e.code === 'event_identity_conflict');
});
test('Google 409 cancelled event is treated as removed and cannot be reused', async () => {
  const f = provider([json({}, 409), json({ id: 'reserved', status: 'cancelled' })]);
  await assert.rejects(f.api.createEvent(connection, input, 'reserved'), (e: CalendarProviderError) => e.code === 'event_removed');
});
test('Google rejects feed without a complete or next-page cursor', async () => {
  const f = provider([json({ items: [] })]);
  await assert.rejects(f.api.listChanges(connection, null, null), (e: CalendarProviderError) => e.code === 'missing_sync_cursor');
});
test('Google 412 stays a failed conditional update rather than overwriting', async () => {
  const f = provider([json({ error: { message: 'Precondition failed' } }, 412)]);
  await assert.rejects(f.api.updateEvent(connection, 'event', input, 'known'), (e: CalendarProviderError) => e.code === 'google_412');
  assert.equal(f.requests[0].headers['If-Match'], 'known');
});

function settingsAction(result: any) {
  const source = readFileSync(resolve('app/settings/calendar/page.tsx'), 'utf8');
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const funcs = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ['refreshWorklistViews', 'checkStatus', 'checkCalendarChanges'].includes(node.name?.text ?? ''));
  const code = ts.transpileModule(funcs.map(node => node.getText(ast)).join('\n') + '\nresult = checkCalendarChanges;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const refreshed: string[] = [];
  const context: any = { result: null, assertSideEffectEnabled() {}, requireUser: async () => ({ id: 'user' }), prisma: { calendarConnection: { findUnique: async () => ({ id: 'conn' }) } }, GOOGLE_PROVIDER: 'GOOGLE',
    syncGoogleCalendarConnection: async () => { if (result instanceof Error) throw result; return result; }, revalidatePath: (path: string) => refreshed.push(path), redirect: (path: string) => { throw new Error(path); }, encodeURIComponent, console: { error() {} } };
  runInNewContext(code, context);
  return { run: context.result, refreshed };
}
for (const [result, status] of [[{ skipped: 1, reason: 'paused' }, 'paused'], [{ skipped: 1, reason: 'reconnect' }, 'reconnect'], [{ skipped: 1, reason: 'busy' }, 'busy'], [{ skipped: 0, failed: 1 }, 'partial'], [{ skipped: 0, failed: 0 }, 'checked'], [new Error('Google unavailable'), 'check-failed']] as const) {
  test('manual action reports ' + status + ' accurately and refreshes Worklist views', async () => {
    const f = settingsAction(result);
    await assert.rejects(f.run(new FormData()), new RegExp('status=' + status));
    assert.ok(f.refreshed.includes('/my-day')); assert.ok(f.refreshed.includes('/alerts'));
  });
}

function route(path: string, mocks: Record<string, any>, env: Record<string, string> = {}) {
  const filename = resolve(path);
  const require = createRequire(filename);
  const exports: any = {};
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, URL, Date, process: { env }, console: { error() {} },
    require: (name: string) => name in mocks ? mocks[name] : require(name),
  });
  return exports;
}
function oauth(account = 'account', calendars = [{ id: 'cal', name: 'Calendar' }], syncResult: any = { skipped: 0, failed: 0 }) {
  const current: any = { id: 'conn', userId: 'user', providerAccountId: 'account', selectedCalendarId: 'cal', selectedCalendarName: 'Calendar', refreshTokenEncrypted: 'original-refresh', scope: 'old-scope' };
  let synced = false;
  let saved: any;
  const api = route('app/api/calendar/google/callback/route.ts', {
    '../../../../../lib/auth': { requireUser: async () => ({ id: 'user' }) },
    '../../../../../lib/calendar/crypto': { encryptCalendarToken: (value: string) => 'encrypted-' + value },
    '../../../../../lib/calendar/google': { GOOGLE_PROVIDER: 'GOOGLE', exchangeGoogleOAuthCode: async () => ({ access_token: 'new-token' }), getGoogleIdentity: async () => ({ sub: account }), googleCalendarProvider: { listCalendars: async () => calendars } },
    '../../../../../lib/calendar/worklistSync': { syncOutstandingWorklistItemsForUser: async () => { synced = true; return syncResult; } },
    '../../../../../lib/calendar/syncLock': { CalendarSyncBusyError: class extends Error {}, withCalendarSyncLock: async (fn: any) => fn() },
    '../../../../../lib/appEnvironment': { isSideEffectEnabled: () => true },
    '../../../../../lib/prisma': { prisma: { calendarOAuthState: { findUnique: async () => ({ id: 'state', userId: 'user', provider: 'GOOGLE', expiresAt: new Date(Date.now() + 60000) }), delete: async () => {} }, calendarConnection: { findUnique: async () => current, upsert: async (args: any) => { saved = args.update; } }, worklistCalendarEvent: { count: async () => 1 } } },
  });
  return { run: () => api.GET(new Request('https://neat-tst.example/api/calendar/google/callback?code=mock&state=mock')), saved: () => saved, synced: () => synced };
}
test('OAuth different-account reconnect never replaces tokens or linked calendar', async () => {
  const f = oauth('different'); const response = await f.run();
  assert.match(response.headers.get('location'), /account-change-blocked/); assert.equal(f.saved(), undefined); assert.equal(f.synced(), false);
});
test('OAuth unavailable linked calendar refreshes same-account tokens without moving links', async () => {
  const f = oauth('account', [{ id: 'fallback', name: 'Fallback' }]); const response = await f.run();
  assert.match(response.headers.get('location'), /calendar-unavailable/);
  assert.equal(f.saved().accessTokenEncrypted, 'encrypted-new-token'); assert.equal(f.saved().refreshTokenEncrypted, 'original-refresh');
  assert.equal(f.saved().selectedCalendarId, 'cal'); assert.equal(f.saved().syncEnabled, false); assert.equal(f.synced(), false);
});
test('OAuth reconnect checks only after saving credentials and reports initial partial failure', async () => {
  const f = oauth('account', [{ id: 'cal', name: 'Calendar' }], { failed: 1, skipped: 0 }); const response = await f.run();
  assert.match(response.headers.get('location'), /partial/); assert.equal(f.saved().selectedCalendarId, 'cal'); assert.equal(f.synced(), true);
});
for (const [failed, status] of [[0, 200], [1, 503]]) {
  test('cron reports failed=' + failed + ' with HTTP ' + status, async () => {
    const api = route('app/api/cron/calendar-sync/route.ts', {
      '../../../../lib/calendar/worklistSync': { syncAllGoogleCalendarConnections: async () => ({ attempted: 1, failed }) },
      '../../../../lib/appEnvironment': { isSideEffectEnabled: () => true, logEnvironmentEvent() {} },
    }, { CRON_SECRET: 'mock' });
    assert.equal((await api.GET(new Request('https://neat-tst.example/api/cron/calendar-sync', { headers: { authorization: 'Bearer mock' } }))).status, status);
    assert.equal((await api.GET(new Request('https://neat-tst.example/api/cron/calendar-sync'))).status, 401);
  });
}
