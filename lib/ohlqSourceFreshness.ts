/** Only a valid, older upstream publication is a warning. Missing/future dates remain errors. */
export class OhlqSourceNotUpdatedError extends Error {
  constructor(readonly sourceLabel: string, readonly availableDate: string, readonly expectedDate: string) {
    super(`${sourceLabel} has not updated: newest file is dated ${availableDate}; expected ${expectedDate}. Import skipped; previously imported data retained.`);
    this.name = 'OhlqSourceNotUpdatedError';
  }
}

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function assertOhlqSourceFreshness(sourceLabel: string, availableDate: string, expectedDate: string) {
  if (!validDate(availableDate) || !validDate(expectedDate) || availableDate > expectedDate) {
    throw new Error(`Invalid ${sourceLabel} publication date ${availableDate || 'unknown'}; expected ${expectedDate}.`);
  }
  if (availableDate < expectedDate) throw new OhlqSourceNotUpdatedError(sourceLabel, availableDate, expectedDate);
}

/** Display historical stale-master failures as warnings without rewriting audit history. */
export function isLegacyOhlqStaleWarning(source: string, message: string | null | undefined) {
  const label = source === 'ACCOUNT_MASTER' ? 'Account Master' : source === 'BRAND_MASTER' ? 'Brand Master' : null;
  if (!label || !message) return false;
  const match = /^The newest (Account Master|Brand Master) is dated (\d{4}-\d{2}-\d{2}); expected today's Eastern date (\d{4}-\d{2}-\d{2})\.$/.exec(message);
  return !!match && match[1] === label && validDate(match[2]) && validDate(match[3]) && match[2] < match[3];
}

export function ohlqStatusLabel(status: string | undefined, count: number, source = '', message?: string | null) {
  if (status === 'WARNING' || (status === 'ERRORED' && isLegacyOhlqStaleWarning(source, message))) return 'Warning';
  if (status === 'ERRORED') return 'Errored';
  if (status === 'RUNNING') return 'Running';
  if (status === 'COMPLETED' || count > 0) return 'Completed';
  return 'Not Yet Run';
}
