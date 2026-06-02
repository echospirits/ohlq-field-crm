export const EASTERN_TIME_ZONE = 'America/New_York';
export const DATE_ONLY_TIME_ZONE = 'UTC';

type DateValue = Date | string | number;

const defaultDateOptions: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
};

const defaultDateTimeOptions: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  month: 'short',
  timeZoneName: 'short',
  year: 'numeric',
};

const toDate = (date: DateValue) => (date instanceof Date ? date : new Date(date));

const formatWithTimeZone = (
  date: DateValue,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) => new Intl.DateTimeFormat('en-US', { ...options, timeZone }).format(toDate(date));

const getDateInputParts = (date: DateValue, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(toDate(date));

  const value = (type: Intl.DateTimeFormatPartTypes) => {
    const part = parts.find((item) => item.type === type)?.value;
    if (!part) throw new Error(`Unable to resolve date input part: ${type}`);
    return part;
  };

  return {
    day: value('day'),
    month: value('month'),
    year: value('year'),
  };
};

export const formatEasternDate = (
  date: DateValue | null | undefined,
  options: Intl.DateTimeFormatOptions = defaultDateOptions,
) => (date ? formatWithTimeZone(date, EASTERN_TIME_ZONE, options) : '');

export const formatEasternDateTime = (
  date: DateValue | null | undefined,
  options: Intl.DateTimeFormatOptions = defaultDateTimeOptions,
) => (date ? formatWithTimeZone(date, EASTERN_TIME_ZONE, options) : '');

export const formatDateOnly = (
  date: DateValue | null | undefined,
  options: Intl.DateTimeFormatOptions = defaultDateOptions,
) => (date ? formatWithTimeZone(date, DATE_ONLY_TIME_ZONE, options) : '');

export const formatDateInputValue = (
  date: DateValue,
  timeZone = DATE_ONLY_TIME_ZONE,
) => {
  const parts = getDateInputParts(date, timeZone);

  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const formatDateOnlyInputValue = (date: DateValue | null | undefined) =>
  date ? formatDateInputValue(date, DATE_ONLY_TIME_ZONE) : '';

export const formatEasternDateInputValue = (date: DateValue = new Date()) =>
  formatDateInputValue(date, EASTERN_TIME_ZONE);

export const addDaysToDateInputValue = (dateInputValue: string, days: number) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInputValue)) {
    throw new Error(`Invalid date input value: ${dateInputValue}`);
  }

  const date = new Date(`${dateInputValue}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);

  return formatDateInputValue(date, DATE_ONLY_TIME_ZONE);
};

export const addEasternCalendarDays = (days: number, from: DateValue = new Date()) =>
  addDaysToDateInputValue(formatEasternDateInputValue(from), days);
