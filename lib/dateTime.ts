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

export const parseTimeInputToMinutes = (value: FormDataEntryValue | string | null | undefined) => {
  const match = String(value ?? '').trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? hours * 60 + minutes : null;
};

export const formatTimeMinutesInput = (minutes: number | null | undefined) => {
  if (minutes == null || minutes < 0 || minutes >= 24 * 60) return '';
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};

export const formatTimeMinutes = (minutes: number | null | undefined) => {
  const value = formatTimeMinutesInput(minutes);
  if (!value) return '';
  const [hours, mins] = value.split(':').map(Number);
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2000, 0, 1, hours, mins)),
  );
};

export const formatWorklistDue = (
  date: DateValue | null | undefined,
  dueTimeMinutes: number | null | undefined,
) => {
  const dateLabel = formatDateOnly(date);
  if (!dateLabel) return '';
  const timeLabel = formatTimeMinutes(dueTimeMinutes);
  return timeLabel ? `${dateLabel} at ${timeLabel}` : dateLabel;
};

export const getZonedDateTimeParts = (date: DateValue, timeZone = EASTERN_TIME_ZONE) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      second: '2-digit',
      timeZone,
      year: 'numeric',
    })
      .formatToParts(toDate(date))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
};

export const zonedDateTimeToUtc = (
  dateInput: string,
  minutes: number,
  timeZone = EASTERN_TIME_ZONE,
) => {
  const match = dateInput.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match || minutes < 0 || minutes >= 24 * 60) throw new Error('Invalid local date/time');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const desiredLocalAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desiredLocalAsUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = getZonedDateTimeParts(new Date(candidate), timeZone);
    const candidateLocalAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    const adjustment = desiredLocalAsUtc - candidateLocalAsUtc;
    if (adjustment === 0) return new Date(candidate);
    candidate += adjustment;
  }
  throw new Error('Invalid local date/time');
};

export const isValidZonedDateTime = (
  dateInput: string,
  minutes: number,
  timeZone = EASTERN_TIME_ZONE,
) => {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60) return false;
  const match = dateInput.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(`${dateInput}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dateInput) return false;

  try {
    const parts = getZonedDateTimeParts(zonedDateTimeToUtc(dateInput, minutes, timeZone), timeZone);
    return parts.year === Number(match[1]) &&
      parts.month === Number(match[2]) &&
      parts.day === Number(match[3]) &&
      parts.hour * 60 + parts.minute === minutes;
  } catch {
    return false;
  }
};
