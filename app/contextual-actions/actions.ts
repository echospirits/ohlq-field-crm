'use server';

import { OpportunityEventType, OpportunityStatus, UserRole, WorklistCategory, WorklistSource, WorklistStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { getUserDisplayName, requireUser } from '../../lib/auth';
import { syncWorklistItemCalendar } from '../../lib/calendar/worklistSync';
import { normalizeCRMActionContext } from '../../lib/crmActionContext';
import { parseTimeInputToMinutes } from '../../lib/dateTime';
import { prisma } from '../../lib/prisma';

export type ContextualActionResult = { ok: boolean; message: string };

const optional = (value: FormDataEntryValue | null) => String(value ?? '').trim() || null;
const dateOnly = (value: FormDataEntryValue | null) => {
  const raw = optional(value);
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T12:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export async function createContextualFollowUp(formData: FormData): Promise<ContextualActionResult> {
  const user = await requireUser();
  const context = normalizeCRMActionContext({
    agencyId: optional(formData.get('agencyId')),
    wholesaleAccountId: optional(formData.get('wholesaleAccountId')),
    opportunityId: optional(formData.get('opportunityId')),
    agencyProductIntelligenceId: optional(formData.get('agencyProductIntelligenceId')),
    productItemCode: optional(formData.get('productItemCode')),
    productName: optional(formData.get('productName')),
    sourceType: optional(formData.get('sourceType')),
    sourceLabel: optional(formData.get('sourceLabel')),
    reason: optional(formData.get('reason')),
    returnTo: optional(formData.get('returnTo')),
  });
  const title = optional(formData.get('title'))?.slice(0, 200);
  const submissionKey = optional(formData.get('submissionKey'));
  if (!title || !submissionKey || (!context.agencyId && !context.wholesaleAccountId)) {
    return { ok: false, message: 'The account, title, and request key are required.' };
  }

  const [agency, wholesale, opportunity, agencyIntelligence] = await Promise.all([
    context.agencyId ? prisma.agency.findUnique({ where: { id: context.agencyId }, select: { id: true } }) : null,
    context.wholesaleAccountId ? prisma.wholesaleAccount.findFirst({ where: { id: context.wholesaleAccountId, mergedIntoId: null }, select: { id: true } }) : null,
    context.opportunityId ? prisma.salesOpportunity.findUnique({ where: { id: context.opportunityId }, select: { id: true, wholesaleAccountId: true } }) : null,
    context.agencyProductIntelligenceId ? prisma.agencyProductIntelligence.findUnique({ where: { id: context.agencyProductIntelligenceId }, select: { id: true, agencyId: true, inventoryState: true, itemCode: true, opportunityState: true } }) : null,
  ]);
  if ((context.agencyId && !agency) || (context.wholesaleAccountId && !wholesale)) return { ok: false, message: 'The selected account is no longer available.' };
  if ((context.opportunityId && opportunity?.wholesaleAccountId !== context.wholesaleAccountId) || (context.agencyProductIntelligenceId && agencyIntelligence?.agencyId !== context.agencyId)) {
    return { ok: false, message: 'The originating context does not match this account.' };
  }

  const requestedAssigneeId = optional(formData.get('assignedToUserId')) ?? user.id;
  const assignee = await prisma.user.findFirst({ where: { id: requestedAssigneeId, isActive: true, role: { not: UserRole.TASTER } } });
  if (!assignee) return { ok: false, message: 'Choose an active CRM user.' };
  const dueDate = dateOnly(formData.get('dueDate'));
  const dueTimeMinutes = dueDate ? parseTimeInputToMinutes(formData.get('dueTime')) : null;
  const note = optional(formData.get('note'));
  const detail = [context.reason, context.productItemCode || context.productName ? `Product: ${[context.productItemCode, context.productName].filter(Boolean).join(' - ')}` : null, note].filter(Boolean).join('\n\n') || null;

  const existing = await prisma.worklistItem.findUnique({ where: { submissionKey }, select: { id: true } });
  if (existing) return { ok: true, message: 'Follow-up already created.' };

  let item: { id: string };
  try {
    item = await prisma.worklistItem.create({
      data: {
      title,
      detail,
      status: WorklistStatus.OPEN,
      source: context.opportunityId ? WorklistSource.OPPORTUNITY_INTELLIGENCE : context.agencyProductIntelligenceId ? WorklistSource.AGENCY_INTELLIGENCE : WorklistSource.MANUAL,
      category: context.agencyId ? WorklistCategory.AGENCY : WorklistCategory.WHOLESALE,
      agencyId: context.agencyId,
      wholesaleAccountId: context.wholesaleAccountId,
      salesOpportunityId: context.opportunityId,
      agencyProductIntelligenceId: context.agencyProductIntelligenceId,
      submissionKey,
      dueDate,
      dueTimeMinutes,
      assignedToUserId: assignee.id,
      assignedTo: getUserDisplayName(assignee),
      createdByUserId: user.id,
      createdBy: getUserDisplayName(user),
      },
      select: { id: true },
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      return { ok: true, message: 'Follow-up already created.' };
    }
    throw error;
  }
  await syncWorklistItemCalendar(item.id);

  if (opportunity) {
    const now = new Date();
    await prisma.$transaction([
      prisma.salesOpportunity.update({ where: { id: opportunity.id }, data: { status: OpportunityStatus.ACTIONED, actionedAt: now, assignedToUserId: assignee.id } }),
      prisma.opportunityEvent.create({ data: { opportunityId: opportunity.id, eventType: OpportunityEventType.WORKLIST_CREATED, eventKey: `WORKLIST_CREATED:${item.id}`, wholesaleAccountId: opportunity.wholesaleAccountId, userId: user.id, worklistItemId: item.id, metadata: { assignedToUserId: assignee.id, sourceType: context.sourceType }, occurredAt: now } }),
    ]);
  }
  if (agencyIntelligence) {
    const now = new Date();
    await prisma.$transaction([
      prisma.agencyProductIntelligence.update({ where: { id: agencyIntelligence.id }, data: { status: OpportunityStatus.ACTIONED } }),
      prisma.agencyIntelligenceEvent.create({ data: { agencyId: agencyIntelligence.agencyId, agencyProductIntelligenceId: agencyIntelligence.id, eventKey: `${agencyIntelligence.id}:WORKLIST_CREATED:${item.id}`, eventType: 'WORKLIST_CREATED', inventoryState: agencyIntelligence.inventoryState, itemCode: agencyIntelligence.itemCode, opportunityState: agencyIntelligence.opportunityState, occurredAt: now, snapshot: { actorUserId: user.id, worklistItemId: item.id } } }),
    ]);
  }

  for (const path of ['/alerts', '/my-week', '/', context.returnTo].filter(Boolean) as string[]) revalidatePath(path);
  if (context.agencyId) revalidatePath(`/agencies/${context.agencyId}`);
  if (context.wholesaleAccountId) revalidatePath(`/wholesale/${context.wholesaleAccountId}`);
  revalidatePath('/opportunities');
  revalidatePath('/agency-focus');
  return { ok: true, message: 'Follow-up created.' };
}
