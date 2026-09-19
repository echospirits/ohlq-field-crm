import { dates, parseFilters, type AnalyticsData, type Filters } from '../../lib/analytics/model';
export const filters = (patch: Partial<Filters> = {}): Filters => ({ ...parseFilters({ preset: 'custom', start: '2026-09-01', end: '2026-09-07' }, '2026-09-19'), ...patch });
export function fixture(): AnalyticsData {
  return {
    products: [{ key: 'OH:A', market: 'OH', code: 'A', name: 'Product A' }, { key: 'OH:B', market: 'OH', code: 'B', name: 'Product B' }],
    accounts: ['a', 'b', 'c', 'd'].map(key => ({ key, name: `Account ${key}`, city: 'Columbus', channel: key === 'd' ? 'wholesale' as const : 'retail' as const, market: 'OH', href: `/agencies/${key}`, matched: true })),
    sales: [
      { account: 'a', product: 'OH:A', market: 'OH', channel: 'retail', date: '2026-08-29', quantity: 2 },
      { account: 'a', product: 'OH:A', market: 'OH', channel: 'retail', date: '2026-09-03', quantity: 5 },
      { account: 'a', product: 'OH:B', market: 'OH', channel: 'retail', date: '2026-09-04', quantity: 3 },
      { account: 'b', product: 'OH:A', market: 'OH', channel: 'retail', date: '2026-09-05', quantity: 4 },
      { account: 'c', product: 'OH:A', market: 'OH', channel: 'retail', date: '2026-07-15', quantity: 7 },
      { account: 'd', product: 'OH:A', market: 'OH', channel: 'wholesale', date: '2026-09-05', quantity: 6 },
    ],
    activity: [{ account: 'a', date: '2026-09-01', kind: 'visit', id: 'v1' }, { account: 'c', date: '2026-09-01', kind: 'visit', id: 'v2' }],
    openWork: { c: 1 },
    coverage: ['retail', 'wholesale'].map(channel => ({ market: 'OH', channel: channel as 'retail' | 'wholesale', source: 'test daily', unit: 'bottles', days: dates({ start: '2026-06-01', end: '2026-10-01' }) })), warnings: [],
  };
}
