'use server';

import { OpportunityEventType, OpportunityStatus, WorklistStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '../../../lib/auth';
import { syncWorklistItemCalendar } from '../../../lib/calendar/worklistSync';
import { prisma } from '../../../lib/prisma';
import { requireOrganizationContext } from '../../../lib/organizations';

export async function resolveVisitOrigin(formData: FormData) {
  const user = await requireUser();
  const { organizationId } = await requireOrganizationContext(user);
  const visitId = String(formData.get('visitId') ?? '').trim();
  const origin = String(formData.get('origin') ?? 'visits') === 'worklist' ? 'worklist' : 'visits';
  const decision = String(formData.get('decision') ?? 'keep-open');
  const visit = await prisma.loggedVisit.findFirst({
    where: { id: visitId, createdByUserId: user.id, organizationId },
    select: { id: true, salesOpportunityId: true, agencyProductIntelligenceId: true, originatingWorklistItemId: true, wholesaleAccountId: true },
  });
  if (!visit) redirect('/visits');

  if (decision === 'complete-task' && visit.originatingWorklistItemId) {
    const item = await prisma.worklistItem.findFirst({ where: { id: visit.originatingWorklistItemId, organizationId, status: { in: [WorklistStatus.OPEN, WorklistStatus.IN_PROGRESS] } }, select: { id: true, salesOpportunityId: true, wholesaleAccountId: true } });
    if (item) await prisma.worklistItem.update({ where: { id: item.id }, data: { status: WorklistStatus.COMPLETED, completedAt: new Date(), completedByUserId: user.id, cancelledAt: null, cancelledByUserId: null, loggedVisitId: visit.id } });
    if (item) await syncWorklistItemCalendar(item.id);
    if (item?.salesOpportunityId && item.wholesaleAccountId) {
      await prisma.opportunityEvent.create({ data: { organizationId, opportunityId: item.salesOpportunityId, eventType: OpportunityEventType.TASK_COMPLETED, eventKey: `TASK_COMPLETED_AFTER_VISIT:${visit.id}`, wholesaleAccountId: item.wholesaleAccountId, userId: user.id, loggedVisitId: visit.id, worklistItemId: item.id, occurredAt: new Date() } }).catch(() => undefined);
    }
  }

  if (decision === 'action-opportunity' && visit.salesOpportunityId && visit.wholesaleAccountId) {
    const now = new Date();
    const updated = await prisma.salesOpportunity.updateMany({ where: { id: visit.salesOpportunityId, organizationId, status: OpportunityStatus.OPEN }, data: { status: OpportunityStatus.ACTIONED, actionedAt: now, assignedToUserId: user.id } });
    if (updated.count > 0) await prisma.opportunityEvent.create({ data: { organizationId, opportunityId: visit.salesOpportunityId, eventType: OpportunityEventType.ACTIONED, eventKey: `ACTIONED_AFTER_VISIT:${visit.id}`, wholesaleAccountId: visit.wholesaleAccountId, userId: user.id, loggedVisitId: visit.id, occurredAt: now } }).catch(() => undefined);
  }

  if (decision === 'action-opportunity' && visit.agencyProductIntelligenceId) {
    await prisma.agencyProductIntelligence.updateMany({ where: { id: visit.agencyProductIntelligenceId, organizationId, status: OpportunityStatus.OPEN }, data: { status: OpportunityStatus.ACTIONED } });
  }

  revalidatePath('/alerts');
  revalidatePath('/my-week');
  revalidatePath('/opportunities');
  revalidatePath('/agency-focus');
  revalidatePath('/');
  redirect(`/visits/confirmed?visitId=${encodeURIComponent(visit.id)}&origin=${origin}&resolved=1`);
}
