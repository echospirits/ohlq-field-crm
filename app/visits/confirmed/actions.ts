'use server';

import { updateWorklistStatus } from '../../alerts/actions';
import type { VisitRelatedWorkResult } from '../../../lib/visitRelatedWork';
import { z } from 'zod';

const completionRequest = z.object({
  visitId: z.string().trim().min(1).max(256),
  ids: z.array(z.string().trim().min(1).max(256)).min(1),
});

// The normal Worklist action owns authentication, account/assignment checks,
// completion history, calendar synchronization and cache revalidation.
export async function completeVisitRelatedWork(formData: FormData): Promise<VisitRelatedWorkResult> {
  const parsed = completionRequest.safeParse({ visitId: formData.get('visitId'), ids: formData.getAll('worklistItemId') });
  if (!parsed.success) return { completedIds: [], error: 'Choose related work to complete.' };
  const { visitId } = parsed.data;
  const ids = [...new Set(parsed.data.ids)];
  const completedIds: string[] = [];
  for (const id of ids) {
    const request = new FormData();
    request.set('id', id);
    request.set('status', 'COMPLETED');
    request.set('visitId', visitId);
    const result = await updateWorklistStatus(request);
    if ('error' in result) return { completedIds, error: result.error };
    completedIds.push(id);
  }
  return { completedIds };
}
