import type { AnalyticsResult, Filters } from './model';

export const csvCell = (value: unknown) => {
  let text = value === null || value === undefined ? 'Unavailable' : String(value);
  if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
export function analyticsCsv(result: AnalyticsResult, f: Filters, organizationId: string, report: string) {
  const context = ['Organization', 'Market filter', 'Channel filter', 'Product filter', 'Start', 'End', 'Comparison', 'Group', 'Search', 'Coverage'];
  const values = [organizationId, f.market, f.channel, f.product || 'All', f.start, f.end, f.comparison, f.group, f.q, `${result.currentCoverage.covered}/${result.currentCoverage.expected} complete source-days`];
  const rows: unknown[][] = report === 'products'
    ? [[...context, 'Product', 'Market', 'Bottles observed', 'Purchasing accounts'], ...result.products.filter(p => !f.q || `${p.name} ${p.code}`.toLowerCase().includes(f.q.toLowerCase())).map(p => [...values, p.name, p.market, p.quantity, p.accounts])]
    : [[...context, 'Account', 'City', 'Channel', 'Bottles observed', 'Previous bottles', 'Change', 'Products purchased', 'Visits', 'Visit follow-ups completed', 'Opportunities created', 'Opportunities completed', 'Open work now', 'First observed purchase', 'Last observed purchase', 'Purchase after visit', 'Days to purchase', 'Purchase kind', 'Identity linked'], ...result.filtered.map(a => [...values, a.name, a.city ?? '', a.channel, a.quantity, a.previous, a.change, a.quantity === null ? null : a.products.length, a.visits, a.followups, a.opportunitiesCreated, a.opportunitiesCompleted, a.openWork, a.firstObserved ?? '', a.lastPurchase ?? '', a.afterVisit ?? '', a.daysToPurchase, a.purchaseKind ?? '', a.matched])];
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
