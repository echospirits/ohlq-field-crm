import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { prisma } from '../lib/prisma';
import { getTenantWeeklyDigest, sendWeeklyDigestForAllUsers } from '../lib/weeklyDigest';
import { fallbackWeeklyDigestNarrative } from '../lib/weeklyDigestNarrative';
import { makeTenantDigest } from './fixtures/weeklyDigest';

function stub(t: TestContext, target: any, method: string, fn: (...args: any[]) => any) {
  const original = target[method]; target[method] = fn; t.after(() => { target[method] = original; });
}

test('all tenant roles get identical briefs; separate tenants get separate data; duplicate addresses and triggers are suppressed', async (t) => {
  const users = [
    { id: 'rep', role: 'USER', email: 'rep@example.com', organizationId: 'org_echo_spirits' },
    { id: 'admin', role: 'ADMIN', email: 'admin@example.com', organizationId: 'org_echo_spirits' },
    { id: 'taster', role: 'TASTER', email: 'taster@example.com', organizationId: 'org_echo_spirits' },
    { id: 'platform', role: 'PLATFORM_ADMIN', email: 'platform@example.com', organizationId: null },
    { id: 'other', role: 'PLATFORM_ADMIN', email: 'other@example.com', organizationId: 'org_other' },
    { id: 'duplicate', role: 'USER', email: ' REP@example.com ', organizationId: 'org_echo_spirits' },
    { id: 'missing', role: 'USER', email: '', organizationId: 'org_echo_spirits' },
  ];
  stub(t, prisma.organizationFeature, 'findMany', async (args) => {
    assert.equal(args.where.enabled, true); assert.equal(args.where.organization.active, true);
    assert.deepEqual(args.where.organization.accountStatus.notIn, ['SUSPENDED', 'CANCELLED']);
    return [{ organizationId: 'org_echo_spirits' }, { organizationId: 'org_other' }];
  });
  stub(t, prisma.user, 'findMany', async (args) => {
    assert.equal(args.where.isActive, true);
    assert.equal(args.where.OR[0].role, undefined); // Tasters are included.
    return users;
  });
  const logs = new Map<string, any>();
  stub(t, prisma.weeklyDigestLog, 'findFirst', async (args) => [...logs.values()].find((l) => l.organizationId === args.where.organizationId && l.recipientEmail === args.where.recipientEmail.equals && l.status === 'SENT') ?? null);
  stub(t, prisma.weeklyDigestLog, 'upsert', async (args) => {
    const key = `${args.create.organizationId}:${args.create.recipientEmail}`;
    if (!logs.has(key)) logs.set(key, { ...args.create, id: key });
    return logs.get(key);
  });
  stub(t, prisma.weeklyDigestLog, 'updateMany', async (args) => {
    const log = logs.get(args.where.id); if (log.runAt || log.status === 'SENT') return { count: 0 };
    log.runAt = new Date(); return { count: 1 };
  });
  stub(t, prisma.weeklyDigestLog, 'update', async (args) => Object.assign(logs.get(args.where.id), args.data));
  const emails: any[] = []; const generated: string[] = [];
  const options = { digestLoader: async (id: string) => { generated.push(id); return makeTenantDigest(id, id === 'org_other' ? 'Other Distillery' : 'Echo Spirits'); },
    emailSender: async (email: any) => { emails.push(email); return { providerMessageId: 'message' }; } };
  const first = await sendWeeklyDigestForAllUsers(options);
  assert.equal(first.sent, 5); assert.equal(first.missingEmailSkipped, 1);
  assert.deepEqual(generated, ['org_echo_spirits', 'org_other']);
  assert.equal(new Set(emails.slice(0, 4).map((email) => email.html)).size, 1);
  assert.match(emails[4].subject, /Other Distillery/); assert.doesNotMatch(emails[4].html, /Echo Spirits/);
  assert.equal((await sendWeeklyDigestForAllUsers(options)).skipped, 5);
  assert.equal(emails.length, 5);
});

