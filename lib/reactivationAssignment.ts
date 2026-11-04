import { type Prisma, type PrismaClient, type User } from '@prisma/client';
import { z } from 'zod';
import { getUserDisplayName } from './auth';

type AssignmentDb = PrismaClient | Prisma.TransactionClient;
type Assignee = Pick<User, 'id' | 'name' | 'email' | 'firstName' | 'lastName'>;

export const reactivationAssigneeSelect = {
  id: true, name: true, email: true, firstName: true, lastName: true,
} as const;

export function readDefaultReactivationAssigneeUserId(settings: unknown): string | null {
  const parsed = z.object({ defaultReactivationAssigneeUserId: z.string().trim().min(1).max(100).optional() }).safeParse(settings);
  return parsed.success ? parsed.data.defaultReactivationAssigneeUserId ?? null : null;
}

export function isValidReactivationAssignee(
  user: { organizationId: string | null; isActive: boolean; role: string } | null | undefined,
  organizationId: string,
) {
  return Boolean(user && user.organizationId === organizationId && user.isActive && !['TASTER', 'PLATFORM_ADMIN'].includes(user.role));
}

export const reactivationAssignmentData = (user: Assignee | null | undefined) => ({
  assignedToUserId: user?.id ?? null,
  assignedTo: user ? getUserDisplayName(user) : null,
});

/** Only canonical physical visits and active members of this organization qualify. */
export async function resolveReactivationAssignees({ db, organizationId, wholesaleAccountIds, runAt }: {
  db: AssignmentDb;
  organizationId: string;
  wholesaleAccountIds: string[];
  runAt: Date;
}) {
  const ids = [...new Set(wholesaleAccountIds)];
  const assignees = new Map<string, Assignee | null>();
  if (!ids.length) return assignees;
  const [organization, visits] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { settings: true } }),
    db.loggedVisit.findMany({
      where: {
        organizationId,
        locationType: 'wholesale',
        wholesaleAccountId: { in: ids },
        visitAt: { lte: runAt },
        createdByUser: { is: { organizationId, isActive: true, role: { notIn: ['TASTER', 'PLATFORM_ADMIN'] } } },
      },
      orderBy: [{ visitAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: { wholesaleAccountId: true, createdByUser: { select: reactivationAssigneeSelect } },
    }),
  ]);
  const fallbackId = readDefaultReactivationAssigneeUserId(organization?.settings);
  const fallback = fallbackId ? await db.user.findFirst({
    where: { id: fallbackId, organizationId, isActive: true, role: { notIn: ['TASTER', 'PLATFORM_ADMIN'] } },
    select: reactivationAssigneeSelect,
  }) : null;
  for (const visit of visits) {
    if (visit.wholesaleAccountId && visit.createdByUser && !assignees.has(visit.wholesaleAccountId)) {
      assignees.set(visit.wholesaleAccountId, visit.createdByUser);
    }
  }
  for (const id of ids) if (!assignees.has(id)) assignees.set(id, fallback);
  return assignees;
}

export async function configureDefaultReactivationAssignee({ db, organizationId, userId, actorUserId }: {
  db: Prisma.TransactionClient;
  organizationId: string;
  userId: string | null;
  actorUserId: string;
}) {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crm-settings:${organizationId}`},0))`;
  const actor = await db.user.findFirst({ where: { id: actorUserId, organizationId, isActive: true, role: { in: ['ADMIN', 'PLATFORM_ADMIN'] } }, select: { id: true } });
  if (!actor) throw new Error('An active organization administrator must configure reactivation assignment.');
  const assignee = userId ? await db.user.findFirst({
    where: { id: userId, organizationId, isActive: true, role: { notIn: ['TASTER', 'PLATFORM_ADMIN'] } },
    select: reactivationAssigneeSelect,
  }) : null;
  if (userId && !assignee) throw new Error('Choose an active assignable member of this organization.');
  const organization = await db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
  const settings = organization.settings && typeof organization.settings === 'object' && !Array.isArray(organization.settings) ? organization.settings : {};
  await db.organization.update({ where: { id: organizationId }, data: { settings: { ...settings, defaultReactivationAssigneeUserId: assignee?.id ?? null } } });
  await db.organizationAuditEvent.create({ data: {
    organizationId, actorUserId, action: 'ORGANIZATION_UPDATED',
    metadata: { kind: 'DEFAULT_REACTIVATION_ASSIGNEE_CHANGED', assignedToUserId: assignee?.id ?? null },
  } });
  return assignee;
}
