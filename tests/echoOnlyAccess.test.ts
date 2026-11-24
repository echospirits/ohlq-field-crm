import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { UserRole } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { ECHO_ORGANIZATION_ID, hasEchoAccess } from '../lib/echoAccess';
import { hashPassword, verifyPassword } from '../lib/password';

const redirect = (path: string): never => { throw new Error(`redirect:${path}`); };
function loadModule(path: string, mocks: Record<string, unknown>) {
  const filename = resolve(path), require = createRequire(filename), exports: any = {};
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(compiled, { exports, Date, URL, Buffer, console, process,
    require: (name: string) => name in mocks ? mocks[name] : require(name),
  });
  return exports;
}

const password = 'local-fixture-password';
const storedHash = hashPassword(password);
function actor(organizationId: string | null = ECHO_ORGANIZATION_ID, role: UserRole = UserRole.ADMIN) {
  return { id: 'test-user', email: 'joe@echospirits.com', organizationId, role, isActive: true, passwordHash: storedHash };
}

// Real authentication code, with durable identity/session state held in memory.
function authentication(user = actor()) {
  const sessions: any[] = [], activities: any[] = [];
  let cookie = '';
  const db: any = {
    user: { findUniqueOrThrow: async () => ({ ...user }) },
    userSession: {
      create: async ({ data }: any) => { sessions.push(data); },
      findFirst: async ({ where }: any) => {
        const row = sessions.find(s => s.tokenHash === where.tokenHash && s.expiresAt > where.expiresAt.gt);
        return row && user.isActive === where.user.isActive && user.organizationId === where.user.organizationId
          ? { ...row, user: { ...user } } : null;
      },
    },
    $transaction: async (callback: (tx: any) => Promise<unknown>) => callback(db),
  };
  const auth = loadModule('lib/auth.ts', {
    './prisma': { prisma: db }, './userActivity': { recordUserActivity: async (...args: any[]) => { activities.push(args); } },
    'next/headers': { cookies: async () => ({ get: () => cookie ? { value: cookie } : undefined }) },
    'next/navigation': { redirect },
  });
  return { auth, user, db, sessions, activities, cookie: (value: string) => { cookie = value; } };
}

test('Echo membership is required regardless of role or an Echo email address', () => {
  for (const role of Object.values(UserRole)) {
    assert.equal(hasEchoAccess(actor(ECHO_ORGANIZATION_ID, role)), true);
    assert.equal(hasEchoAccess(actor('outside-company', role)), false);
    assert.equal(hasEchoAccess(actor(null, role)), false);
  }
  assert.equal(hasEchoAccess(null), false);
});

test('Echo sessions work for every existing role and stop working when membership or activation changes', async () => {
  for (const role of Object.values(UserRole)) {
    const f = authentication(actor(ECHO_ORGANIZATION_ID, role));
    const session = await f.auth.createUserSession(f.user.id);
    f.cookie(session.sessionToken);
    assert.equal((await f.auth.getCurrentSession()).user.id, f.user.id);
    assert.equal(f.activities.length, 1);
    f.user.organizationId = 'outside-company';
    assert.equal(await f.auth.getCurrentSession(), null);
    f.user.organizationId = ECHO_ORGANIZATION_ID;
    f.user.isActive = false;
    assert.equal(await f.auth.getCurrentSession(), null);
    assert.equal(f.sessions.length, 1, 'rejection preserves stored records');
  }
});

test('old outside sessions and direct session creation cannot bypass membership, even for platform administrators', async () => {
  for (const role of Object.values(UserRole)) {
    const f = authentication(actor('outside-company', role));
    f.cookie('old-cookie');
    f.sessions.push({ tokenHash: f.auth.hashSessionToken('old-cookie'), expiresAt: new Date(Date.now() + 60_000) });
    assert.equal(await f.auth.getCurrentSession(), null);
    await assert.rejects(f.auth.createUserSession(f.user.id), /cannot access/);
    assert.equal(f.sessions.length, 1);
    assert.equal(f.activities.length, 0);
  }
  const inactive = authentication();
  inactive.user.isActive = false;
  await assert.rejects(inactive.auth.createUserSession(inactive.user.id), /cannot access/);
});

test('Echo maintenance requires both admin authority and current Echo membership', async () => {
  for (const role of Object.values(UserRole)) {
    const f = authentication(actor(ECHO_ORGANIZATION_ID, role));
    f.cookie((await f.auth.createUserSession(f.user.id)).sessionToken);
    if (role === UserRole.ADMIN || role === UserRole.PLATFORM_ADMIN) assert.equal((await f.auth.requireEchoAdmin()).id, f.user.id);
    else await assert.rejects(f.auth.requireEchoAdmin(), /redirect:/);
    f.user.organizationId = 'outside-company';
    await assert.rejects(f.auth.requireEchoAdmin(), /redirect:/);
  }
});

