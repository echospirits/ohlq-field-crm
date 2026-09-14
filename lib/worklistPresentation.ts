import { formatDateOnlyInputValue, formatEasternDateInputValue } from './dateTime';

export const worklistGroups = ['Overdue', 'Today', 'Upcoming', 'Unscheduled', 'Finished'] as const;
export type WorklistGroup = typeof worklistGroups[number];

export function getWorklistGroup(item: { dueDate: Date | null; status: string }, today = formatEasternDateInputValue()): WorklistGroup {
  if (item.status === 'COMPLETED' || item.status === 'CANCELLED') return 'Finished';
  if (!item.dueDate) return 'Unscheduled';
  const due = formatDateOnlyInputValue(item.dueDate);
  return due < today ? 'Overdue' : due === today ? 'Today' : 'Upcoming';
}
