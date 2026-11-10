import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { UserRole } from '@prisma/client';
import { requireProductionForecastContext } from '../lib/productionForecasting/access';
import { unavailableForecastRefreshState, type ForecastRefreshActionResult, type ForecastRefreshState } from '../lib/productionForecasting/refreshState';

function fixture(role: UserRole, organizationId: string | null = 'org_echo_spirits') {
  const user = { id: 'trusted-session-user', role, organizationId };
  const events: Array<{ operation: string; value?: unknown }> = [];
  const state: ForecastRefreshState = { configured: true, unavailableReason: null, job: null, lastSuccessfulAt: null };
  let fail = false;
  const exports: Record<string, (id: string) => Promise<ForecastRefreshActionResult>> = {};
  const dependencies: Record<string, unknown> = {
    'next/navigation': { notFound: () => { throw new Error('404'); } },
    'next/cache': { revalidatePath: (path: string) => events.push({ operation: 'invalidate', value: path }) },
    '../../../lib/auth': { requireUserSession: async () => ({ user }) },
    '../../../lib/userAccess': { isAdminRole: (value: UserRole) => value === UserRole.ADMIN || value === UserRole.PLATFORM_ADMIN },
    '../../../lib/productionForecasting/access': { requireProductionForecastContext: async (actor: typeof user, target: string) => requireProductionForecastContext(actor, target, { tenant: async () => ({ organizationId: 'org_echo_spirits', organization: { id: 'org_echo_spirits', displayName: 'Echo Spirits' } }) }) },
    '../../../lib/productionForecasting/refreshRequests': {
      enqueueForecastRefresh: async (value: unknown) => { events.push({ operation: 'enqueue', value }); if (fail) throw new Error('PRIVATE_PROVIDER_BODY Bearer SECRET'); return { ok: true, state }; },
      getForecastRefreshState: async (id: string) => { events.push({ operation: 'status', value: id }); return state; },
    },
    '../../../lib/productionForecasting/refreshState': { unavailableForecastRefreshState },
  };
  const source = ts.transpileModule(readFileSync('app/analytics/production/refreshActions.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(source, { exports, require: (name: string) => { assert(name in dependencies, name); return dependencies[name]; } });
  return { exports, events, setFailure: () => { fail = true; } };
}

test('refresh request/status actions authorize Admin and platform Admin with an explicit Echo target', async () => {
  for (const role of [UserRole.ADMIN, UserRole.PLATFORM_ADMIN]) {
    const f = fixture(role);
    assert.equal((await f.exports.requestForecastRefresh('org_echo_spirits')).ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(f.events[0])), { operation: 'enqueue', value: { organizationId: 'org_echo_spirits', requestedByUserId: 'trusted-session-user' } });
    assert.equal((await f.exports.getForecastRefreshStatus('org_echo_spirits')).ok, true);
    assert.equal(f.events.at(-1)?.operation, 'status');
  }
});

test('Sales and Tasters cannot enqueue or poll private refresh history', async () => {
  for (const role of [UserRole.USER, UserRole.TASTER]) for (const action of ['requestForecastRefresh', 'getForecastRefreshStatus']) {
    const f = fixture(role); await assert.rejects(() => f.exports[action]('org_echo_spirits'), /404/); assert.equal(f.events.length, 0);
  }
});

test('empty, foreign and cross-tenant targets fail before any request or status side effect', async () => {
  for (const action of ['requestForecastRefresh', 'getForecastRefreshStatus']) {
    for (const target of ['', ' ', 'outside']) {
      const f = fixture(UserRole.PLATFORM_ADMIN); await assert.rejects(() => f.exports[action](target), /404/); assert.equal(f.events.length, 0);
    }
    const f = fixture(UserRole.ADMIN, 'outside'); await assert.rejects(() => f.exports[action]('org_echo_spirits'), /404/); assert.equal(f.events.length, 0);
  }
});

test('request failures show safe recovery copy without exposing a provider response', async () => {
  const f = fixture(UserRole.ADMIN); f.setFailure();
  const result = await f.exports.requestForecastRefresh('org_echo_spirits');
  assert.equal(result.ok, false); assert.match(result.error!, /Check progress/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|Bearer|SECRET/);
});