test('the real login route accepts Echo credentials and rejects outside credentials with the same generic failure', async () => {
  for (const [organizationId, active, enteredPassword, accepted] of [
    [ECHO_ORGANIZATION_ID, true, password, true],
    ['outside-company', true, password, false],
    [null, true, password, false],
    [ECHO_ORGANIZATION_ID, false, password, false],
    [ECHO_ORGANIZATION_ID, true, 'wrong-password', false],
  ] as const) {
    const f = authentication(actor(organizationId));
    f.user.isActive = active;
    const db = { user: { findUnique: async () => f.user }, loginThrottle: {
      findUnique: async () => null, upsert: async () => {}, deleteMany: async () => {},
    } };
    const route = loadModule('app/api/auth/login/route.ts', {
      '../../../../lib/prisma': { prisma: db }, '../../../../lib/auth': f.auth,
    });
    const body = new FormData();
    body.set('email', f.user.email); body.set('password', enteredPassword);
    body.set('organizationId', ECHO_ORGANIZATION_ID); body.set('role', 'PLATFORM_ADMIN');
    const response = await route.POST(new NextRequest('https://neat-tst.vercel.app/api/auth/login', { method: 'POST', body }));
    assert.equal(response.headers.get('location'), accepted ? 'https://neat-tst.vercel.app/' : 'https://neat-tst.vercel.app/login?status=invalid-credentials');
    assert.equal(Boolean(response.headers.get('set-cookie')), accepted);
    assert.equal(f.sessions.length, Number(accepted));
  }
});

test('organization context stays in Echo and never reads a stale Support View cookie', async () => {
  const reads: any[] = [];
  const org = loadModule('lib/organizations.ts', { './prisma': { prisma: { organization: {
    findFirst: async ({ where }: any) => { reads.push(where); return { id: ECHO_ORGANIZATION_ID }; },
  } } } });
  for (const role of Object.values(UserRole)) {
    assert.equal(await org.getOrganizationContext(actor('outside-company', role)), null);
    const context = await org.getOrganizationContext(actor(ECHO_ORGANIZATION_ID, role));
    assert.equal(context.organizationId, ECHO_ORGANIZATION_ID);
    assert.equal(context.isSupportView, false);
  }
  assert.equal(reads.length, Object.values(UserRole).length);
  for (const where of reads) {
    assert.equal(where.id, ECHO_ORGANIZATION_ID);
    assert.equal(where.active, true);
    assert.deepEqual([...where.accountStatus.notIn], ['SUSPENDED', 'CANCELLED']);
  }
});

test('database account reads drop geographic filtering only for valid sessions in active Echo', async () => {
  for (const scenario of [
    { name: 'Echo salesperson', allowed: true },
    { name: 'guest', cookie: false },
    { name: 'expired session', expired: true },
    { name: 'outside platform admin', organizationId: 'outside-company' },
    { name: 'inactive salesperson', userActive: false },
    { name: 'inactive Echo', organizationActive: false },
    { name: 'suspended Echo', status: 'SUSPENDED' },
    { name: 'cancelled Echo', status: 'CANCELLED' },
  ]) {
    const user = { ...actor(scenario.organizationId ?? ECHO_ORGANIZATION_ID, scenario.organizationId ? UserRole.PLATFORM_ADMIN : UserRole.USER), isActive: scenario.userActive ?? true };
    const store = { get: (key: string) => key === 'echo_session' ? (scenario.cookie === false ? undefined : { value: 'cookie' }) : { value: 'outside-company' } };
    const { extendWithAccountStateAccess } = loadModule('lib/accountStateAccess.ts', {
      'next/headers': { cookies: async () => store, headers: async () => ({ get: () => null }) },
    });
    const prisma = extendWithAccountStateAccess({
      $extends: (configuration: any) => configuration.query.$allModels.$allOperations,
      userSession: { findFirst: async ({ where }: any) => {
        assert.equal(where.tokenHash, createHash('sha256').update('cookie').digest('hex'));
        assert.equal(where.user.organizationId, ECHO_ORGANIZATION_ID);
        assert.equal(where.user.isActive, true);
        const expiresAt = new Date(Date.now() + (scenario.expired ? -60_000 : 60_000));
        return user.organizationId === where.user.organizationId && user.isActive === where.user.isActive && expiresAt > where.expiresAt.gt ? { user } : null;
      } },
      organization: { findUnique: async ({ where }: any) => {
        assert.equal(where.id, ECHO_ORGANIZATION_ID);
        return { enabledStates: ['OH'], active: scenario.organizationActive ?? true, accountStatus: scenario.status ?? 'ACTIVE' };
      } },
    });
    const args = { where: { id: 'california-restaurant' } };
    const result = await prisma({ model: 'WholesaleAccount', operation: 'findUnique', args, query: async (value: unknown) => value });
    if (scenario.allowed) {
      assert.strictEqual(result, args, scenario.name);
      const worklistArgs = { where: { organizationId: ECHO_ORGANIZATION_ID, wholesaleAccountId: 'california-restaurant', assignedToUserId: user.id } };
      assert.strictEqual(await prisma({ model: 'WorklistItem', operation: 'findMany', args: worklistArgs, query: async (value: unknown) => value }), worklistArgs);
    } else {
      assert.equal(result.where.id, args.where.id, scenario.name);
      assert.equal(result.where.AND[0].OR[0].state.in.length, 0, scenario.name);
    }
  }
});

