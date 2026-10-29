import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './prisma';

/** Resolve account names before the result cap, using the same scoped directory as task labels. */
export async function getWorklistSearchAlternatives(query: string, organizationId: string, db: PrismaClient = prisma): Promise<Prisma.WorklistItemWhereInput[]> {
  const q = query.trim();
  if (!q) return [];
  const text = { contains: q, mode: 'insensitive' as const };
  const [agencies, accounts] = await Promise.all([
    db.agency.findMany({ where: { name: text }, select: { id: true, agencyId: true } }),
    db.wholesaleAccount.findMany({ where: { name: text }, select: { id: true } }),
  ]);
  const agencyIds = [...new Set(agencies.flatMap(agency => [agency.id, agency.agencyId]))];
  const wholesaleIds = accounts.map(account => account.id);
  const alternatives: Prisma.WorklistItemWhereInput[] = [
    { title: text }, { detail: text }, { assignedTo: text }, { createdBy: text },
  ];
  if (agencyIds.length) alternatives.push({ agencyId: { in: agencyIds } });
  if (wholesaleIds.length) alternatives.push({ wholesaleAccountId: { in: wholesaleIds } });
  const visitLocations: Prisma.LoggedVisitWhereInput[] = [
    ...(agencyIds.length ? [{ agencyId: { in: agencyIds } }] : []),
    ...(wholesaleIds.length ? [{ wholesaleAccountId: { in: wholesaleIds } }] : []),
  ];
  if (visitLocations.length) alternatives.push({
    agencyId: null, wholesaleAccountId: null,
    loggedVisit: { is: { organizationId, OR: visitLocations } },
  });
  return alternatives;
}
