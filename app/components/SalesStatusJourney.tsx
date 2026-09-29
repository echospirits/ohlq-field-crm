import Link from 'next/link';
import './salesStatus.css';
import type { AccountSalesStatus } from '@prisma/client';
import { ACTIVE_SALES_STATUSES, SALES_STATUS_OPTIONS } from '../../lib/accountSalesStatus';

type Props = {
  compact?: boolean;
  currentStatus?: AccountSalesStatus | null;
  counts?: Partial<Record<AccountSalesStatus, number>>;
  filterHref?: (status: AccountSalesStatus) => string;
};

/** Relationship stages, not a claim that earlier stages were visited or completed. */
export function SalesStatusJourney({ compact = false, currentStatus, counts, filterHref }: Props) {
  const currentIndex = ACTIVE_SALES_STATUSES.findIndex((status) => status === currentStatus);
  const stage = (option: typeof SALES_STATUS_OPTIONS[number], index?: number) => {
    const current = currentStatus === option.value;
    const muted = compact && !current && (index === undefined || currentIndex < 0 || index > currentIndex);
    const content = <>
      {!compact ? <span className="sales-journey-caption">{counts ? `${counts[option.value] ?? 0} account${counts[option.value] === 1 ? '' : 's'}` : index === undefined ? 'Other status' : `Stage ${index + 1}`}</span> : null}
      {compact && index !== undefined ? <span className="sales-journey-number" aria-hidden="true">{index + 1}</span> : null}
      <strong>{option.label}</strong>
      {filterHref ? <svg className="sales-journey-filter-icon" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16l-6 7v7l-4 2v-9z" /></svg> : null}
      {current && !compact ? <span className="sales-journey-current">{filterHref ? 'Selected' : 'Current status'}</span> : null}
    </>;
    return <li key={option.value} data-sales-stage={option.value} className={[current ? 'is-current' : '', muted ? 'is-upcoming' : ''].filter(Boolean).join(' ')}>
      {filterHref ? <Link href={filterHref(option.value)} aria-current={current ? 'page' : undefined}>{content}</Link> : <div aria-current={current ? 'step' : undefined}>{content}</div>}
    </li>;
  };

  return <div className={['sales-journey', compact ? 'sales-journey--compact' : '', filterHref ? 'sales-journey--filters' : ''].filter(Boolean).join(' ')} aria-label={filterHref ? 'Filter pipeline by sales status' : 'Sales relationship stages'}>
    <ol className="sales-journey-path">
      {SALES_STATUS_OPTIONS.filter(({ value }) => (ACTIVE_SALES_STATUSES as readonly AccountSalesStatus[]).includes(value)).map((option, index) => stage(option, index))}
    </ol>
    {!compact || currentIndex < 0 ? <ul className="sales-journey-other" aria-label="Other relationship statuses">
      {SALES_STATUS_OPTIONS.filter(({ value }) => !(ACTIVE_SALES_STATUSES as readonly AccountSalesStatus[]).includes(value) && (!compact || value === currentStatus)).map((option) => stage(option))}
    </ul> : null}
  </div>;
}
