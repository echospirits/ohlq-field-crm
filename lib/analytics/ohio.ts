import { Prisma, type PrismaClient } from '@prisma/client';
import { getOhlqLicenseeMatchKeys } from '../ohlqWholesaleMatching';
import { formatDateInputValue } from '../dateTime';
import { analyticsRules, comparisonRange, day, shiftDay, type AnalyticsData, type Channel, type Filters, type Product } from './model';

export type AnalyticsDb = PrismaClient | Prisma.TransactionClient;
export type MarketAdapter = { market: string; load: (db: AnalyticsDb, organizationId: string, products: Product[], filters: Filters) => Promise<AnalyticsData> };

// Import logs survive pruning. Validate each completed day's physical row count
// against the import, including a genuinely empty successful report. Neither old
// success logs nor a tenant having zero matching rows prove current coverage.
export async function retainedDays(db: AnalyticsDb, channel: Channel, start: string, end: string) {
  const table = channel === 'retail' ? Prisma.sql`"OhlqAnnualSalesRow"` : Prisma.sql`"OhlqAnnualSalesByWholesaleRow"`;
  const source = channel === 'retail' ? 'ANNUAL_SALES_SUMMARY' : 'ANNUAL_SALES_SUMMARY_BY_WHOLESALE';
  const rows = await db.$queryRaw<{ reportDate: Date }[]>(Prisma.sql`
    WITH physical AS (
      SELECT "reportDate", COUNT(*) AS n FROM ${table}
      WHERE "reportDate" BETWEEN ${new Date(start)} AND ${new Date(end)} GROUP BY "reportDate"
    ) SELECT s."reportDate" FROM "OhlqReportImportStatus" s
    LEFT JOIN physical p ON p."reportDate" = s."reportDate"
    WHERE s."dataSource"::text = ${source} AND s.status::text = 'COMPLETED'
      AND s."reportDate" BETWEEN ${new Date(start)} AND ${new Date(end)}
      AND s."rowCount" = COALESCE(p.n, 0) AND s."skippedRows" = 0
    ORDER BY s."reportDate"`);
  return rows.map(r => day(r.reportDate));
}

