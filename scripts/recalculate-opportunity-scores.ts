import { writeFileSync } from 'node:fs';
import { validateRuntimeEnvironment } from '../lib/appEnvironment';
import { prisma } from '../lib/prisma';
import { enabledAssessmentTenants, evaluateWholesaleAssessments } from '../lib/wholesaleAssessmentService';
const arg = (key: string) => { const i = process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i + 1]; };
async function main() {
  const environment = validateRuntimeEnvironment();
  const apply = process.argv.includes('--apply');
  if (environment.appEnvironment === 'production') throw new Error('This development recalculation command refuses production.');
  const organizations = await prisma.organization.findMany({ where: { ...enabledAssessmentTenants, ...(arg('--organization') ? { id: arg('--organization') } : {}) }, select: { id: true } });
  if (!organizations.length) throw new Error('No enabled organization matches this request.');
  const results = [];
  for (const organization of organizations) {
    try {
    const result = await evaluateWholesaleAssessments({ organizationId: organization.id, dryRun: !apply, reconcileLedger: apply, accountIds: arg('--account') ? [arg('--account')!] : undefined });
    results.push({ organizationId: organization.id, ...result });
    console.log(JSON.stringify({ organizationId: organization.id, expected: result.expected, evaluated: result.evaluated, persisted: result.persisted, failed: result.failed, evidenceCounts: result.evidenceCounts, runId: result.runId }));
    if (result.failed || apply && result.persisted !== result.expected) process.exitCode = 1;
    } catch {
      console.error(`Assessment refresh failed for ${organization.id}; inspect run status and retry scoring.`);
      results.push({ organizationId: organization.id, failed: true });
      process.exitCode = 1;
    }
  }
  if (arg('--output')) writeFileSync(arg('--output')!, JSON.stringify(results, null, 2));
}
main().catch(e => { console.error(e instanceof Error ? e.message : 'Recalculation failed'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
