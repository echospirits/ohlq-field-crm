import { formatOhlqDate, toOhlqDateOnlyUtc } from './ohlqDataStatus';
import { getZonedDateTimeParts } from './dateTime';

const manualImportTimeZone = 'America/New_York';

const todayInEastern = (now = new Date()) => getZonedDateTimeParts(now, manualImportTimeZone);

export function getLatestManualOhlqReportDate(now = new Date()) {
  const today = todayInEastern(now);
  return formatOhlqDate(new Date(Date.UTC(today.year, today.month - 1, today.day - 1, 12)));
}

export function normalizeManualOhlqReportDate(value: FormDataEntryValue | null | undefined) {
  const rawValue = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) return null;

  try {
    const date = toOhlqDateOnlyUtc(rawValue);
    return formatOhlqDate(date) === rawValue ? rawValue : null;
  } catch {
    return null;
  }
}

export function isFutureOhlqReportDate(reportDate: string, latestAllowedReportDate: string) {
  return reportDate > latestAllowedReportDate;
}
