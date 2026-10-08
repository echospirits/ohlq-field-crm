'use server';

import { OpportunityEventType, WorklistStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { getUserDisplayName, requireUser } from '../../lib/auth';
import { requireOrganizationContext } from '../../lib/organizations';
import { prisma } from '../../lib/prisma';
import { parseTimeInputToMinutes } from '../../lib/dateTime';
import { scheduleWorklistSync } from '../../lib/calendar/scheduleWorklistSync';

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
