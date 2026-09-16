'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '../../lib/auth';
import { requireFeatureForUser } from '../../lib/organizations';
import { setWholesaleOrderChecklist } from '../../lib/wholesaleOrders';

const getOrderId = (formData: FormData) => {
  const id = String(formData.get('orderId') ?? '').trim();
  if (!id || id.length > 100) throw new Error('A valid wholesale order is required.');
  return id;
};

export async function toggleOrderChecklistAction(formData: FormData) {
  const user = await requireUser();
  const { organizationId } = await requireFeatureForUser(user, 'OHIO_DIRECT_WHOLESALE_ORDERS');
  const id = getOrderId(formData);
  const field = String(formData.get('field') ?? '');
  if (field !== 'sent' && field !== 'paid' && field !== 'filed') throw new Error('A valid checklist item is required.');
  const checked = formData.get('checked') === 'true';
  await setWholesaleOrderChecklist({ id, organizationId, actorUserId: user.id, field, checked });
  revalidatePath('/wholesale-orders');
  revalidatePath(`/wholesale-orders/${id}`);
  revalidatePath('/wholesale');
  const returnTo = String(formData.get('returnTo') ?? '');
  redirect(returnTo === 'detail' ? `/wholesale-orders/${id}?status=updated` : '/wholesale-orders?status=updated');
}

export async function markOrderSentAction(formData: FormData) { formData.set('field', 'sent'); formData.set('checked', 'true'); return toggleOrderChecklistAction(formData); }
export async function markOrderFiledAction(formData: FormData) { formData.set('field', 'filed'); formData.set('checked', 'true'); return toggleOrderChecklistAction(formData); }
