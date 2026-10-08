'use server';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import { requireUser } from '../../lib/auth';
import { requireFeatureForUser } from '../../lib/organizations';
import { prisma } from '../../lib/prisma';
import { acceptWholesaleAssessment } from '../../lib/acceptWholesaleAssessment';
import { scheduleWorklistSync } from '../../lib/calendar/scheduleWorklistSync';
import { readAssessment } from '../../lib/wholesaleAssessment';
import type { ActionResult } from '../components/ActionForm';

export async function acceptAssessment(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const { organizationId } = await requireFeatureForUser(user, 'WHOLESALE_OPPORTUNITIES');
  try {
    const accepted = await acceptWholesaleAssessment({ db: prisma, organizationId, id: String(form.get('id')), candidateKey: String(form.get('candidateKey')), actor: user, assignedToUserId: String(form.get('assignedToUserId') ?? '') });
    scheduleWorklistSync(accepted.taskId);
    revalidatePath(`/wholesale/${accepted.accountId}`); revalidatePath('/my-week');
  } catch (e) { return { error: e instanceof Prisma.PrismaClientKnownRequestError ? 'Another action changed this account. Refresh to see its existing pursuit.' : e instanceof Error ? e.message : 'Unable to accept recommendation.' }; }
  revalidatePath('/opportunities'); revalidatePath('/alerts'); revalidatePath('/wholesale');
  return { success: 'Pursuit accepted and follow-up created with this recommendation’s evidence.' };
}

export async function assessmentFeedback(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const { organizationId } = await requireFeatureForUser(user, 'WHOLESALE_OPPORTUNITIES');
  const action = String(form.get('action'));
  const row = await prisma.wholesaleAccountAssessment.findFirst({ where: { id: String(form.get('id')), organizationId } });
  if (!row) return { error: 'Assessment unavailable. Refresh the page.' };
  const until = form.get('until') ? new Date(`${form.get('until')}T23:59:59Z`) : null;
  if (action === 'snooze' && (!until || !Number.isFinite(until.getTime()) || until <= new Date())) return { error: 'Choose a future snooze date.' };
  const reason = String(form.get('reason'));
  if (action === 'dismiss' && !['Wrong evidence','Wrong product','Low upside','Timing','Strategy'].includes(reason)) return { error: 'Choose a feedback reason.' };
  if (!['dismiss','snooze','clear'].includes(action)) return { error: 'Unknown feedback action.' };
  const candidate = readAssessment(row.assessment)?.candidates[0];
  if (action === 'dismiss' && (!candidate || candidate.key !== form.get('candidateKey'))) return { error: 'Recommendation changed. Refresh before giving feedback.' };
  await prisma.wholesaleAccountAssessment.update({ where: { id: row.id }, data: action === 'dismiss' ? { dismissedKey: candidate!.key, dismissalReason: reason } : action === 'snooze' ? { snoozedUntil: until } : { dismissedKey: null, dismissalReason: null, snoozedUntil: null } });
  revalidatePath('/opportunities');
  return { success: 'Feedback saved. It does not change observed demand or train the score.' };
}
