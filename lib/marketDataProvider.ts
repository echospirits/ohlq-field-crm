export type MarketCode = 'OH';

export interface MarketDataProvider {
  market: MarketCode;
  discoverProducts(vendorIds: string[]): Promise<Array<{ externalItemCode: string; name: string }>>;
}

export class OhioOhlqProvider implements MarketDataProvider {
  readonly market = 'OH' as const;
  constructor(private readonly database: Pick<typeof import('./prisma').prisma, 'ohlqAgencyInventoryCurrent'>) {}

  async discoverProducts(vendorIds: string[]) {
    const rows = await this.database.ohlqAgencyInventoryCurrent.findMany({
      where: { vendorId: { in: vendorIds.map((value) => value.trim().toUpperCase()).filter(Boolean) } },
      distinct: ['itemCode'],
      orderBy: { itemCode: 'asc' },
      take: 500,
      select: { itemCode: true, itemName: true },
    });
    return rows.map((row) => ({ externalItemCode: row.itemCode, name: row.itemName }));
  }
}
