import type { PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';
import { summarize, type AnalyticsData, type Filters, type Product } from './model';
import { ohioAdapter, type AnalyticsDb, type MarketAdapter } from './ohio';

export const analyticsAdapters: MarketAdapter[] = [ohioAdapter];
export async function loadAnalytics(organizationId: string, filters: Filters, db: AnalyticsDb = prisma, adapters: MarketAdapter[] = analyticsAdapters) {
  if (!organizationId) throw new Error('Organization context is required.');
  const configured = await db.organizationProduct.findMany({ where: { organizationId, status: { in: ['OWNED', 'REPRESENTED'] } }, select: { market: true, externalItemCode: true, displayName: true } });
  // Historical sales remain valid for discontinued/inactive owned products.
  // No vendor fallback, deployment defaults, or another organization's products.
  const products: Product[] = configured.map(p => ({ key: `${p.market}:${p.externalItemCode}`, market: p.market, code: p.externalItemCode, name: p.displayName || p.externalItemCode }));
  const selected = products.filter(p => (filters.market === 'all' || p.market === filters.market) && (!filters.product || p.key === filters.product));
  const data: AnalyticsData = { products: selected, accounts: [], sales: [], activity: [], coverage: [], openWork: {}, warnings: [] };
  const markets = [...new Set([...products.map(p => p.market), ...adapters.map(a => a.market)])].sort();
  const supported = new Set(adapters.map(a => a.market));
  const results = await Promise.all(adapters.filter(a => selected.some(p => p.market === a.market) || (!filters.product && (filters.market === 'all' || filters.market === a.market))).map(a => a.load(db, organizationId, selected.filter(p => p.market === a.market), filters)));
  for (const result of results) { data.accounts.push(...result.accounts); data.sales.push(...result.sales); data.activity.push(...result.activity); data.coverage.push(...result.coverage); Object.assign(data.openWork, result.openWork); data.warnings.push(...result.warnings); }
  const unavailable = [...new Set(selected.filter(p => !supported.has(p.market)).map(p => p.market))];
  if (unavailable.length) data.warnings.push(`Sales data unavailable for ${unavailable.join(', ')}. All Markets totals include supported sources only.`);
  if (!selected.length) data.warnings.push('No owned or represented products match these filters. Clear the product/market filter or review Organization products.');
  return { ...summarize(data, filters), availableProducts: products, markets, organizationId };
}

// One consistent read snapshot for coverage, facts and private CRM records.
export function getAnalytics(organizationId: string, filters: Filters, db: PrismaClient = prisma) {
  return db.$transaction(tx => loadAnalytics(organizationId, filters, tx), { isolationLevel: 'RepeatableRead', timeout: 45000 });
}
