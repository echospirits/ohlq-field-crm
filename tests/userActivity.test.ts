import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma, UserRole } from '@prisma/client';
import { activityDay, activityFilters, activityScope, recordUserActivity, validActivityDate } from '../lib/userActivity';
import { getUserActivityReport } from '../lib/userActivityReport';

test('activity uses UTC day boundaries and validates real calendar dates', () => {
  assert.equal(activityDay(new Date('2026-10-08T23:59:59Z')).toISOString(), '2026-10-08T00:00:00.000Z');
  assert.equal(activityDay(new Date('2026-10-09T00:00:00Z')).toISOString(), '2026-10-09T00:00:00.000Z');
  assert.equal(validActivityDate('2026-02-30'), undefined);
  assert.equal(validActivityDate('bad'), undefined);
  assert.equal(validActivityDate('2024-02-29')?.toISOString(), '2024-02-29T00:00:00.000Z');
});

test('admins cannot widen their organization scope and ordinary users are denied', () => {
  assert.deepEqual(activityScope({ role: UserRole.ADMIN, organizationId: 'own' }, 'other'), { organizationId: 'own' });
  assert.deepEqual(activityScope({ role: UserRole.PLATFORM_ADMIN, organizationId: 'own' }), {});
  assert.deepEqual(activityScope({ role: UserRole.PLATFORM_ADMIN, organizationId: null }, 'other'), { organizationId: 'other' });
  for (const role of [UserRole.USER, UserRole.TASTER, UserRole.ADMIN]) {
    assert.throws(() => activityScope({ role, organizationId: role === UserRole.ADMIN ? null : 'own' }));
  }
});

test('filters default to 30 days, bound pagination, and correct reversed dates', () => {
  const filters = activityFilters({}, new Date('2026-10-08T12:00:00Z'));
  assert.equal(filters.from.toISOString().slice(0, 10), '2026-09-09');
  assert.equal(filters.to.toISOString().slice(0, 10), '2026-10-08');
  assert.equal(activityFilters({ page: '-5', sort: 'DROP TABLE' }).page, 1);
  assert.equal(activityFilters({ page: 'Infinity' }).page, 100_000);
  assert.equal(activityFilters({ sort: 'DROP TABLE' }).sort, 'newest');
  assert.equal(activityFilters({ from: '2026-10-10', to: '2026-10-08' }).from.toISOString().slice(0, 10), '2026-10-08');
});

test('repeated use is deduplicated and login counts survive session deletion', async () => {
  const days = new Map<string, { userId: string; organizationId: string | null; day: Date; firstActivityAt: Date; loginCount: number; lastLoginAt?: Date }>();
  const key = (userId: string, day: Date) => `${userId}:${day.toISOString()}`;
  const db = { userActivityDay: {
    createMany: async ({ data, skipDuplicates }: any) => {
      assert.equal(skipDuplicates, true);
      for (const row of data) { const id = key(row.userId, row.day); if (!days.has(id)) days.set(id, { ...row, loginCount: 0 }); }
    },
    upsert: async ({ where, create, update }: any) => {
      const id = key(where.userId_day.userId, where.userId_day.day);
      const existing = days.get(id);
      if (existing) { existing.loginCount += update.loginCount.increment; existing.lastLoginAt = update.lastLoginAt; }
      else days.set(id, create);
    },
  } } as unknown as Pick<Prisma.TransactionClient, 'userActivityDay'>;
  const user = { id: 'u', organizationId: 'own' };
  const now = new Date('2026-10-08T12:00:00Z');
  await Promise.all(Array.from({ length: 10 }, () => recordUserActivity(db, user, false, now)));
  await recordUserActivity(db, user, true, now);
  await recordUserActivity(db, user, true, new Date('2026-10-08T15:00:00Z'));
  await recordUserActivity(db, { id: 'second', organizationId: 'other' }, true, now);
  await recordUserActivity(db, user, false, new Date('2026-10-09T00:00:00Z'));
  assert.equal(days.size, 3);
  const row = days.get(key(user.id, activityDay(now)))!;
  assert.equal(row.loginCount, 2);
  assert.equal(row.organizationId, 'own');
  assert.equal(row.firstActivityAt.toISOString(), now.toISOString());
  assert.equal(row.lastLoginAt?.toISOString(), '2026-10-08T15:00:00.000Z');
});

test('all report queries enforce scope, parameterize search, and clamp page to actual results', async () => {
  const queries: Prisma.Sql[] = [];
  const db = { $queryRaw: async (query: Prisma.Sql) => {
    queries.push(query);
    return queries.length === 1 ? [{ total: 2 }] : [];
  } } as unknown as Pick<Prisma.TransactionClient, '$queryRaw'>;
  const attack = "%' OR 1=1 --";
  const result = await getUserActivityReport(db, { role: UserRole.ADMIN, organizationId: 'own' }, { organization: 'other', q: attack, page: '999', activity: 'login' });
  assert.equal(result.page, 1);
  assert.equal(queries.length, 4);
  for (const query of queries) {
    assert.ok(query.values.includes('own'));
    assert.ok(!query.values.includes('other'));
    assert.ok(query.values.includes(attack.toLowerCase()));
    assert.ok(!query.text.includes(attack));
    if (query.text.includes('"UserActivityDay"')) assert.match(query.text, /"loginCount" > 0/);
  }
});
