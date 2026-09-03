'use server';

import { OpportunityStatus, WorklistCategory, WorklistSource, WorklistStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { requireUser } from '../../lib/auth';
import { prisma } from '../../lib/prisma';
import { requireOrganizationContext } from '../../lib/organizations';

const getId = (formData: FormData) => String(formData.get('id') ?? '').trim();

export async function updateAgencyOpportunity(formData: FormData) {
  const user = await requireUser();
  const { organizationId } = await requireOrganizationContext(user);
  const id = getId(formData);
  const action = String(formData.get('action') ?? '');
  const opportunity = await prisma.agencyProductIntelligence.findUnique({
    where: { id },
    include: { agency: { select: { id: true, name: true } } },
  });
  if (!opportunity || opportunity.organizationId !== organizationId) return;
  const now = new Date();

  if (action === 'worklist') {
    const reasons = Array.isArray(opportunity.reasons) ? opportunity.reasons.map(String) : [];
    const existing = await prisma.worklistItem.findFirst({
      where: {
        agencyProductIntelligenceId: opportunity.id,
        organizationId,
        status: { in: [WorklistStatus.OPEN, WorklistStatus.IN_PROGRESS] },
      },
    });
    if (!existing) {
      await prisma.worklistItem.create({
        data: {
          agencyId: opportunity.agency.id,
          organizationId,
          agencyProductIntelligenceId: opportunity.id,
          assignedToUserId: user.id,
          category: WorklistCategory.AGENCY,
          createdBy: user.name || user.email,
          createdByUserId: user.id,
          detail: reasons.join('\n'),
          dueDate: new Date(now.getTime() + 7 * 86_400_000),
          source: WorklistSource.AGENCY_INTELLIGENCE,
          status: WorklistStatus.OPEN,
          title: `${opportunity.recommendedAction.toLowerCase().replaceAll('_', ' ')} ${opportunity.itemName}`,
        },
      });
    }
    await prisma.agencyProductIntelligence.update({ where: { id }, data: { status: OpportunityStatus.ACTIONED } });
  }

  if (action === 'snooze') {
    await prisma.agencyProductIntelligence.update({
      where: { id },
      data: { status: OpportunityStatus.SNOOZED, snoozedUntil: new Date(now.getTime() + 14 * 86_400_000) },
    });
  }

  if (action === 'dismiss') {
    const reason = String(formData.get('reason') ?? 'Not useful').slice(0, 200);
    await prisma.agencyProductIntelligence.update({
      where: { id },
      data: { status: OpportunityStatus.DISMISSED, dismissedAt: now, dismissalReason: reason, snoozedUntil: null },
    });
  }

  if (['worklist', 'snooze', 'dismiss'].includes(action)) {
    await prisma.agencyIntelligenceEvent.create({
      data: {
        agencyId: opportunity.agency.id,
        organizationId,
        agencyProductIntelligenceId: opportunity.id,
        eventKey: `${opportunity.id}:USER_${action.toUpperCase()}:${now.toISOString()}`,
        eventType: `USER_${action.toUpperCase()}`,
        inventoryState: opportunity.inventoryState,
        itemCode: opportunity.itemCode,
        opportunityState: opportunity.opportunityState,
        occurredAt: now,
        snapshot: { actorUserId: user.id, action },
      },
    });
  }

  revalidatePath('/agency-focus');
  revalidatePath(`/agencies/${opportunity.agency.id}`);
  revalidatePath('/alerts');
  revalidatePath('/my-week');
}
