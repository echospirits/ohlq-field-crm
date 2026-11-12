'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireSupplyActor } from '../../lib/productionSupplies/access';
import { dismissSupplyStatusCard } from '../../lib/productionSupplies/status';
import type { ActionResult } from '../components/ActionForm';

export async function dismissSupplyStatusAction(form: FormData): Promise<ActionResult> {
  const { actor } = await requireSupplyActor(true);
  try {
    await dismissSupplyStatusCard(actor, { needId: form.get('needId'), cycleKey: form.get('cycleKey') });
    revalidatePath('/production-supplies');
    return { success: 'Supply dismissed.' };
  } catch (error) {
    if (error instanceof z.ZodError) return { error: 'This supply changed. Refresh the dashboard and try again.' };
    if (error instanceof Error && error.name === 'SupplyError') return { error: error.message };
    return { error: 'Could not dismiss this supply. Try again.' };
  }
}