function invitationFixture(organizationId = ECHO_ORGANIZATION_ID, race = false) {
  const user = { ...actor(organizationId), isActive: false, passwordHash: null as string | null };
  const invitation = { id: 'invite', userId: user.id, user, acceptedAt: null as Date | null };
  let writes = 0;
  const matches = (where: any) => invitation.acceptedAt === null && where.user.organizationId === user.organizationId;
  const db: any = {
    userInvitation: {
      findFirst: async ({ where }: any) => matches(where) ? invitation : null,
      updateMany: async ({ where }: any) => {
        if (race) user.organizationId = 'outside-company';
        if (!matches(where)) return { count: 0 };
        invitation.acceptedAt = new Date(); writes++; return { count: 1 };
      },
      deleteMany: async () => { writes++; },
    },
    organization: { findUnique: async () => ({ onboardingData: {} }), update: async () => { writes++; } },
    user: { updateMany: async ({ where, data }: any) => {
      if (where.organizationId !== user.organizationId) return { count: 0 };
      Object.assign(user, data); writes++; return { count: 1 };
    } },
    userSession: { deleteMany: async () => { writes++; } },
    $transaction: async (callback: (tx: any) => Promise<unknown>) => callback(db),
  };
  const action = loadModule('app/accept-invite/actions.ts', {
    '../../lib/prisma': { prisma: db }, 'next/navigation': { redirect },
  }).acceptUserInvitation;
  const form = new FormData();
  form.set('token', 'fixture-token'); form.set('password', password); form.set('confirmPassword', password);
  form.set('organizationId', ECHO_ORGANIZATION_ID); form.set('role', 'PLATFORM_ADMIN');
  return { action: () => action(form), user, writes: () => writes };
}

test('Echo invitations activate once while forged membership or a membership change cannot activate an outside user', async () => {
  const echo = invitationFixture();
  await assert.rejects(echo.action(), /redirect:\/login\?status=invite-accepted/);
  assert.equal(echo.user.isActive, true);
  assert.equal(echo.user.role, UserRole.ADMIN);
  assert.equal(verifyPassword(password, echo.user.passwordHash), true);
  await assert.rejects(echo.action(), /redirect:\/accept-invite\?status=invalid/);
  for (const f of [invitationFixture('outside-company'), invitationFixture(ECHO_ORGANIZATION_ID, true)]) {
    await assert.rejects(f.action(), /redirect:\/accept-invite\?status=invalid/);
    assert.equal(f.user.isActive, false);
    assert.equal(f.user.passwordHash, null);
    assert.equal(f.writes(), 0);
  }
});

test('outside invitation links display the existing unavailable state without leaking the invited identity', async () => {
  let where: any;
  const page = loadModule('app/accept-invite/page.tsx', {
    '../../lib/auth': { getUserDisplayName: () => 'Private outside user' },
    '../../lib/prisma': { prisma: { userInvitation: { findFirst: async (input: any) => {
      where = input.where; return null;
    } } } },
    './actions': { acceptUserInvitation: () => {} },
  });
  const html = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({ token: 'outside-token' }) }));
  assert.equal(where.user.organizationId, ECHO_ORGANIZATION_ID);
  assert.match(html, /Invitation unavailable/);
  assert.doesNotMatch(html, /Private outside user|<form/);
});

test('password reset completion denies outside tokens and rechecks membership before changing an Echo password', async () => {
  for (const [organizationId, race] of [[ECHO_ORGANIZATION_ID, false], ['outside-company', false], [ECHO_ORGANIZATION_ID, true]] as const) {
    const user = actor(organizationId), changes: string[] = [];
    const reset = { id: 'reset', userId: user.id, user: { ...user }, usedAt: null, expiresAt: new Date(Date.now() + 60_000) };
    const db: any = {
      passwordResetToken: { findUnique: async () => {
        if (race) user.organizationId = 'outside-company'; return reset;
      }, updateMany: async () => ({ count: 1 }) },
      user: { updateMany: async ({ where, data }: any) => {
        if (where.organizationId !== user.organizationId) return { count: 0 };
        changes.push('password'); user.passwordHash = data.passwordHash; return { count: 1 };
      } },
      userSession: { deleteMany: async () => { changes.push('sessions'); } },
      loginThrottle: { deleteMany: async () => {} },
      $transaction: async (callback: (tx: any) => Promise<unknown>) => callback(db),
    };
    const route = loadModule('app/api/auth/reset-password/route.ts', { '../../../../lib/prisma': { prisma: db } });
    const form = new FormData();
    form.set('token', 'A'.repeat(43)); form.set('password', password); form.set('confirmPassword', password);
    const response = await route.POST(new NextRequest('https://neat-tst.vercel.app/api/auth/reset-password', { method: 'POST', body: form }));
    const accepted = organizationId === ECHO_ORGANIZATION_ID && !race;
    assert.equal(changes.length, accepted ? 2 : 0);
    assert.equal(response.headers.get('location')?.includes('/login?status=password-reset'), accepted);
  }
});
