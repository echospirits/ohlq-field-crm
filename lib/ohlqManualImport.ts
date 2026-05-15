import { formatOhlqDate, toOhlqDateOnlyUtc } from './ohlqDataStatus';

const manualImportTimeZone = 'America/New_York';

function todayInEastern(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone: manualImportTimeZone,
    year: 'numeric',
  }).formatToParts(now);

  const value = (type: Intl.DateTimeFormatPartTypes) => {
    const part = parts.find((item) => item.type === type)?.value;
    if (!part) throw new Error(`Unable to resolve Eastern date part: ${type}`);
    return Number(part);
  };

  return {
    day: value('day'),
    month: value('month'),
    year: value('year'),
  };
}

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
