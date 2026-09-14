import { formatFreshnessDate, freshnessLabels, getDataFreshness } from '../../lib/dataFreshness';

export function DataFreshnessBadge({
  sourceDate,
  datePrefix = 'Through',
  currentWithinDays,
  staleAfterDays,
}: {
  sourceDate: Date | string | null | undefined;
  datePrefix?: string;
  currentWithinDays?: number;
  staleAfterDays?: number;
}) {
  const freshness = getDataFreshness({ sourceDate, currentWithinDays, staleAfterDays });
  const formattedDate = sourceDate ? formatFreshnessDate(sourceDate) : null;
  const ageDescription = freshness.ageDays === null
    ? 'No source date is available.'
    : freshness.ageDays === 0
      ? 'Source data is dated today.'
      : `Source data is ${freshness.ageDays} day${freshness.ageDays === 1 ? '' : 's'} old.`;

  return <span className={`freshness-badge freshness-${freshness.state}`} title={ageDescription}>
    <strong>{freshnessLabels[freshness.state]}</strong>
    <span>{formattedDate ? `${datePrefix} ${formattedDate}` : 'No source date'}</span>
  </span>;
}