test('manual sends filter feature eligibility by the current tenant', async (t) => {
  stub(t, prisma.organizationFeature, 'findMany', async (args) => { assert.equal(args.where.organizationId, 'org_one'); return [{ organizationId: 'org_one' }]; });
  stub(t, prisma.user, 'findMany', async (args) => { assert.deepEqual(args.where.OR, [{ organizationId: { in: ['org_one'] } }]); return []; });
  assert.equal((await sendWeeklyDigestForAllUsers({ organizationId: 'org_one' })).attempted, 0);
});

test('one tenant generation failure does not prevent another tenant from receiving its brief', async (t) => {
  stub(t, prisma.organizationFeature, 'findMany', async () => [{ organizationId: 'broken' }, { organizationId: 'good' }]);
  stub(t, prisma.user, 'findMany', async () => ['broken', 'good'].map((id) => ({ id, organizationId: id, role: 'USER', email: `${id}@example.com` })));
  stub(t, prisma.weeklyDigestLog, 'findFirst', async () => null);
  stub(t, prisma.weeklyDigestLog, 'upsert', async () => ({ id: 'log' }));
  stub(t, prisma.weeklyDigestLog, 'updateMany', async () => ({ count: 1 }));
  stub(t, prisma.weeklyDigestLog, 'update', async () => ({}));
  const result = await sendWeeklyDigestForAllUsers({ digestLoader: async (id) => { if (id === 'broken') throw new Error('data unavailable'); return makeTenantDigest(id, id); }, emailSender: async () => ({ providerMessageId: 'ok' }) });
  assert.equal(result.failed, 1); assert.equal(result.sent, 1);
});

test('tenant-wide counts include all activity once and use date-only worklist boundaries', async (t) => {
  const fixture = makeTenantDigest();
  stub(t, prisma.organization, 'findUnique', async (args) => { assert.equal(args.where.id, fixture.organization.id); return fixture.organization; });
  stub(t, prisma.organizationProduct, 'findMany', async () => []);
  stub(t, prisma.loggedVisit, 'findMany', async (args) => { assert.equal(args.where.organizationId, fixture.organization.id); assert.equal(args.where.OR, undefined); return []; });
  stub(t, prisma.loggedVisit, 'count', async () => 400);
  stub(t, prisma.worklistItem, 'findMany', async (args) => { assert.equal(args.where.organizationId, fixture.organization.id); assert.equal(args.where.assignedToUserId, undefined); return []; });
  stub(t, prisma.worklistItem, 'count', async (args) => {
    assert.equal(args.where.organizationId, fixture.organization.id);
    if (args.where.completedAt) return 250;
    if (args.where.dueDate.gte) assert.equal(args.where.dueDate.gte.toISOString(), '2026-09-18T00:00:00.000Z');
    else assert.equal(args.where.dueDate.lt.toISOString(), '2026-09-18T00:00:00.000Z');
    return args.where.assignedToUserId === null ? 2 : 10;
  });
  for (const model of [prisma.agency, prisma.wholesaleAccount, prisma.locationContact]) stub(t, model, 'findMany', async () => []);
  const digest = await getTenantWeeklyDigest(fixture.organization.id, fixture.window, async (input) => fallbackWeeklyDigestNarrative(input));
  assert.equal(digest.metrics.visitsLogged, 400); assert.equal(digest.metrics.completedWork, 250);
  assert.equal(digest.evidenceLimited, true);
});

test('a concurrent send claim and legacy successful log each prevent delivery', async (t) => {
  stub(t, prisma.organizationFeature, 'findMany', async () => [{ organizationId: 'one' }]);
  stub(t, prisma.user, 'findMany', async () => [{ id: 'rep', organizationId: 'one', role: 'USER', email: 'rep@example.com' }]);
  let legacy = false;
  stub(t, prisma.weeklyDigestLog, 'findFirst', async (args) => { assert.equal(args.where.digestType, undefined); return legacy ? { status: 'SENT' } : null; });
  stub(t, prisma.weeklyDigestLog, 'upsert', async () => ({ id: 'pending' }));
  stub(t, prisma.weeklyDigestLog, 'updateMany', async () => ({ count: 0 }));
  const options = { digestLoader: async () => makeTenantDigest('one'), emailSender: async () => { assert.fail('must not send'); } };
  assert.equal((await sendWeeklyDigestForAllUsers(options)).skipped, 1);
  legacy = true;
  assert.equal((await sendWeeklyDigestForAllUsers(options)).skipped, 1);
});
