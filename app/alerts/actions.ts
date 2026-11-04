'use server';

import { OpportunityEventType, WorklistStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { getUserDisplayName, requireUser } from '../../lib/auth';
import { requireOrganizationContext } from '../../lib/organizations';
import { prisma } from '../../lib/prisma';
import { parseTimeInputToMinutes } from '../../lib/dateTime';
import { scheduleWorklistSync } from '../../lib/calendar/scheduleWorklistSync';
import { getVisitRelatedWorkWhere, getVisitWorkAccountWhere } from '../../lib/visitRelatedWork';

const toOptional = (value: FormDataEntryValue | null) => String(value ?? '').trim() || null;
const toDate = (value: FormDataEntryValue | null) => {
  const date = toOptional(value);
  return date ? new Date(`${date}T00:00:00`) : null;
};
const toWorklistStatus = (value: FormDataEntryValue | null) => String(value ?? WorklistStatus.OPEN) as WorklistStatus;

export async function updateWorklistStatus(formData: FormData) {
  'use server';

  const currentUser = await requireUser();
  const { organizationId } = await requireOrganizationContext(currentUser);
  const id = toOptional(formData.get('id'));
  const status = toWorklistStatus(formData.get('status'));
  if (status !== WorklistStatus.COMPLETED && status !== WorklistStatus.CANCELLED) return { error: 'Choose Complete or Cancel task.' };

  if (!id) return { error: 'This task is missing. Refresh the worklist.' };

  const visitId = toOptional(formData.get('visitId'));
  if (visitId) {
    if (status !== WorklistStatus.COMPLETED) return { error: 'Choose a task to complete.' };
    const visit = await prisma.loggedVisit.findFirst({
      where: { id: visitId, organizationId, createdByUserId: currentUser.id },
      select: { id: true, locationType: true, agencyId: true, wholesaleAccountId: true, originatingWorklistItemId: true },
    });
    if (!visit) return { error: 'This visit is no longer available. Refresh and try again.' };
    const where = { ...getVisitRelatedWorkWhere(organizationId, currentUser.id, visit), id };
    const saved = await prisma.$transaction(async (tx) => {
      const wasCompletedHere = async () => Boolean(await tx.worklistItem.findFirst({
        where: { id, organizationId, AND: [getVisitWorkAccountWhere(visit)], status: WorklistStatus.COMPLETED, completedByUserId: currentUser.id, loggedVisitId: visit.id },
        select: { id: true },
      }));
      const item = await tx.worklistItem.findFirst({ where, select: { id: true, salesOpportunityId: true, wholesaleAccountId: true } });
      if (!item) return await wasCompletedHere() ? 'already-completed' : null;
      const now = new Date();
      const result = await tx.worklistItem.updateMany({
        where,
        data: { status, completedAt: now, completedByUserId: currentUser.id, cancelledAt: null, cancelledByUserId: null, loggedVisitId: visit.id },
      });
      if (result.count !== 1) return await wasCompletedHere() ? 'already-completed' : null;
      if (item.salesOpportunityId && item.wholesaleAccountId) {
        await tx.opportunityEvent.create({ data: {
          organizationId, opportunityId: item.salesOpportunityId, eventType: OpportunityEventType.TASK_COMPLETED,
          eventKey: `TASK_COMPLETED_AFTER_VISIT:${visit.id}:${item.id}`, wholesaleAccountId: item.wholesaleAccountId,
          userId: currentUser.id, loggedVisitId: visit.id, worklistItemId: item.id, occurredAt: now,
        } });
      }
      return 'completed';
    });
    if (!saved) return { error: 'This task changed or is no longer available. Refresh the worklist.' };
    // A lost response can replay complete-all after earlier items committed.
    // Acknowledge only this actor's completion at this exact Visit/account.
    if (saved === 'already-completed') return { success: 'Task completed.' };
  } else {
    const owned = await prisma.worklistItem.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!owned) return { error: 'This task is no longer available. Refresh the worklist.' };
    await prisma.worklistItem.update({
      where: { id: owned.id },
      data: {
        status,
        completedAt: status === WorklistStatus.COMPLETED ? new Date() : null,
        cancelledAt: status === WorklistStatus.CANCELLED ? new Date() : null,
        completedByUserId: status === WorklistStatus.COMPLETED ? currentUser.id : null,
        cancelledByUserId: status === WorklistStatus.CANCELLED ? currentUser.id : null,
      },
    });
  }
  scheduleWorklistSync(id);
  // Statewide opportunity recalculation belongs to the import/scheduled pipeline.

  revalidatePath('/agencies/[id]', 'page');
  revalidatePath('/wholesale/[id]', 'page');
  revalidatePath('/alerts');
  revalidatePath('/my-week');
  revalidatePath('/');
  return { success: status === WorklistStatus.COMPLETED ? 'Task completed.' : 'Task cancelled.' };
}

export async function updateWorklistItem(formData: FormData) {
  'use server';
  const currentUser = await requireUser();
  const { organizationId } = await requireOrganizationContext(currentUser);
  const id = toOptional(formData.get('id'));
  const title = toOptional(formData.get('title'));
  const assignedToUserId = toOptional(formData.get('assignedToUserId'));
  const dueDate = toDate(formData.get('dueDate'));
  if (!id || !title) return { error: 'Enter a task title before saving.' };
  const assignedUser = assignedToUserId
    ? await prisma.user.findFirst({ where: { id: assignedToUserId, organizationId, isActive: true, role: { notIn: ['TASTER', 'PLATFORM_ADMIN'] } } })
    : null;
  if (assignedToUserId && !assignedUser) return { error: 'Choose an active team member or Unassigned.' };
  const previous = await prisma.worklistItem.findFirst({ where: { id, organizationId }, select: { assignedToUserId: true, salesOpportunityId: true, wholesaleAccountId: true } });
  if (!previous) return { error: 'This task is no longer available. Refresh the worklist.' };
  await prisma.worklistItem.update({
    where: { id },
    data: {
      title,
      detail: toOptional(formData.get('detail')),
      dueDate,
      dueTimeMinutes: dueDate ? parseTimeInputToMinutes(formData.get('dueTime')) : null,
      assignedToUserId: assignedUser?.id ?? null,
      assignedTo: assignedUser ? getUserDisplayName(assignedUser) : null,
    },
  });
  if (previous.salesOpportunityId && previous.wholesaleAccountId && previous.assignedToUserId !== (assignedUser?.id ?? null)) {
    await prisma.opportunityEvent.create({ data: { organizationId, opportunityId: previous.salesOpportunityId, eventType: OpportunityEventType.TASK_REASSIGNED, eventKey: `TASK_REASSIGNED:${id}:${assignedUser?.id ?? 'unassigned'}:${Date.now()}`, wholesaleAccountId: previous.wholesaleAccountId, userId: currentUser.id, worklistItemId: id, metadata: { assignedToUserId: assignedUser?.id ?? null }, occurredAt: new Date() } });
  }
  scheduleWorklistSync(id);
  revalidatePath('/agencies/[id]', 'page');
  revalidatePath('/wholesale/[id]', 'page');
  revalidatePath('/alerts');
  revalidatePath('/my-week');
  revalidatePath('/');
  return { success: 'Task saved.' };
}
