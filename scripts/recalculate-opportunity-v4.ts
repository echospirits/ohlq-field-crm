import { createHash } from 'node:crypto';
import { OpportunityStatus, PrismaClient } from '@prisma/client';
import { validateRuntimeEnvironment } from '../lib/appEnvironment';
import { OPPORTUNITY_RANKING_VERSION } from '../lib/opportunityConfig';
import { evaluateOpportunityIntelligence } from '../lib/opportunityEngine';

const db = new PrismaClient();
const preservedStatuses = [OpportunityStatus.OPEN, OpportunityStatus.ACTIONED, OpportunityStatus.SNOOZED, OpportunityStatus.DISMISSED];

const workflowDigest = (rows: Array<Record<string, unknown>>) => createHash('sha256')
  .update(JSON.stringify(rows, Object.keys(rows[0] ?? {}).sort()))
  .digest('hex');

async function workflowSnapshot(organizationId: string) {
  const rows = await db.salesOpportunity.findMany({
    where: { organizationId, status: { in: preservedStatuses } },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      status: true,
      actionedAt: true,
      snoozedUntil: true,
      dismissedAt: true,
      dismissalReason: true,
      assignedToUserId: true,
    },
  });
  return { count: rows.length, digest: workflowDigest(rows) };
}

async function main() {
  const runtime = validateRuntimeEnvironment();
  if (runtime.appEnvironment === 'production' && !process.argv.includes('--confirm-production')) {
    throw new Error('Production V4 recalculation requires --confirm-production.');
  }
  const latestImport = await db.ohlqReportImportStatus.findFirst({
    where: { dataSource: 'ANNUAL_SALES_SUMMARY_BY_WHOLESALE', status: 'COMPLETED' },
    orderBy: { reportDate: 'desc' },
    select: { reportDate: true },
  });
  if (!latestImport) throw new Error('No completed wholesale sales import is available for a scoring date.');
  const organizations = await db.organization.findMany({
    where: { active: true, features: { some: { enabled: true, featureKey: 'WHOLESALE_OPPORTUNITIES' } } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, displayName: true },
  });
  const results = [];
  for (const organization of organizations) {
    const opportunities = await db.salesOpportunity.findMany({
      where: { organizationId: organization.id, status: { in: preservedStatuses } },
      distinct: ['wholesaleAccountId'],
      select: { wholesaleAccountId: true },
    });
    const before = await workflowSnapshot(organization.id);
    const result = await evaluateOpportunityIntelligence({
      db,
      organizationId: organization.id,
      accountIds: opportunities.map((item) => item.wholesaleAccountId),
      asOfDate: latestImport.reportDate,
      scoreExistingOnly: true,
    });
    const after = await workflowSnapshot(organization.id);
    if (before.count !== after.count || before.digest !== after.digest) {
      throw new Error(`Workflow status preservation check failed for ${organization.displayName}.`);
    }
    const versions = await db.salesOpportunity.groupBy({
      by: ['scoringVersion'],
      where: { organizationId: organization.id, status: { in: preservedStatuses } },
      _count: true,
    });
    results.push({ organization: organization.displayName, organizationId: organization.id, before, after, result, versions });
  }
  console.log(JSON.stringify({ environment: runtime.appEnvironment, asOfDate: latestImport.reportDate, expectedVersion: OPPORTUNITY_RANKING_VERSION, organizations: results }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => db.$disconnect());
