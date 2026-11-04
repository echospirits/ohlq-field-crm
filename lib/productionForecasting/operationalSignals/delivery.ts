import type { DeliveryBaseline, DeliveryHistoryObservation, OperatingCalendar } from './types';

const DAY_MS = 86_400_000;
const MINIMUM_BASELINE_DAYS = 14;

function validDate(value: Date) {
  if (!Number.isFinite(value.getTime())) throw new Error('Invalid observation timestamp.');
  return value;
}

export function validCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

/** Local calendar dates avoid elapsed 24-hour DST arithmetic. */
export function dateInTimezone(value: string | Date, timezone: string): string {
  const date = validDate(value instanceof Date ? value : new Date(value));
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function calendarLeadDays(observedAt: string | Date, earliestAt: string | Date, timezone: string): number {
  const observed = validDate(observedAt instanceof Date ? observedAt : new Date(observedAt));
  const earliest = validDate(earliestAt instanceof Date ? earliestAt : new Date(earliestAt));
  if (earliest < observed) throw new Error('Appointment precedes observation.');
  return Math.round((Date.parse(dateInTimezone(earliest, timezone)) - Date.parse(dateInTimezone(observed, timezone))) / DAY_MS);
}

/** Null means no complete source calendar is available, rather than guessed weekdays. */
export function businessLeadDays(observedAt: string | Date, earliestAt: string | Date, timezone: string, calendar?: OperatingCalendar): number | null {
  const calendarDays = calendarLeadDays(observedAt, earliestAt, timezone);
  if (!calendar || !validCalendarDate(calendar.coveredFrom) || !validCalendarDate(calendar.coveredThrough)
    || calendar.coveredFrom > calendar.coveredThrough || !calendar.openWeekdays.length
    || calendar.openWeekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)
    || calendar.closedDates.some(day => !validCalendarDate(day))) return null;
  const from = dateInTimezone(observedAt, timezone), through = dateInTimezone(earliestAt, timezone);
  if (calendar.coveredFrom > from || calendar.coveredThrough < through) return null;
  const closed = new Set(calendar.closedDates), open = new Set(calendar.openWeekdays);
  // A returned slot on an explicitly closed date means supplied calendar disagrees.
  if (!open.has(new Date(through).getUTCDay()) || closed.has(through)) return null;
  let count = 0;
  for (let offset = 1; offset <= calendarDays; offset++) {
    const date = new Date(Date.parse(from) + offset * DAY_MS), day = date.toISOString().slice(0, 10);
    if (open.has(date.getUTCDay()) && !closed.has(day)) count++;
  }
  return count;
}

function seasonalDistance(left: string, right: string): number {
  // A common leap year gives a consistent circular calendar including Feb 29.
  const distance = Math.abs(Date.parse(`2000${left.slice(4)}`) - Date.parse(`2000${right.slice(4)}`)) / DAY_MS;
  return Math.min(distance, 366 - distance);
}

/** Supply one organization's one location; forecast numbers never enter this calculation. */
export function deliveryBaseline(history: readonly DeliveryHistoryObservation[], observedAt: string | Date, currentDays: number | null, timezone: string): DeliveryBaseline {
  const today = dateInTimezone(observedAt, timezone);
  const byDay = new Map<string, { day: string; observedAt: number; lead: number }>();
  for (const observation of history) {
    const at = new Date(observation.observedAt);
    if (observation.status !== 'SUCCESS' || observation.calendarDays === null || !Number.isFinite(observation.calendarDays)
      || observation.calendarDays < 0 || !Number.isFinite(at.getTime())) continue;
    const day = dateInTimezone(at, timezone);
    if (day >= today) continue;
    const previous = byDay.get(day);
    if (!previous || previous.observedAt < at.getTime()) byDay.set(day, { day, observedAt: at.getTime(), lead: observation.calendarDays });
  }
  const observations = [...byDay.values()];
  const nearby = observations.filter(o => seasonalDistance(o.day, today) <= 30);
  // Prior-year seasons exclude the immediately preceding December at January boundaries.
  const seasonal = nearby.filter(o => Date.parse(today) - Date.parse(o.day) >= 335 * DAY_MS);
  const trailing = observations.filter(o => Date.parse(today) - Date.parse(o.day) <= 90 * DAY_MS);
  let stage: DeliveryBaseline['stage'] = 'INSUFFICIENT_HISTORY';
  let values: typeof observations = [];
  if (seasonal.length >= MINIMUM_BASELINE_DAYS) { stage = 'PRIOR_YEAR_SEASONAL'; values = seasonal; }
  else if (nearby.length >= MINIMUM_BASELINE_DAYS) { stage = 'NEARBY_CALENDAR_PERIOD'; values = nearby; }
  else if (trailing.length >= MINIMUM_BASELINE_DAYS) { stage = 'TRAILING_90_DAYS'; values = trailing; }
  if (!values.length) return { stage, classification: null, typicalDays: null, sampleDays: Math.max(seasonal.length, nearby.length, trailing.length), toleranceDays: null };
  const mean = values.reduce((sum, o) => sum + o.lead, 0) / values.length;
  const tolerance = Math.max(1, mean * 0.2);
  const comparable = currentDays !== null && Number.isFinite(currentDays) && currentDays >= 0;
  const classification = !comparable ? null : currentDays < mean - tolerance ? 'Less than average' : currentDays > mean + tolerance ? 'More than average' : 'About average';
  return { stage, classification, typicalDays: Math.round(mean * 100) / 100, sampleDays: values.length, toleranceDays: Math.round(tolerance * 100) / 100 };
}