export const ohioAdapter: MarketAdapter = {
  market: 'OH',
  async load(db, organizationId, products, f) {
    const previous = comparisonRange(f);
    const start = [f.start, previous?.start ?? f.start, shiftDay(f.end, -(analyticsRules.lapseDays - 1))].sort()[0];
    const codes = products.map(p => p.code);
    const channels: Channel[] = f.channel === 'all' ? ['retail', 'wholesale'] : [f.channel];
    const coverage = await Promise.all(channels.map(async channel => ({ market: 'OH', channel, unit: 'bottles', source: channel === 'retail' ? 'OHLQ daily Agency retail sales' : 'OHLQ daily wholesale sales by permit', days: codes.length ? await retainedDays(db, channel, start, f.end) : [] })));
    const retailDays = coverage.find(c => c.channel === 'retail')?.days ?? [];
    const wholesaleDays = coverage.find(c => c.channel === 'wholesale')?.days ?? [];
    const activityStart = [f.start, shiftDay(f.end, -(analyticsRules.recentVisitDays - 1))].sort()[0];
    // UTC bounds are deliberately padded; calendar-day inclusion is resolved in
    // the source market's timezone below, including DST and late evening visits.
    const activityBounds = { gte: new Date(activityStart), lt: new Date(`${shiftDay(f.end, 2)}T00:00:00Z`) };
    const [retail, wholesale, visits, tasks, opportunities] = await Promise.all([
      retailDays.length ? db.ohlqAnnualSalesRow.groupBy({ by: ['agencyId', 'brand', 'reportDate'], where: { brand: { in: codes }, reportDate: { in: retailDays.map(d => new Date(d)) } }, _sum: { retailBottlesSold: true } }) : Promise.resolve([]),
      wholesaleDays.length ? db.ohlqAnnualSalesByWholesaleRow.groupBy({ by: ['permitNumber', 'brand', 'reportDate'], where: { brand: { in: codes }, reportDate: { in: wholesaleDays.map(d => new Date(d)) } }, _sum: { wholesaleBottlesSold: true } }) : Promise.resolve([]),
      db.loggedVisit.findMany({ where: { organizationId, visitAt: activityBounds }, select: { id: true, visitAt: true, agencyId: true, wholesaleAccountId: true } }),
      db.worklistItem.findMany({ where: { organizationId, OR: [{ status: { in: ['OPEN', 'IN_PROGRESS'] } }, { status: 'COMPLETED', completedAt: activityBounds }] }, select: { id: true, agencyId: true, wholesaleAccountId: true, status: true, source: true, completedAt: true } }),
      db.salesOpportunity.findMany({ where: { organizationId, OR: [{ status: { in: ['OPEN', 'ACTIONED', 'SNOOZED'] } }, { createdAt: activityBounds }, { resolvedAt: activityBounds }, { convertedAt: activityBounds }] }, select: { id: true, wholesaleAccountId: true, status: true, createdAt: true, resolvedAt: true, convertedAt: true } }),
    ]);
    const keys = new Map<string, Set<string>>();
    // This is one batched identity read, not a query per permit. Global public
    // identities detect collisions; no tenant configuration or contact fields.
    if (wholesale.length) {
      const identities = await db.wholesaleAccount.findMany({ where: { mergedIntoId: null, state: 'OH' }, select: { id: true, licenseeId: true, licenseeIds: { select: { licenseeId: true } } } });
      for (const a of identities) for (const id of [a.licenseeId, ...a.licenseeIds.map(x => x.licenseeId)]) for (const key of getOhlqLicenseeMatchKeys(id)) {
        const ids = keys.get(key) ?? new Set<string>(); ids.add(a.id); keys.set(key, ids);
      }
    }
    const permitMap = new Map<string, string>();
    for (const row of wholesale) {
      if (permitMap.has(row.permitNumber)) continue;
      const ids = new Set(getOhlqLicenseeMatchKeys(row.permitNumber).flatMap(key => [...(keys.get(key) ?? [])]));
      if (ids.size === 1) permitMap.set(row.permitNumber, [...ids][0]);
    }
    const agencyNumbers = [...new Set(retail.map(r => r.agencyId))];
    const agencyIds = [...new Set([...visits, ...tasks].flatMap(r => r.agencyId ? [r.agencyId] : []))];
    const wholesaleIds = [...new Set([...permitMap.values(), ...[...visits, ...tasks, ...opportunities].flatMap(r => r.wholesaleAccountId ? [r.wholesaleAccountId] : [])])];
    const [agencies, accounts] = await Promise.all([
      channels.includes('retail') ? db.agency.findMany({ where: { state: 'OH', OR: [{ agencyId: { in: agencyNumbers } }, { id: { in: agencyIds } }] }, select: { id: true, agencyId: true, name: true, city: true } }) : Promise.resolve([]),
      channels.includes('wholesale') ? db.wholesaleAccount.findMany({ where: { id: { in: wholesaleIds }, state: 'OH', mergedIntoId: null }, select: { id: true, name: true, city: true } }) : Promise.resolve([]),
    ]);
    const data: AnalyticsData = { products, accounts: [], sales: [], activity: [], openWork: {}, coverage, warnings: [] };
    const agencyMap = new Map(agencies.map(a => [a.agencyId, a]));
    data.accounts.push(...agencies.map(a => ({ key: `OH:retail:${a.id}`, market: 'OH', channel: 'retail' as const, name: a.name, city: a.city, href: `/agencies/${encodeURIComponent(a.id)}`, matched: true })), ...accounts.map(a => ({ key: `OH:wholesale:${a.id}`, market: 'OH', channel: 'wholesale' as const, name: a.name, city: a.city, href: `/wholesale/${encodeURIComponent(a.id)}`, matched: true })));
    const accountKeys = new Set(data.accounts.map(a => a.key));
    function unresolved(key: string, name: string, channel: Channel, search: string) {
      if (!accountKeys.has(key)) { accountKeys.add(key); data.accounts.push({ key, name, channel, market: 'OH', city: null, href: `/search?q=${encodeURIComponent(search)}`, matched: false }); }
      return key;
    }
    for (const r of retail) data.sales.push({ account: agencyMap.has(r.agencyId) ? `OH:retail:${agencyMap.get(r.agencyId)!.id}` : unresolved(`OH:retail:unmatched:${r.agencyId}`, `Agency ${r.agencyId} (unlinked)`, 'retail', r.agencyId), product: `OH:${r.brand}`, date: day(r.reportDate), channel: 'retail', market: 'OH', quantity: r._sum.retailBottlesSold ?? 0 });
    for (const r of wholesale) data.sales.push({ account: permitMap.has(r.permitNumber) ? `OH:wholesale:${permitMap.get(r.permitNumber)}` : unresolved(`OH:wholesale:unmatched:${r.permitNumber}`, `Permit ${r.permitNumber} (unresolved)`, 'wholesale', r.permitNumber), product: `OH:${r.brand}`, date: day(r.reportDate), channel: 'wholesale', market: 'OH', quantity: r._sum.wholesaleBottlesSold ?? 0 });
    const keyFor = (r: { wholesaleAccountId?: string | null; agencyId?: string | null }) => r.wholesaleAccountId ? `OH:wholesale:${r.wholesaleAccountId}` : r.agencyId ? `OH:retail:${r.agencyId}` : '';
    const dateFor = (d: Date) => formatDateInputValue(d, 'America/New_York');
    const addActivity = (account: string, date: Date | null, kind: AnalyticsData['activity'][number]['kind'], id: string) => { if (date && accountKeys.has(account)) { const d = dateFor(date); if (d >= activityStart && d <= f.end) data.activity.push({ account, date: d, kind, id }); } };
    for (const v of visits) addActivity(keyFor(v), v.visitAt, 'visit', v.id);
    for (const t of tasks) {
      const key = keyFor(t);
      if (['OPEN', 'IN_PROGRESS'].includes(t.status) && accountKeys.has(key)) data.openWork[key] = (data.openWork[key] ?? 0) + 1;
      if (t.status === 'COMPLETED' && t.source === 'VISIT_FOLLOW_UP') addActivity(key, t.completedAt, 'followup', t.id);
    }
    for (const o of opportunities) {
      const key = keyFor(o);
      addActivity(key, o.createdAt, 'opportunity-created', o.id);
      addActivity(key, o.convertedAt ?? o.resolvedAt, 'opportunity-completed', o.id);
      if (['OPEN', 'ACTIONED', 'SNOOZED'].includes(o.status) && accountKeys.has(key)) data.openWork[key] = (data.openWork[key] ?? 0) + 1;
    }
    const unmatched = data.accounts.filter(a => !a.matched).length;
    if (unmatched) data.warnings.push(`${unmatched} sales identities could not be safely linked. Their bottles remain in totals, but they are excluded from purchasing-account and distribution counts.`);
    return data;
  },
};
