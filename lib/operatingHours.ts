export const OPERATING_HOURS_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export type OperatingHoursDay = typeof OPERATING_HOURS_DAYS[number];
export type OperatingHoursEntry = { day: OperatingHoursDay; hours: string };
export type OperatingHoursDetails = {
  schedule: OperatingHoursEntry[] | null;
  sourceName: string | null;
  sourceUrl: string | null;
  researchedAt: string | null;
};
export type OperatingHoursConflict = {
  accountType: 'agency' | 'wholesale';
  label: string;
};

type MinuteInterval = { start: number; end: number };

const minutesPerDay = 24 * 60;
const validDays = new Set<string>(OPERATING_HOURS_DAYS);
const timeExpression = /(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)/gi;

function parseTime(value: string) {
  const match = value.match(/^(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)$/i);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (hour < 1 || hour > 12) return null;
  const meridiem = match[3].replaceAll('.', '').toLowerCase();
  return (hour % 12 + (meridiem === 'pm' ? 12 : 0)) * 60 + minute;
}

function parseDailyIntervals(value: string): MinuteInterval[] | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^(?:closed|closed all day|not open)$/.test(normalized)) return [];
  if (/^(?:open\s+)?(?:24\s*hours?(?:\s+a\s+day)?|24\s*\/\s*7|always open)$/.test(normalized)) {
    return [{ start: 0, end: minutesPerDay }];
  }

  const matches = Array.from(value.matchAll(timeExpression));
  if (!matches.length || matches.length % 2 !== 0) return null;

  const intervals: MinuteInterval[] = [];
  for (let index = 0; index < matches.length; index += 2) {
    const startMatch = matches[index];
    const endMatch = matches[index + 1];
    const separator = value.slice(startMatch.index! + startMatch[0].length, endMatch.index!);
    if (!/^\s*(?:-|–|—|to|until)\s*$/i.test(separator)) return null;

    const start = parseTime(startMatch[0]);
    const end = parseTime(endMatch[0]);
    if (start === null || end === null) return null;
    intervals.push({ start, end: end <= start ? end + minutesPerDay : end });
  }
  return intervals;
}

export function readOperatingHoursSchedule(value: unknown): OperatingHoursEntry[] | null {
  const rawSchedule = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && !Array.isArray(value)
      ? (value as { schedule?: unknown }).schedule
      : null;
  if (!Array.isArray(rawSchedule)) return null;
  const schedule = rawSchedule.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const candidate = entry as { day?: unknown; hours?: unknown };
    if (typeof candidate.day !== 'string' || !validDays.has(candidate.day)) return [];
    if (typeof candidate.hours !== 'string' || !candidate.hours.trim() || candidate.hours.length > 120) return [];
    return [{ day: candidate.day as OperatingHoursDay, hours: candidate.hours.trim() }];
  });
  return schedule.length ? schedule : null;
}

export function readOperatingHoursDetails(value: unknown): OperatingHoursDetails {
  const stored = value && typeof value === 'object' && !Array.isArray(value)
    ? value as { sourceName?: unknown; sourceUrl?: unknown; researchedAt?: unknown }
    : null;
  return {
    schedule: readOperatingHoursSchedule(value),
    sourceName: typeof stored?.sourceName === 'string' ? stored.sourceName : null,
    sourceUrl: typeof stored?.sourceUrl === 'string' ? stored.sourceUrl : null,
    researchedAt: typeof stored?.researchedAt === 'string' ? stored.researchedAt : null,
  };
}

const weekdayForDate = (date: string): OperatingHoursDay | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  return OPERATING_HOURS_DAYS[(parsed.getUTCDay() + 6) % 7];
};

const previousDay = (day: OperatingHoursDay) => {
  const index = OPERATING_HOURS_DAYS.indexOf(day);
  return OPERATING_HOURS_DAYS[(index + OPERATING_HOURS_DAYS.length - 1) % OPERATING_HOURS_DAYS.length];
};

export function getOperatingHoursConflict({
  accountType,
  schedule,
  date,
  startMinutes,
  durationMinutes = 30,
}: {
  accountType: 'agency' | 'wholesale' | null | undefined;
  schedule: OperatingHoursEntry[] | null | undefined;
  date: string | null | undefined;
  startMinutes: number | null | undefined;
  durationMinutes?: number;
}): OperatingHoursConflict | null {
  if (!accountType || !schedule?.length || !date || startMinutes == null || !Number.isInteger(startMinutes)) return null;
  if (startMinutes < 0 || startMinutes >= minutesPerDay || durationMinutes <= 0) return null;

  const day = weekdayForDate(date);
  if (!day) return null;
  const currentEntry = schedule.find((entry) => entry.day === day);
  const currentIntervals = currentEntry ? parseDailyIntervals(currentEntry.hours) : null;
  const priorEntry = schedule.find((entry) => entry.day === previousDay(day));
  const priorIntervals = priorEntry ? parseDailyIntervals(priorEntry.hours) : null;
  const carriedIntervals = priorIntervals?.filter((interval) => interval.end > minutesPerDay)
    .map((interval) => ({ start: interval.start - minutesPerDay, end: interval.end - minutesPerDay })) ?? [];

  const appointmentEnd = startMinutes + durationMinutes;
  const knownIntervals = [...(currentIntervals ?? []), ...carriedIntervals];
  if (knownIntervals.some((interval) => startMinutes >= interval.start && appointmentEnd <= interval.end)) return null;

  // Missing or unparseable entries stay unknown rather than being treated as closed.
  if (!currentEntry || currentIntervals === null) return null;
  return {
    accountType,
    label: accountType === 'agency' ? 'Outside agency hours' : 'Outside wholesale hours',
  };
}

export function isSupportedOperatingHoursText(value: string) {
  return parseDailyIntervals(value) !== null;
}
