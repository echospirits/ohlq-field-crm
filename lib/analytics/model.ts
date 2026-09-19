import { opportunityRules } from '../opportunityConfig';

export const analyticsRules = { lapseDays: opportunityRules.lapseLookbackDays, recentPurchaseDays: opportunityRules.lapseRecentDays, recentVisitDays: opportunityRules.noTouchDays, followingVisitDays: 30 };
export type Channel = 'retail' | 'wholesale';
export type DateRange = { start: string; end: string };
export type Filters = DateRange & { preset: string; comparison: 'previous' | 'year' | 'none'; market: string; channel: 'all' | Channel; product: string; view: string; group: string; q: string; sort: string; page: number };
export type Product = { key: string; market: string; code: string; name: string };
export type SalesDay = { account: string; product: string; channel: Channel; market: string; date: string; quantity: number };
export type AnalyticsAccount = { key: string; name: string; city: string | null; channel: Channel; market: string; href: string; matched: boolean };
export type Activity = { account: string; date: string; kind: 'visit' | 'followup' | 'opportunity-created' | 'opportunity-completed'; id: string };
export type Coverage = { market: string; channel: Channel; source: string; unit: string; days: string[] };
export type AnalyticsData = { products: Product[]; accounts: AnalyticsAccount[]; sales: SalesDay[]; activity: Activity[]; openWork: Record<string, number>; coverage: Coverage[]; warnings: string[] };
export const day = (date: Date) => date.toISOString().slice(0, 10);
export const shiftDay = (value: string, amount: number) => day(new Date(new Date(`${value}T00:00:00Z`).getTime() + amount * 86400000));
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
export const inRange = (date: string, range: DateRange) => date >= range.start && date <= range.end;
export function dates(range: DateRange) { const result: string[] = []; for (let d = range.start; d <= range.end; d = shiftDay(d, 1)) result.push(d); return result; }
function priorYear(value: string) {
  const d = new Date(`${value}T00:00:00Z`); const month = d.getUTCMonth(); d.setUTCFullYear(d.getUTCFullYear() - 1);
  if (d.getUTCMonth() !== month) d.setUTCDate(0);
  return day(d);
}
export function comparisonRange(f: Filters): DateRange | null {
  if (f.comparison === 'none') return null;
  if (f.comparison === 'year') return { start: priorYear(f.start), end: priorYear(f.end) };
  const length = daysBetween(f.start, f.end) + 1;
  return { start: shiftDay(f.start, -length), end: shiftDay(f.start, -1) };
}
const validDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && day(new Date(v)) === v;
export function parseFilters(query: Record<string, string | string[] | undefined>, today: string): Filters {
  const get = (key: string) => typeof query[key] === 'string' ? query[key] as string : '';
  const preset = ['7', '30', 'mtd', 'qtd', 'ytd', '12m', 'custom'].includes(get('preset')) ? get('preset') : '30';
  let end = shiftDay(today, -1); // Complete calendar days; daily imports do not cover today yet.
  let start = shiftDay(end, -29);
  if (preset === '7') start = shiftDay(end, -6);
  if (preset === 'mtd') { start = today.slice(0, 8) + '01'; end = today; }
  if (preset === 'qtd') { start = `${today.slice(0, 4)}-${String(Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`; end = today; }
  if (preset === 'ytd') { start = today.slice(0, 4) + '-01-01'; end = today; }
  if (preset === '12m') start = shiftDay(priorYear(end), 1);
  if (preset === 'custom') {
    start = get('start'); end = get('end');
    if (!validDate(start) || !validDate(end) || start > end || end > today || daysBetween(start, end) > 365) throw new Error('Choose valid dates in order, no later than today, spanning at most 366 days.');
  }
  return { start, end, preset, comparison: get('comparison') === 'year' ? 'year' : get('comparison') === 'none' ? 'none' : 'previous', market: get('market') || 'all', channel: get('channel') === 'retail' ? 'retail' : get('channel') === 'wholesale' ? 'wholesale' : 'all', product: get('product'), view: ['sales', 'accounts', 'activity'].includes(get('view')) ? get('view') : 'sales', group: get('group') || 'all', q: get('q').trim().slice(0, 120), sort: ['name', 'quantity', 'change', 'visits'].includes(get('sort')) ? get('sort') : 'quantity', page: Math.max(1, Math.min(100000, Number.parseInt(get('page'), 10) || 1)) };
}
export function analyticsHref(f: Filters, patch: Partial<Filters> = {}, path = '/analytics') {
  const value = { ...f, ...patch }; const params = new URLSearchParams();
  Object.entries(value).forEach(([key, v]) => { if (String(v)) params.set(key, String(v)); });
  return `${path}?${params}`;
}
export function coverageFor(coverage: Coverage[], range: DateRange) {
  const expected = dates(range);
  const comparable = coverage.length > 0 && new Set(coverage.map(c => c.unit)).size === 1;
  const sets = coverage.map(c => new Set(c.days));
  const covered = comparable ? expected.filter(d => sets.every(set => set.has(d))) : [];
  return { expected: expected.length, covered: covered.length, complete: comparable && covered.length === expected.length, comparable, days: covered };
}
export const groupLabels: Record<string, string> = { all: 'All accounts', purchasing: 'Purchasing accounts', growing: 'Growing', declining: 'Declining', new: 'First observed purchases', lapsed: 'Lapsed buyers', after: 'Purchased after visit', without: 'No purchase within 30 days of visit', pending: 'Visit outcome not yet known', untouched: 'Purchasing with no recent visit', work: 'Open follow-ups / opportunities', single: 'One product purchased', multiple: 'Multiple products purchased' };
export type AccountResult = AnalyticsAccount & { quantity: number | null; previous: number | null; change: number | null; products: string[]; visits: number; followups: number; opportunitiesCreated: number; opportunitiesCompleted: number; openWork: number; firstObserved: string | null; lastPurchase: string | null; afterVisit: string | null; daysToPurchase: number | null; purchaseKind: string | null; groups: string[] };
export function summarize(data: AnalyticsData, f: Filters) {
  const products = data.products.filter(p => (f.market === 'all' || p.market === f.market) && (!f.product || p.key === f.product));
  const allowed = new Set(products.map(p => p.key));
  const markets = new Set([...products.map(p => p.market), ...data.coverage.filter(c => f.market === 'all' || c.market === f.market).map(c => c.market)]);
  const coverage = data.coverage.filter(c => markets.has(c.market) && (f.channel === 'all' || c.channel === f.channel));
  const currentCoverage = coverageFor(allowed.size ? coverage : [], f);
  const previousRange = comparisonRange(f);
  const previousCoverage = previousRange ? coverageFor(allowed.size ? coverage : [], previousRange) : null;
  const canCompare = currentCoverage.complete && Boolean(previousCoverage?.complete) && Boolean(previousRange && daysBetween(previousRange.start, previousRange.end) === daysBetween(f.start, f.end));
  const coveredBySource = new Map(coverage.map(c => [`${c.market}:${c.channel}`, new Set(c.days)]));
  const sales = data.sales.filter(s => allowed.has(s.product) && (f.channel === 'all' || s.channel === f.channel) && coveredBySource.get(`${s.market}:${s.channel}`)?.has(s.date) && s.date <= f.end);
  const salesByAccount = new Map<string, SalesDay[]>();
  for (const sale of sales) { const rows = salesByAccount.get(sale.account) ?? []; rows.push(sale); salesByAccount.set(sale.account, rows); }
  const activityByAccount = new Map<string, Activity[]>();
  for (const event of data.activity) { const events = activityByAccount.get(event.account) ?? []; events.push(event); activityByAccount.set(event.account, events); }
  const lapseRange = { start: shiftDay(f.end, -(analyticsRules.lapseDays - 1)), end: f.end };
  const rows: AccountResult[] = data.accounts.filter(a => markets.has(a.market) && (f.channel === 'all' || a.channel === f.channel)).map(a => {
    const accountCoverage = coverage.filter(c => c.market === a.market && c.channel === a.channel);
    const hasSales = allowed.size > 0 && coverageFor(accountCoverage, f).covered > 0;
    const all = (salesByAccount.get(a.key) ?? []).sort((x, y) => x.date.localeCompare(y.date));
    const current = all.filter(s => inRange(s.date, f));
    const purchases = all.filter(s => s.quantity > 0);
    const purchased = current.filter(s => s.quantity > 0);
    const quantity = hasSales ? current.reduce((sum, s) => sum + s.quantity, 0) : null;
    const previous = canCompare && previousRange ? all.filter(s => inRange(s.date, previousRange)).reduce((sum, s) => sum + s.quantity, 0) : null;
    const change = quantity !== null && quantity >= 0 && previous !== null && previous >= 0 ? quantity - previous : null;
    const events = activityByAccount.get(a.key) ?? [];
    const selectedEvents = events.filter(e => inRange(e.date, f));
    const visits = selectedEvents.filter(e => e.kind === 'visit').sort((x, y) => x.date.localeCompare(y.date));
    let following: SalesDay | undefined; let followingVisit: Activity | undefined; let without = false; let pending = false;
    for (const visit of visits) {
      const end = shiftDay(visit.date, analyticsRules.followingVisitDays);
      const match = purchases.find(s => s.date > visit.date && s.date <= end);
      if (match && !following) { following = match; followingVisit = visit; }
      if (!match) {
        const observed = { start: shiftDay(visit.date, 1), end };
        if (end <= f.end && coverageFor(accountCoverage, observed).complete) without = true;
        else pending = true;
      }
    }
    const groups = ['all'];
    if (purchased.length && a.matched) groups.push('purchasing');
    if (a.matched && change !== null && change > 0) groups.push('growing');
    if (a.matched && change !== null && change < 0) groups.push('declining');
    if (a.matched && purchases[0] && inRange(purchases[0].date, f)) groups.push('new');
    const last = purchases.at(-1)?.date ?? null;
    if (a.matched && last && inRange(last, lapseRange) && last <= shiftDay(f.end, -analyticsRules.recentPurchaseDays) && coverageFor(accountCoverage, lapseRange).complete) groups.push('lapsed');
    if (following) groups.push('after');
    // Account groups are mutually exclusive: a known following purchase wins over other visits.
    else if (without && !pending) groups.push('without');
    else if (visits.length) groups.push('pending');
    const recentVisit = events.some(e => e.kind === 'visit' && e.date <= f.end && e.date >= shiftDay(f.end, -(analyticsRules.recentVisitDays - 1)));
    if (a.matched && purchased.length && !recentVisit) groups.push('untouched');
    if (data.openWork[a.key]) groups.push('work');
    const purchasedProducts = [...new Set(purchased.map(s => s.product))];
    if (a.matched && purchasedProducts.length === 1) groups.push('single');
    if (a.matched && purchasedProducts.length > 1) groups.push('multiple');
    return { ...a, quantity, previous, change, products: purchasedProducts, visits: visits.length, followups: selectedEvents.filter(e => e.kind === 'followup').length, opportunitiesCreated: selectedEvents.filter(e => e.kind === 'opportunity-created').length, opportunitiesCompleted: selectedEvents.filter(e => e.kind === 'opportunity-completed').length, openWork: data.openWork[a.key] ?? 0, firstObserved: purchases[0]?.date ?? null, lastPurchase: last, afterVisit: following?.date ?? null, daysToPurchase: following && followingVisit ? daysBetween(followingVisit.date, following.date) : null, purchaseKind: following && followingVisit ? purchases.some(s => s.date <= followingVisit.date) ? 'Reorder in retained history' : 'First observed purchase' : null, groups };
  }).filter(a => a.quantity !== 0 || a.previous !== null && a.previous !== 0 || a.visits || a.followups || a.openWork || a.firstObserved || a.opportunitiesCreated || a.opportunitiesCompleted);
  const groupCounts: Record<string, number | null> = Object.fromEntries(Object.keys(groupLabels).map(key => [key, rows.filter(r => r.groups.includes(key)).length]));
  if (!currentCoverage.covered) for (const key of ['purchasing', 'new', 'single', 'multiple', 'untouched']) groupCounts[key] = null;
  if (!canCompare) { groupCounts.growing = null; groupCounts.declining = null; }
  if (!allowed.size || !coverageFor(coverage, lapseRange).complete) groupCounts.lapsed = null;
  if (!currentCoverage.covered) { groupCounts.after = null; groupCounts.without = null; }
  const filtered = groupCounts[f.group] === null ? [] : rows.filter(r => r.groups.includes(f.group) && (!f.q || `${r.name} ${r.city ?? ''} ${r.key}`.toLowerCase().includes(f.q.toLowerCase())));
  filtered.sort((a, b) => f.sort === 'name' ? a.name.localeCompare(b.name) : f.sort === 'visits' ? b.visits - a.visits || a.name.localeCompare(b.name) : f.sort === 'change' ? (b.change ?? -Infinity) - (a.change ?? -Infinity) || a.name.localeCompare(b.name) : (b.quantity ?? -Infinity) - (a.quantity ?? -Infinity) || a.name.localeCompare(b.name));
  const currentSales = sales.filter(s => inRange(s.date, f));
  const sum = (items: SalesDay[]) => items.reduce((total, s) => total + s.quantity, 0);
  const productRows = products.map(p => ({ ...p, quantity: coverageFor(coverage.filter(c => c.market === p.market), f).covered ? sum(currentSales.filter(s => s.product === p.key)) : null, accounts: coverageFor(coverage.filter(c => c.market === p.market), f).covered ? rows.filter(a => a.matched && a.products.includes(p.key)).length : null }));
  productRows.sort((a, b) => f.sort === 'name' ? a.name.localeCompare(b.name) : (b.quantity ?? -Infinity) - (a.quantity ?? -Infinity) || a.name.localeCompare(b.name));
  const trend = dates(f).map(date => ({ date, quantity: currentCoverage.days.includes(date) ? sum(currentSales.filter(s => s.date === date)) : null }));
  return { rows, filtered, products: productRows, trend, groupCounts, coverage, currentCoverage, previousCoverage, canCompare, quantity: currentCoverage.covered && currentCoverage.comparable ? sum(currentSales) : null, previousQuantity: canCompare && previousRange ? sum(sales.filter(s => inRange(s.date, previousRange))) : null, visits: rows.reduce((n, r) => n + r.visits, 0), visitedAccounts: rows.filter(r => r.visits > 0).length, followups: rows.reduce((n, r) => n + r.followups, 0), opportunitiesCreated: rows.reduce((n, r) => n + r.opportunitiesCreated, 0), opportunitiesCompleted: rows.reduce((n, r) => n + r.opportunitiesCompleted, 0), channels: coverage.map(c => ({ ...c, quantity: coverageFor([c], f).covered ? sum(currentSales.filter(s => s.channel === c.channel && s.market === c.market)) : null })), warnings: data.warnings };
}
export type AnalyticsResult = ReturnType<typeof summarize>;
