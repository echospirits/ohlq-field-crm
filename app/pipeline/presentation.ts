import { formatDateOnly } from '../../lib/dateTime';
import { getWorklistOverdueLabel } from '../../lib/worklistPresentation';

type OpenCommitment = {
  agencyId: string | null;
  wholesaleAccountId: string | null;
  title: string;
  dueDate: Date | null;
};

/** Receives already-authorized open Worklist rows; dates precede unscheduled work. */
export function selectPipelineCommitments<T extends OpenCommitment>(items: readonly T[]): Map<string, T> {
  const selected = new Map<string, T>();
  for (const item of items) {
    const key = item.agencyId ? `AGENCY:${item.agencyId}` : item.wholesaleAccountId ? `WHOLESALE:${item.wholesaleAccountId}` : null;
    if (!key) continue;
    const previous = selected.get(key);
    if (!previous || (item.dueDate && (!previous.dueDate || item.dueDate < previous.dueDate))) selected.set(key, item);
  }
  return selected;
}

export function pipelineCommitmentDue(dueDate: Date | null, now = new Date()): { date: string; overdue: string | null } {
  return { date: dueDate ? formatDateOnly(dueDate) : 'Unscheduled', overdue: getWorklistOverdueLabel(dueDate, 'OPEN', now) };
}
