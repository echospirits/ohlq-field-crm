import { validDay } from './model';

/** Only the canonical My Schedule context may replace the forecasting back link. */
export function forecastScheduleReturnTo(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^\/\?view=(day|week)&date=(\d{4}-\d{2}-\d{2})$/.exec(value);
  return match && validDay(match[2]) ? value : null;
}
