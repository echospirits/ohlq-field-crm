import type { AgencyOpportunitySales90 } from '../../lib/agencyFocusSales';
import { formatDateOnly } from '../../lib/dateTime';

export const AGENCY_OPPORTUNITY_SALES_LABEL = 'Sales · 7 / 30 / 90d';

export function AgencyOpportunitySalesCell({
  opportunity,
  sales90,
}: {
  opportunity: { retailSales7: number; retailSales30: number; asOfDate: Date };
  sales90?: AgencyOpportunitySales90;
}) {
  const bottles90 = sales90?.bottles ?? null;
  const coverageNote = bottles90 === null ? '90d history unavailable' : sales90?.complete ? null : 'Partial 90d history';
  const through = sales90?.through;

  return <td className="numeric" data-label={AGENCY_OPPORTUNITY_SALES_LABEL}>
    <strong>{opportunity.retailSales7.toLocaleString()} / {opportunity.retailSales30.toLocaleString()} / {bottles90?.toLocaleString() ?? '—'}</strong>
    <small>bottles{coverageNote ? ` · ${coverageNote}` : null}</small>
    {through && bottles90 !== null && through.getTime() !== opportunity.asOfDate.getTime() ? <small>90d through {formatDateOnly(through)}</small> : null}
  </td>;
}
