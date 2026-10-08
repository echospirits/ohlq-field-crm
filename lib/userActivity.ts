import { Prisma, UserRole } from '@prisma/client';

export const activityDay = (now = new Date()) => new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);

// IDs are kept as scalar values so deleting a session/user cannot erase history.
// One row per user/day; logins increment a counter, ordinary use never updates it.
export async function recordUserActivity(
  db: Pick<Prisma.TransactionClient, 'userActivityDay'>,
  user: { id: string; organizationId: string | null },
  login = false,
  now = new Date(),
) {
  const day = activityDay(now);
  if (login) {
    await db.userActivityDay.upsert({
      where: { userId_day: { userId: user.id, day } },
      create: { userId: user.id, organizationId: user.organizationId, day, firstActivityAt: now, lastLoginAt: now, loginCount: 1 },
      update: { lastLoginAt: now, loginCount: { increment: 1 } },
    });
  } else {
    await db.userActivityDay.createMany({
      data: [{ userId: user.id, organizationId: user.organizationId, day, firstActivityAt: now }],
      skipDuplicates: true,
    });
  }
  return day.toISOString().slice(0, 10);
}

export function activityScope(user: { role: UserRole; organizationId: string | null }, organizationId?: string): Prisma.UserActivityDayWhereInput {
  if (user.role === UserRole.PLATFORM_ADMIN) return organizationId ? { organizationId } : {};
  if (user.role !== UserRole.ADMIN || !user.organizationId) throw new Error('Organization admin access required.');
  return { organizationId: user.organizationId };
}

export function validActivityDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : undefined;
}

export function activityFilters(params: Record<string, string | undefined>, now = new Date()) {
  const end = validActivityDate(params.to) ?? activityDay(now);
  const start = validActivityDate(params.from) ?? new Date(end.getTime() - 29 * 86_400_000);
  return {
    from: start <= end ? start : end,
    to: end,
    q: (params.q ?? '').trim().slice(0, 100),
    organizationId: (params.organization ?? '').slice(0, 100),
    activity: params.activity === 'login' ? 'login' : 'all',
    sort: ['oldest', 'logins'].includes(params.sort ?? '') ? params.sort! : 'newest',
    page: Math.min(100_000, Math.max(1, Math.floor(Number(params.page) || 1))),
  };
}
