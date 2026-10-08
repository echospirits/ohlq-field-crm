// Existing import/provisioning/research entry points share the replacement engine.
// Historical scoring functions remain available only for offline comparisons.
import type { PrismaClient } from '@prisma/client';
import { evaluateWholesaleAssessments, runWholesaleAssessmentSweep } from './wholesaleAssessmentService';
export { captureWholesaleSalesEvents } from './accountSalesEvents';
export const runOpportunityIntelligenceAfterImport = runWholesaleAssessmentSweep;
export function evaluateOpportunityIntelligence(options: { db?: PrismaClient; asOfDate?: Date; accountIds?: string[]; organizationId: string; dryRun?: boolean; scoreExistingOnly?: boolean }) {
  return evaluateWholesaleAssessments({ ...options, reconcileLedger: !options.accountIds && !options.dryRun });
}
