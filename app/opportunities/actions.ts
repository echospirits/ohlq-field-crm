'use server';

import { OpportunityEventType, OpportunityStatus, Prisma, UserRole, WorklistCategory, WorklistSource, WorklistStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { getUserDisplayName, requireUser } from '../../lib/auth';
import { scheduleWorklistSync } from '../../lib/calendar/scheduleWorklistSync';
import type { ActionResult } from '../components/ActionForm';
import { requireFeatureForUser } from '../../lib/organizations';
import { prisma } from '../../lib/prisma';

const allowedReasons = new Set(['Not a fit', 'Wrong timing', 'Already handled', 'Buyer not interested', 'Seasonal', 'Bad/missing data', 'Other']);

export async function updateOpportunity(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const { organizationId } = await requireFeatureForUser(user, 'WHOLESALE_OPPORTUNITIES');
  const id = String(formData.get('id') ?? '');
  const action = String(formData.get('action') ?? '');
  const opportunity = await prisma.salesOpportunity.findFirst({ where: { id, organizationId } });
  if (!opportunity) return { error: 'This opportunity is no longer available. Refresh the page.' };
  const now = new Date();
  const event = (data: Omit<Prisma.OpportunityEventUncheckedCreateInput, 'organizationId'>) => prisma.opportunityEvent.create({ data: { ...data, organizationId } }).catch(() => undefined);
  if (action === 'pursue') {
    const requestedAssigneeId = String(formData.get('assignedToUserId') ?? '');
    const assignee = user.role === UserRole.ADMIN || user.role === UserRole.PLATFORM_ADMIN
      ? await prisma.user.findFirst({ where: { id: requestedAssigneeId, organizationId, isActive: true, role: { notIn: [UserRole.TASTER, UserRole.PLATFORM_ADMIN] } } })
      : user;
    if (!assignee) return { error: 'Choose an active team member.' };
    await prisma.salesOpportunity.update({ where: { id }, data: { status: OpportunityStatus.ACTIONED, actionedAt: opportunity.actionedAt ?? now, assignedToUserId: assignee.id } });
    await event({ opportunityId: id, eventType: OpportunityEventType.ACTIONED, eventKey: 'ACTIONED:primary', wholesaleAccountId: opportunity.wholesaleAccountId, userId: user.id, metadata: { assignedToUserId: assignee.id }, occurredAt: now });
    await event({ opportunityId: id, eventType: OpportunityEventType.ASSIGNED, eventKey: `ASSIGNED:${assignee.id}`, wholesaleAccountId: opportunity.wholesaleAccountId, userId: user.id, metadata: { assignedToUserId: assignee.id }, occurredAt: now });
    let item = await prisma.worklistItem.findFirst({ where: { organizationId, salesOpportunityId: id, status: { in: [WorklistStatus.OPEN, WorklistStatus.IN_PROGRESS] } } });
    if (item) item = await prisma.worklistItem.update({ where: { id: item.id }, data: { assignedToUserId: assignee.id, assignedTo: getUserDisplayName(assignee) } });
    else {
      item = await prisma.worklistItem.create({ data: { organizationId, title: opportunity.recommendedAction, detail: (opportunity.explanation as string[]).join('\n'), source: WorklistSource.OPPORTUNITY_INTELLIGENCE, category: WorklistCategory.WHOLESALE, wholesaleAccountId: opportunity.wholesaleAccountId, salesOpportunityId: id, assignedToUserId: assignee.id, assignedTo: getUserDisplayName(assignee), createdByUserId: user.id, createdBy: getUserDisplayName(user), dueDate: new Date(now.getTime() + 7 * 86400000) } });
      await event({ opportunityId: id, eventType: OpportunityEventType.WORKLIST_CREATED, eventKey: `WORKLIST_CREATED:${item.id}`, wholesaleAccountId: opportunity.wholesaleAccountId, userId: user.id, worklistItemId: item.id, occurredAt: now });
    }
    scheduleWorklistSync(item.id);
  } else if (action === 'worklist') {
    let item = await prisma.worklistItem.findFirst({ where: { organizationId, salesOpportunityId: id, status: { in: [WorklistStatus.OPEN, WorklistStatus.IN_PROGRESS] } } });
    item ??= await prisma.worklistItem.create({ data: { organizationId, title: opportunity.recommendedAction, detail: (opportunity.explanation as string[]).join('\n'), source: WorklistSource.OPPORTUNITY_INTELLIGENCE, category: WorklistCategory.WHOLESALE, wholesaleAccountId: opportunity.wholesaleAccountId, salesOpportunityId: id, assignedToUserId: opportunity.assignedToUserId ?? user.id, createdByUserId: user.id, dueDate: new Date(now.getTime() + 7 * 86400000) } });
    await event({ opportunityId: id, eventType: OpportunityEventType.WORKLIST_CREATED, eventKey: `WORKLIST_CREATED:${item.id}`, wholesaleAccountId: opportunity.wholesaleAccountId, userId: user.id, worklistItemId: item.id, occurredAt: now });
  } else if (action === 'snooze') {
    const raw = String(formData.get('snoozedUntil') ?? ''); const snoozedUntil = new Date(`${raw}T12:00:00Z`);
    if (!raw || Number.isNaN(snoozedUntil.getTime()) || snoozedUntil <= now) return { error: 'Choose a future date to snooze this opportunity.' };
    await prisma.salesOpportunity.update({ where: { id }, data: { status: OpportunityStatus.SNOOZED, snoozedUntil } });
    await event({ opportunityId: id, eventType: OpportunityEventType.SNOOZED, eventKey: `SNOOZED:${snoozedUntil.toISOString()}`, wholesaleAccountId: opportunity.wholesaleAccountId, userId: user.id, metadata: { snoozedUntil }, occurredAt: now });
  } else if (action === 'dismiss') {
    const reason = String(formData.get('reason') ?? 'Other'); if (!allowedReasons.has(reason)) return { error: 'Choose a dismissal reason.' };
    await prisma.salesOpportunity.update({ where: { id }, data: { status: OpportunityStatus.DISMISSED, activeAccountKey: null, dismissedAt: now, dismissalReason: reason, resolvedAt: now } });
    await event({ opportunityId: id, eventType: OpportunityEventType.DISMISSED, eventKey: 'DISMISSED:primary', wholesaleAccountId: opportunity.wholesaleAccountId, userId: user.id, metadata: { reason }, occurredAt: now });
  } else return { error: 'Choose a supported opportunity action.' };
  revalidatePath('/opportunities'); revalidatePath('/alerts'); revalidatePath('/my-week'); revalidatePath('/'); revalidatePath(`/wholesale/${opportunity.wholesaleAccountId}`);
  return { success: action === 'snooze' ? 'Opportunity snoozed.' : action === 'dismiss' ? 'Opportunity dismissed.' : 'Follow-up saved.' };
}
