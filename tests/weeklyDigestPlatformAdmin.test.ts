import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { UserRole, WeeklyDigestStatus, WeeklyDigestType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ECHO_ORGANIZATION_ID } from '../lib/organizations';
import { sendWeeklyDigestForAllUsers } from '../lib/weeklyDigest';

// Prisma delegates use proxy methods, so restore assigned stubs after each test.
function stub(t: TestContext, target: any, method: string, implementation: (...args: any[]) => any) {
  const original = target[method];
  target[method] = implementation;
  t.after(() => { target[method] = original; });
}

for (const organizationId of [null, 'org_other', ECHO_ORGANIZATION_ID]) {
  test(`platform admin receives Echo team digest with home organization ${organizationId}`, async (t) => {
    const admin = { id: 'platform-admin', email: 'admin@example.com', role: UserRole.PLATFORM_ADMIN, organizationId, isActive: true };
    stub(t, prisma.organizationFeature, 'findMany', async () => [{ organizationId: ECHO_ORGANIZATION_ID }]);
    stub(t, prisma.user, 'findMany', async (args: any) => {
      if (args.where.OR) {
        assert.equal(args.where.isActive, true);
        assert.deepEqual(args.where.OR[1], { role: UserRole.PLATFORM_ADMIN });
        assert.deepEqual(args.where.OR[0].role.notIn, [UserRole.TASTER, UserRole.PLATFORM_ADMIN]);
        return [admin];
      }
      assert.equal(args.where.organizationId, ECHO_ORGANIZATION_ID);
      return [];
    });
    stub(t, prisma.user, 'findUnique', async () => admin);
    stub(t, prisma.worklistItem, 'findMany', async (args: any) => {
      assert.equal(args.where.organizationId, ECHO_ORGANIZATION_ID);
      return [];
    });
    for (const model of [prisma.agency, prisma.wholesaleAccount, prisma.locationContact]) {
      stub(t, model, 'findMany', async () => []);
    }
    let sent = 0;
    let existing: any = null;
    stub(t, prisma.weeklyDigestLog, 'findUnique', async () => existing);
    stub(t, prisma.weeklyDigestLog, 'create', async (args: any) => {
      assert.equal(args.data.organizationId, ECHO_ORGANIZATION_ID);
      assert.equal(args.data.digestType, WeeklyDigestType.ADMIN_WEEKLY);
      return { id: 'log' };
    });
    stub(t, prisma.weeklyDigestLog, 'update', async () => ({ id: 'log' }));
    const options = { emailSender: async (email: any) => {
      assert.equal(email.to, admin.email);
      sent++;
      return { providerMessageId: 'message' };
    }, appBaseUrl: 'http://localhost:3000' };
    assert.equal((await sendWeeklyDigestForAllUsers(options)).sent, 1);
    existing = { id: 'log', status: WeeklyDigestStatus.SENT };
    assert.equal((await sendWeeklyDigestForAllUsers(options)).skipped, 1);
    assert.equal(sent, 1);
  });
}

test('platform admins are not selected when Echo is ineligible for weekly digests', async (t) => {
  stub(t, prisma.organizationFeature, 'findMany', async () => [{ organizationId: 'org_other' }]);
  stub(t, prisma.user, 'findMany', async (args: any) => {
    assert.equal(args.where.OR.length, 1);
    assert.deepEqual(args.where.OR[0].role.notIn, [UserRole.TASTER, UserRole.PLATFORM_ADMIN]);
    return [];
  });
  assert.equal((await sendWeeklyDigestForAllUsers()).attempted, 0);
});
