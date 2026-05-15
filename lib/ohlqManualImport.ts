import { formatOhlqDate, toOhlqDateOnlyUtc } from './ohlqDataStatus';

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
