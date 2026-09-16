import { OpportunityStatus, PrismaClient } from '@prisma/client';
import { OPPORTUNITY_RANKING_VERSION } from '../lib/opportunityConfig';
import { OPPORTUNITY_TERRITORIES, opportunityTerritoryForCounty } from '../lib/opportunityTerritories';

const db = new PrismaClient();
const average = (values: number[]) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;

async function main() {
  const organizations = await db.organization.findMany({
    where: { active: true, features: { some: { enabled: true, featureKey: 'WHOLESALE_OPPORTUNITIES' } } },
    select: { id: true, displayName: true },
  });
  const output = [];
  for (const organization of organizations) {
    const opportunities = await db.salesOpportunity.findMany({
      where: { organizationId: organization.id, status: OpportunityStatus.OPEN },
      orderBy: [{ productionScore: 'desc' }, { detectedAt: 'desc' }],
      select: { productionScore: true, scoringVersion: true, wholesaleAccount: { select: { county: true, targetPublicResearch: { select: { lastRefreshedAt: true } } } } },
    });
    const territoryRows = OPPORTUNITY_TERRITORIES.map((territory) => {
      const rows = opportunities.filter((item) => opportunityTerritoryForCounty(item.wholesaleAccount.county) === territory.slug);
      const researched = rows.filter((item) => item.wholesaleAccount.targetPublicResearch?.lastRefreshedAt).length;
      return {
        territory: territory.label,
        open: rows.length,
        score60Plus: rows.filter((item) => item.productionScore >= 60).length,
        score75Plus: rows.filter((item) => item.productionScore >= 75).length,
        averageScore: Number(average(rows.map((item) => item.productionScore)).toFixed(1)),
        researchCoveragePercent: Number((researched / Math.max(1, rows.length) * 100).toFixed(1)),
        top250Count: opportunities.slice(0, 250).filter((item) => opportunityTerritoryForCounty(item.wholesaleAccount.county) === territory.slug).length,
      };
    });
    const versionCounts = new Map<string, number>();
    for (const opportunity of opportunities) versionCounts.set(opportunity.scoringVersion, (versionCounts.get(opportunity.scoringVersion) ?? 0) + 1);
    output.push({
      organization: organization.displayName,
      totalOpen: opportunities.length,
      currentVersionCount: opportunities.filter((item) => item.scoringVersion === OPPORTUNITY_RANKING_VERSION).length,
      scoringVersions: Object.fromEntries(versionCounts),
      territories: territoryRows,
    });
  }
  console.log(JSON.stringify({ expectedVersion: OPPORTUNITY_RANKING_VERSION, organizations: output }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => db.$disconnect());
