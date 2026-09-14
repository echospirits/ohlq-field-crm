export type DataFreshnessState = 'current' | 'delayed' | 'stale' | 'unavailable';

const dayMs = 86_400_000;

const toUtcDay = (value: Date | string) => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

export function getDataFreshness({
  sourceDate,
  now = new Date(),
  currentWithinDays = 2,
  staleAfterDays = 7,
}: {
  sourceDate: Date | string | null | undefined;
  now?: Date;
  currentWithinDays?: number;
  staleAfterDays?: number;
}) {
  if (!sourceDate) return { ageDays: null, state: 'unavailable' as const };
  const sourceDay = toUtcDay(sourceDate);
  const today = toUtcDay(now);
  if (sourceDay === null || today === null) return { ageDays: null, state: 'unavailable' as const };
  const ageDays = Math.max(0, Math.floor((today - sourceDay) / dayMs));
  const state: DataFreshnessState = ageDays <= currentWithinDays
    ? 'current'
    : ageDays <= staleAfterDays
      ? 'delayed'
      : 'stale';
  return { ageDays, state };
}

export const formatFreshnessDate = (value: Date | string) => {
  const day = toUtcDay(value);
  if (day === null) return null;
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(day));
};

export const freshnessLabels: Record<DataFreshnessState, string> = {
  current: 'Current',
  delayed: 'Delayed',
  stale: 'Stale',
  unavailable: 'No data',
};
