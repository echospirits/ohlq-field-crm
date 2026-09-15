import type { PrismaClient } from '@prisma/client';
import { evaluateOpportunityIntelligence } from './opportunityEngine';
import { prisma } from './prisma';

export async function refreshTenantOpportunityScoresForAccounts({
  accountIds,
  asOfDate = new Date(),
  db = prisma,
}: {
  accountIds: string[];
  asOfDate?: Date;
  db?: PrismaClient;
}) {
  const uniqueAccountIds = [...new Set(accountIds)];
  if (uniqueAccountIds.length === 0) return { organizations: 0 };
  const scopes = await db.organization.findMany({
    where: { active: true, features: { some: { featureKey: 'ADVANCED_INTELLIGENCE', enabled: true } } },
    select: { id: true },
  });
  for (const scope of scopes) {
    await evaluateOpportunityIntelligence({ db, asOfDate, accountIds: uniqueAccountIds, organizationId: scope.id });
  }
  return { organizations: scopes.length };
}
