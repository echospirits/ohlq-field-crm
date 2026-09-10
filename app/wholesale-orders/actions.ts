'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '../../lib/auth';
import { requireFeatureForUser } from '../../lib/organizations';
import { markWholesaleOrderFiledManually, markWholesaleOrderSent } from '../../lib/wholesaleOrders';

const getOrderId = (formData: FormData) => {
  const id = String(formData.get('orderId') ?? '').trim();
  if (!id || id.length > 100) throw new Error('A valid wholesale order is required.');
  return id;
};

export async function markOrderSentAction(formData: FormData) {
  const user = await requireUser();
  const { organizationId } = await requireFeatureForUser(user, 'OHIO_DIRECT_WHOLESALE_ORDERS');
  const id = getOrderId(formData);
  await markWholesaleOrderSent({ id, organizationId, actorUserId: user.id });
  revalidatePath('/wholesale-orders');
  revalidatePath(`/wholesale-orders/${id}`);
  redirect(`/wholesale-orders/${id}?status=sent`);
}

export async function markOrderFiledAction(formData: FormData) {
  const user = await requireUser();
  const { organizationId } = await requireFeatureForUser(user, 'OHIO_DIRECT_WHOLESALE_ORDERS');
  const id = getOrderId(formData);
  await markWholesaleOrderFiledManually({ id, organizationId, actorUserId: user.id });
  revalidatePath('/wholesale-orders');
  revalidatePath(`/wholesale-orders/${id}`);
  revalidatePath('/wholesale');
  redirect(`/wholesale-orders/${id}?status=filed`);
}
