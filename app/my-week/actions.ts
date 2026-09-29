'use server';

import { OpportunityEventType, WorklistCategory, WorklistSource, WorklistStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { getUserDisplayName, requireUser } from '../../lib/auth';
import { isValidZonedDateTime, parseTimeInputToMinutes } from '../../lib/dateTime';
import { scheduleWorklistSync } from '../../lib/calendar/scheduleWorklistSync';
import { requireOrganizationContext } from '../../lib/organizations';
import { prisma } from '../../lib/prisma';
import { getWorklistCategoryForLocationSelection } from '../../lib/worklistLocations';

export type SchedulerActionResult = { error: string; refresh?: boolean } | { success: string };
type SchedulerAssignee = { id: string; email: string; firstName: string | null; lastName: string | null; name: string | null };

const activeStatuses = [WorklistStatus.OPEN, WorklistStatus.IN_PROGRESS];
const staleTaskError = 'This task changed or is no longer active. Refresh the schedule before trying again.';
const submissionKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const toOptional = (value: FormDataEntryValue | null | undefined) => {
  const text = String(value ?? '').trim();
  return text || null;
};

const parseDateOnly = (value: FormDataEntryValue | null | undefined) => {
  const text = toOptional(value);
  if (!text) return { date: null, dateInput: null, error: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { date: null, dateInput: null, error: 'Choose a valid date.' };
  const date = new Date(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    return { date: null, dateInput: null, error: 'Choose a valid date.' };
  }
  return { date, dateInput: text, error: null };
};

const parseExpectedUpdatedAt = (value: FormDataEntryValue | null | undefined) => {
  const text = toOptional(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) && date.toISOString() === text ? date : null;
};

const parseDueTime = (value: FormDataEntryValue | null | undefined, dateInput: string | null) => {
  const text = toOptional(value);
  if (!text) return { minutes: null, error: null };
  if (!dateInput) return { minutes: null, error: 'Choose a date before adding a time.' };
  const minutes = parseTimeInputToMinutes(text);
  if (minutes === null) return { minutes: null, error: 'Enter a valid time.' };
  if (!isValidZonedDateTime(dateInput, minutes)) {
    return { minutes: null, error: 'That time does not exist on this date because clocks change. Choose another time.' };
  }
  return { minutes, error: null };
};

const isUniqueConstraintError = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';

const revalidateScheduler = () => {
  revalidatePath('/');
  revalidatePath('/my-week');
  revalidatePath('/alerts');
};

export async function updateSchedulerWorklistItem(formData: FormData): Promise<SchedulerActionResult> {
  const currentUser = await requireUser();
  const { organizationId } = await requireOrganizationContext(currentUser);
  const id = toOptional(formData.get('id'));
  if (!id) return { error: 'This task is missing. Refresh the schedule.' };

  const expectedUpdatedAt = parseExpectedUpdatedAt(formData.get('expectedUpdatedAt'));
  if (!expectedUpdatedAt) return { error: staleTaskError, refresh: true };

  const parsedDate = parseDateOnly(formData.get('dueDate'));
  if (parsedDate.error) return { error: parsedDate.error };
  const parsedTime = parseDueTime(formData.get('dueTime'), parsedDate.dateInput);
  if (parsedTime.error) return { error: parsedTime.error };

  const changesAssignment = formData.has('assignedToUserId');
  let assignedUser: SchedulerAssignee | null = null;
  if (changesAssignment) {
    const assignedToUserId = toOptional(formData.get('assignedToUserId'));
    assignedUser = assignedToUserId
      ? await prisma.user.findFirst({
          where: { id: assignedToUserId, organizationId, isActive: true, role: { notIn: ['TASTER', 'PLATFORM_ADMIN'] } },
          select: { id: true, email: true, firstName: true, lastName: true, name: true },
        })
      : null;
    if (assignedToUserId && !assignedUser) return { error: 'Choose an active team member or Unassigned.' };
  }

  const data: {
    dueDate: Date | null;
    dueTimeMinutes: number | null;
    assignedToUserId?: string | null;
    assignedTo?: string | null;
  } = { dueDate: parsedDate.date, dueTimeMinutes: parsedDate.date ? parsedTime.minutes : null };
  if (changesAssignment) {
    data.assignedToUserId = assignedUser?.id ?? null;
    data.assignedTo = assignedUser ? getUserDisplayName(assignedUser) : null;
  }

  const saved = await prisma.$transaction(async (transaction) => {
    const owned = await transaction.worklistItem.findFirst({
      where: { id, organizationId, status: { in: activeStatuses }, updatedAt: expectedUpdatedAt },
      select: { id: true, assignedToUserId: true, salesOpportunityId: true, wholesaleAccountId: true },
    });
    if (!owned) return false;

    const result = await transaction.worklistItem.updateMany({
      where: { id: owned.id, organizationId, status: { in: activeStatuses }, updatedAt: expectedUpdatedAt },
      data,
    });
    if (result.count !== 1) return false;

    const nextAssigneeId = assignedUser?.id ?? null;
    if (changesAssignment && owned.salesOpportunityId && owned.wholesaleAccountId && owned.assignedToUserId !== nextAssigneeId) {
      const occurredAt = new Date();
      await transaction.opportunityEvent.create({
        data: {
          organizationId,
          opportunityId: owned.salesOpportunityId,
          eventType: OpportunityEventType.TASK_REASSIGNED,
          eventKey: `TASK_REASSIGNED:${id}:${nextAssigneeId ?? 'unassigned'}:${occurredAt.getTime()}`,
          wholesaleAccountId: owned.wholesaleAccountId,
          userId: currentUser.id,
          worklistItemId: id,
          metadata: { assignedToUserId: nextAssigneeId },
          occurredAt,
        },
      });
    }
    return true;
  });
  if (!saved) return { error: staleTaskError, refresh: true };

  scheduleWorklistSync(id);
  revalidateScheduler();
  return { success: 'Worklist schedule saved.' };
}

export async function completeSchedulerWorklistItem(formData: FormData): Promise<SchedulerActionResult> {
  const currentUser = await requireUser();
  const { organizationId } = await requireOrganizationContext(currentUser);
  const id = toOptional(formData.get('id'));
  if (!id) return { error: 'This task is missing. Refresh the schedule.' };
  const expectedUpdatedAt = parseExpectedUpdatedAt(formData.get('expectedUpdatedAt'));
  if (!expectedUpdatedAt) return { error: staleTaskError, refresh: true };

  const result = await prisma.worklistItem.updateMany({
    where: { id, organizationId, status: { in: activeStatuses }, updatedAt: expectedUpdatedAt },
    data: {
      status: WorklistStatus.COMPLETED,
      completedAt: new Date(),
      completedByUserId: currentUser.id,
    },
  });
  if (result.count !== 1) return { error: staleTaskError, refresh: true };

  scheduleWorklistSync(id);
  revalidateScheduler();
  return { success: 'Task completed.' };
}

export async function createSchedulerWorklistItem(formData: FormData): Promise<SchedulerActionResult> {
  const currentUser = await requireUser();
  const { organizationId } = await requireOrganizationContext(currentUser);
  const submissionKey = toOptional(formData.get('submissionKey'));
  if (!submissionKey || !submissionKeyPattern.test(submissionKey)) {
    return { error: 'Refresh the schedule and try creating this task again.' };
  }

  const submissionWhere = { organizationId_submissionKey: { organizationId, submissionKey } };
  const existing = await prisma.worklistItem.findUnique({ where: submissionWhere, select: { id: true } });
  if (existing) return { success: 'Worklist task already created.' };

  const title = toOptional(formData.get('title'));
  if (!title) return { error: 'Enter a task title.' };

  const requestedCategory = String(formData.get('category') ?? WorklistCategory.GENERAL);
  if (!Object.values(WorklistCategory).includes(requestedCategory as WorklistCategory)) {
    return { error: 'Choose a valid task category.' };
  }
  const agencyId = toOptional(formData.get('agencyId'));
  const wholesaleAccountId = toOptional(formData.get('wholesaleAccountId'));
  if (agencyId && wholesaleAccountId) return { error: 'Choose one account for this task.' };
  if (agencyId && !await prisma.agency.findUnique({ where: { id: agencyId }, select: { id: true } })) {
    return { error: 'That agency is no longer available. Search and choose it again.' };
  }
  if (wholesaleAccountId && !await prisma.wholesaleAccount.findFirst({
    where: { id: wholesaleAccountId, isActive: true, mergedIntoId: null },
    select: { id: true },
  })) {
    return { error: 'That wholesale account is no longer available. Search and choose it again.' };
  }

  const category = getWorklistCategoryForLocationSelection(
    requestedCategory as WorklistCategory,
    agencyId,
    wholesaleAccountId,
  );
  if (agencyId && category !== WorklistCategory.AGENCY) return { error: 'Choose the Agency category for this account.' };
  if (wholesaleAccountId && category !== WorklistCategory.WHOLESALE) return { error: 'Choose the Wholesale category for this account.' };
  if (category === WorklistCategory.AGENCY && !agencyId) return { error: 'Choose an agency for this task.' };
  if (category === WorklistCategory.WHOLESALE && !wholesaleAccountId) return { error: 'Choose a wholesale account for this task.' };

  const parsedDate = parseDateOnly(formData.get('dueDate'));
  if (parsedDate.error) return { error: parsedDate.error };
  const parsedTime = parseDueTime(formData.get('dueTime'), parsedDate.dateInput);
  if (parsedTime.error) return { error: parsedTime.error };

  const assignedToUserId = formData.has('assignedToUserId')
    ? toOptional(formData.get('assignedToUserId'))
    : currentUser.id;
  const assignedUser = assignedToUserId
    ? await prisma.user.findFirst({
        where: { id: assignedToUserId, organizationId, isActive: true, role: { notIn: ['TASTER', 'PLATFORM_ADMIN'] } },
        select: { id: true, email: true, firstName: true, lastName: true, name: true },
      })
    : null;
  if (assignedToUserId && !assignedUser) return { error: 'Choose an active team member or Unassigned.' };

  let item: { id: string };
  try {
    item = await prisma.worklistItem.create({
      data: {
        organizationId,
        title,
        detail: toOptional(formData.get('detail')),
        status: WorklistStatus.OPEN,
        source: WorklistSource.MANUAL,
        category,
        agencyId: category === WorklistCategory.AGENCY ? agencyId : null,
        wholesaleAccountId: category === WorklistCategory.WHOLESALE ? wholesaleAccountId : null,
        submissionKey,
        dueDate: parsedDate.date,
        dueTimeMinutes: parsedDate.date ? parsedTime.minutes : null,
        assignedToUserId: assignedUser?.id ?? null,
        assignedTo: assignedUser ? getUserDisplayName(assignedUser) : null,
        createdByUserId: currentUser.id,
        createdBy: getUserDisplayName(currentUser),
      },
      select: { id: true },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const duplicate = await prisma.worklistItem.findUnique({ where: submissionWhere, select: { id: true } });
      if (duplicate) return { success: 'Worklist task already created.' };
    }
    throw error;
  }
  scheduleWorklistSync(item.id);
  revalidateScheduler();
  return { success: 'Worklist task created.' };
}
