import { addDaysToDateInputValue, formatEasternDateInputValue } from './dateTime';

export type SchedulerWorklistItem = {
  id: string;
  dueDate: string | null;
  dueTimeMinutes: number | null;
  status: string;
};

export type SchedulerDayItems<T extends SchedulerWorklistItem> = {
  timed: T[];
  anytime: T[];
};

export type SchedulerTimedPlacement<T extends SchedulerWorklistItem> = {
  item: T;
  lane: number;
  laneCount: number;
  overlapCount: number;
};

// Calendar events use 30 minutes by default. This is only the visual block
// used to make overlaps apparent; it does not impose a Worklist duration.
export const SCHEDULER_VISUAL_EVENT_MINUTES = 30;

export function isValidSchedulerDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function getCurrentSchedulerDate(now = new Date()) {
  return formatEasternDateInputValue(now);
}

export function addSchedulerDays(date: string, days: number) {
  return addDaysToDateInputValue(date, days);
}

export function getSchedulerWeekDates(anchorDate: string) {
  const date = new Date(`${anchorDate}T00:00:00.000Z`);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  const monday = addSchedulerDays(anchorDate, -daysSinceMonday);
  return Array.from({ length: 7 }, (_, index) => addSchedulerDays(monday, index));
}

export function getSchedulerWeekStart(anchorDate: string) {
  return getSchedulerWeekDates(anchorDate)[0];
}

export function getSchedulerDayItems<T extends SchedulerWorklistItem>(
  items: T[],
  date: string,
): SchedulerDayItems<T> {
  const activeItems = items.filter((item) => item.status === 'OPEN' || item.status === 'IN_PROGRESS');
  return {
    timed: activeItems
      .filter((item) => item.dueDate === date && item.dueTimeMinutes !== null)
      .sort((left, right) => left.dueTimeMinutes! - right.dueTimeMinutes! || left.id.localeCompare(right.id)),
    anytime: activeItems
      .filter((item) => item.dueDate === date && item.dueTimeMinutes === null)
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function getSchedulerTimedPlacements<T extends SchedulerWorklistItem>(items: T[], date: string): SchedulerTimedPlacement<T>[] {
  const timed = getSchedulerDayItems(items, date).timed;
  const groups: T[][] = [];
  let groupEnd = -1;

  for (const item of timed) {
    const start = item.dueTimeMinutes!;
    const end = start + SCHEDULER_VISUAL_EVENT_MINUTES;
    if (!groups.length || start >= groupEnd) {
      groups.push([item]);
      groupEnd = end;
    } else {
      groups[groups.length - 1].push(item);
      groupEnd = Math.max(groupEnd, end);
    }
  }

  return groups.flatMap((group) => {
    const laneEnds: number[] = [];
    const placements = group.map((item) => {
      const start = item.dueTimeMinutes!;
      const end = start + SCHEDULER_VISUAL_EVENT_MINUTES;
      let lane = laneEnds.findIndex((previousEnd) => previousEnd <= start);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = end;
      const overlapCount = group.filter((candidate) => {
        const candidateStart = candidate.dueTimeMinutes!;
        const candidateEnd = candidateStart + SCHEDULER_VISUAL_EVENT_MINUTES;
        return candidateStart < end && candidateEnd > start;
      }).length;
      return { item, lane, overlapCount };
    });
    return placements.map(({ item, lane, overlapCount }) => ({ item, lane, laneCount: laneEnds.length, overlapCount }));
  });
}

export function getSchedulerPlanningTray<T extends SchedulerWorklistItem>(items: T[], weekStart: string) {
  return items
    .filter((item) =>
      (item.status === 'OPEN' || item.status === 'IN_PROGRESS') &&
      (item.dueDate === null || item.dueDate < weekStart),
    )
    .sort((left, right) => {
      if (left.dueDate === null) return right.dueDate === null ? left.id.localeCompare(right.id) : 1;
      if (right.dueDate === null) return -1;
      return left.dueDate.localeCompare(right.dueDate) || left.id.localeCompare(right.id);
    });
}
