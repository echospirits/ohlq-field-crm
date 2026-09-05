import { PrismaClient } from '@prisma/client';

// Read-only evidence report. Never runs the opportunity evaluator or writes CRM data.
const db = new PrismaClient();
async function main() {
  if (process.argv.includes('--score')) {
    const { evaluateOpportunityIntelligence } = await import('../lib/opportunityEngine');
    const report = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      const account = await tx.wholesaleAccount.findFirst({ where: { licenseeId: '02485275-1' }, select: { id: true } });
      if (!account) throw new Error('Standard Hall identity was not found');
      const result = await evaluateOpportunityIntelligence({ db: tx as unknown as PrismaClient, organizationId: 'org_echo_spirits', accountIds: [account.id], dryRun: true });
      return { ...result, previews: result.previews?.map(p => {
        const totalLiters = p.purchases.reduce((n,x) => n + x.bottles90 * (x.liters ?? .75), 0);
        const cheapLiters = p.purchases.filter(x => x.price750 !== null && x.price750 !== undefined && x.price750 < 15).reduce((n,x) => n + x.bottles90 * (x.liters ?? .75), 0);
        return { name: p.name, primary: p.primary, alternatives: p.alternatives.map(a => ({ item: a.item, score: a.score, peers: a.peers, price: a.factors.filter(f => /price fit|priority capped/.test(f)) })), totalLiters, below15Share: totalLiters ? cheapLiters / totalLiters : null,
          largestPurchases: p.purchases.sort((a,b) => b.bottles90-a.bottles90).slice(0,8) };
      }) };
    }, { timeout: 180000 });
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const organizations = await tx.organization.findMany({ select: { id: true, displayName: true, products: { where: { active: true }, select: { externalItemCode: true, status: true } } } });
    const accounts = await tx.wholesaleAccount.findMany({ where: { OR: [{ name: { contains: 'Standard Hall', mode: 'insensitive' } }, { licenseeId: { in: ['02485275-1', '2485275'] } }] }, select: { id: true, name: true, licenseeId: true, licenseeIds: true, targetMetrics: { orderBy: { periodEnd: 'desc' }, take: 1 }, opportunities: { select: { organizationId: true, productionScore: true, explanation: true, status: true } } } });
    const latest = await tx.ohlqAnnualSalesByWholesaleRow.findFirst({ orderBy: { reportDate: 'desc' }, select: { reportDate: true } });
    const items = await tx.ohlqBrandMasterItem.findMany();
    const accountLatest = await tx.ohlqAnnualSalesByWholesaleRow.findFirst({ where: { permitNumber: { contains: '2485275' } }, orderBy: { reportDate: 'desc' }, select: { reportDate: true } });
    const sales = accountLatest ? await tx.ohlqAnnualSalesByWholesaleRow.findMany({ where: { reportDate: accountLatest.reportDate, permitNumber: { contains: '2485275' } } }) : [];
    const masters = new Map(items.map(x => [x.itemCode, x]));
    const ledger = await tx.accountSalesEvent.groupBy({ by: ['organizationId'], _count: true, _min: { reportDate: true }, _max: { reportDate: true } });
    const outcomes = await tx.salesOpportunity.groupBy({ by: ['organizationId', 'status'], _count: true });
    const compact = (code: string) => { const m = masters.get(code); return { code, name: m?.name, category: m?.category, ounces: Number(m?.productVolume), retail: Number(m?.retailPrice), wholesale: Number(m?.wholesalePrice) }; };
    const accountEvents = await tx.accountSalesEvent.findMany({ where: { organizationId: 'org_echo_spirits', wholesaleAccountId: { in: accounts.map(a => a.id) } } });
    const grouped = new Map<string, number>();
    accountEvents.forEach(e => grouped.set(e.itemCode, (grouped.get(e.itemCode) ?? 0) + e.bottles));
    console.log(JSON.stringify({ organizations: organizations.map(o => ({ id: o.id, name: o.displayName })), accounts, latest, accountLatest, sales: sales.map(s => ({ bottles: s.wholesaleBottlesSold, permit: s.permitNumber, ...compact(s.brand) })), observedPurchases: [...grouped].map(([c,bottles]) => ({ ...compact(c), bottles })).sort((a,b) => b.bottles-a.bottles), localItems: items.filter(i => /buckeye vodka|capital city|echo spirits/i.test(i.name) || i.itemCode === '9755L').map(i => compact(i.itemCode)), ledger, outcomes }, null, 2));
  }, { timeout: 60000 });
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
