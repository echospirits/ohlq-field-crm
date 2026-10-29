import { formatDateOnlyInputValue, formatEasternDateInputValue } from './dateTime';

export const worklistGroups = ['Overdue', 'Today', 'Upcoming', 'Unscheduled', 'Finished'] as const;
export type WorklistGroup = typeof worklistGroups[number];

export function getWorklistGroup(item: { dueDate: Date | null; status: string }, today = formatEasternDateInputValue()): WorklistGroup {
  if (item.status === 'COMPLETED' || item.status === 'CANCELLED') return 'Finished';
  if (!item.dueDate) return 'Unscheduled';
  const due = formatDateOnlyInputValue(item.dueDate);
  return due < today ? 'Overdue' : due === today ? 'Today' : 'Upcoming';
}

/** Due dates are UTC date-only values; today follows Neat's Eastern day. */
export function getWorklistOverdueLabel(dueDate: Date | null, status: string, now = new Date()): string | null {
  if (!dueDate || !['OPEN', 'IN_PROGRESS'].includes(status)) return null;
  const today = formatEasternDateInputValue(now);
  const due = formatDateOnlyInputValue(dueDate);
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);
  return days > 0 ? `${days} day${days === 1 ? '' : 's'} overdue` : null;
}
