import type { PrismaClient } from '@prisma/client';
import { evaluateOpportunityIntelligence } from './opportunityEngine';
import { prisma } from './prisma';
import { enabledAssessmentTenants } from './wholesaleAssessmentService';

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
    where: enabledAssessmentTenants,
    select: { id: true },
  });
  const failures: string[] = [];
  for (const scope of scopes) {
    try {
      const result = await evaluateOpportunityIntelligence({ db, asOfDate, accountIds: uniqueAccountIds, organizationId: scope.id });
      if (result.failed || result.persisted !== result.expected) failures.push(scope.id);
    } catch { failures.push(scope.id); }
  }
  if (failures.length) throw new Error(`Saved research needs score-only retry for organizations: ${failures.join(', ')}`);
  return { organizations: scopes.length };
}
