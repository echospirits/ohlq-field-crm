import { Prisma, UserRole } from '@prisma/client';
import { activityFilters, activityScope } from './userActivity';

export type ActivityRow = {
  userId: string; organizationId: string | null; day: Date;
  firstActivityAt: Date; lastLoginAt: Date | null; loginCount: number;
  userName: string; email: string | null; organizationName: string;
};
export type ActivitySummary = {
  organizationId: string | null; organizationName: string;
  activeUsers: number; activeDays: number; userDays: number; logins: number;
};
export const ACTIVITY_PAGE_SIZE = 50;

export async function getUserActivityReport(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  user: { role: UserRole; organizationId: string | null },
  params: Record<string, string | undefined>,
  now = new Date(),
) {
  const filters = activityFilters(params, now);
  const scope = activityScope(user, filters.organizationId);
  const organization = scope.organizationId;
  const conditions = [Prisma.sql`a."day" BETWEEN ${filters.from}::date AND ${filters.to}::date`];
  if (typeof organization === 'string') conditions.push(Prisma.sql`a."organizationId" = ${organization}`);
  if (filters.activity === 'login') conditions.push(Prisma.sql`a."loginCount" > 0`);
  if (filters.q) {
    // Literal substring search: wildcard characters are not extra permissions or filters.
    const q = filters.q.toLowerCase();
    conditions.push(Prisma.sql`(strpos(lower(concat_ws(' ', u."firstName", u."lastName", u."name", u."email", o."displayName")), ${q}) > 0)`);
  }
  const from = Prisma.sql`FROM "UserActivityDay" a
    LEFT JOIN "User" u ON u."id" = a."userId"
    LEFT JOIN "Organization" o ON o."id" = a."organizationId"
    WHERE ${Prisma.join(conditions, ' AND ')}`;
  const organizationName = Prisma.sql`COALESCE(o."displayName", CASE WHEN a."organizationId" IS NULL THEN 'No organization' ELSE 'Deleted organization' END)`;
  const order = filters.sort === 'logins'
    ? Prisma.sql`a."loginCount" DESC, a."day" DESC, a."userId" ASC`
    : filters.sort === 'oldest' ? Prisma.sql`a."day" ASC, a."userId" ASC` : Prisma.sql`a."day" DESC, a."userId" ASC`;
  const organizationConditions = [Prisma.sql`TRUE`];
  if (typeof organization === 'string') organizationConditions.push(Prisma.sql`o."id" = ${organization}`);
  if (filters.q) organizationConditions.push(Prisma.sql`(strpos(lower(o."displayName"), ${filters.q.toLowerCase()}) > 0 OR EXISTS (
    SELECT 1 FROM "User" u WHERE u."organizationId" = o."id" AND strpos(lower(concat_ws(' ', u."firstName", u."lastName", u."name", u."email")), ${filters.q.toLowerCase()}) > 0))`);
  const [counts, summaries, organizations] = await Promise.all([
    db.$queryRaw<Array<{ total: number }>>(Prisma.sql`SELECT COUNT(*)::int AS total ${from}`),
    db.$queryRaw<ActivitySummary[]>(Prisma.sql`SELECT a."organizationId", ${organizationName} AS "organizationName",
      COUNT(DISTINCT a."userId")::int AS "activeUsers", COUNT(DISTINCT a."day")::int AS "activeDays",
      COUNT(*)::int AS "userDays", COALESCE(SUM(a."loginCount"), 0)::int AS logins
      ${from} GROUP BY a."organizationId", o."displayName" ORDER BY "userDays" DESC, "organizationName" ASC`),
    db.$queryRaw<Array<{ id: string; displayName: string }>>(Prisma.sql`SELECT o."id", o."displayName" FROM "Organization" o
      WHERE ${Prisma.join(organizationConditions, ' AND ')} ORDER BY o."displayName" ASC`),
  ]);
  const represented = new Set(summaries.map((summary) => summary.organizationId));
  for (const organization of organizations) {
    if (!represented.has(organization.id)) summaries.push({ organizationId: organization.id, organizationName: organization.displayName, activeUsers: 0, activeDays: 0, userDays: 0, logins: 0 });
  }
  const total = counts[0]?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE));
  const page = Math.min(filters.page, pages);
  const rows = await db.$queryRaw<ActivityRow[]>(Prisma.sql`SELECT a.*,
    COALESCE(NULLIF(trim(concat_ws(' ', u."firstName", u."lastName")), ''), u."name", u."email", 'Deleted user') AS "userName",
    u."email", ${organizationName} AS "organizationName"
    ${from} ORDER BY ${order} LIMIT ${ACTIVITY_PAGE_SIZE} OFFSET ${(page - 1) * ACTIVITY_PAGE_SIZE}`);
  return { filters, page, pages, total, rows, summaries };
}
