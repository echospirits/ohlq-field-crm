import { after } from 'next/server';
import { prisma } from './prisma';
import { evaluateWholesaleAssessments } from './wholesaleAssessmentService';
// The bounded refresh reads saved data only. A failed/overlapping run stays visibly
// pending and the full daily sweep retries it; it cannot undo an evidence save.
export function scheduleWholesaleAssessment(organizationId: string, accountId: string) {
  after(async () => {
    await prisma.wholesaleAccountAssessment.updateMany({ where: { organizationId, wholesaleAccountId: accountId }, data: { refreshRequestedAt: new Date() } });
    try { await evaluateWholesaleAssessments({ organizationId, accountIds: [accountId] }); }
    catch { console.warn('Wholesale assessment refresh remains pending', { organizationId, accountId }); }
  });
}
