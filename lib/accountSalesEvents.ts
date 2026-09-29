import type { PrismaClient } from '@prisma/client';
import { prisma } from './prisma';
import { getOrganizationTenantConfig } from './tenantConfig';
import { buildDailyPurchaseEvents } from './opportunitySalesLedger';

export async function captureWholesaleSalesEvents({ db = prisma, reportDate, organizationId }: { db?: PrismaClient; reportDate: Date; organizationId: string }) {
  const config = await getOrganizationTenantConfig(organizationId, db);
  config.productFilter.mode = 'item-list';
  const [currentRows, accounts, masters] = await Promise.all([
    db.ohlqAnnualSalesByWholesaleRow.findMany({ where: { reportDate } }),
    db.wholesaleAccount.findMany({
      where: { mergedIntoId: null, OR: [{ state: { in: ['OH', 'Ohio'], mode: 'insensitive' } }, { state: null }, { state: '' }] },
      select: { id: true, licenseeId: true, licenseeIds: { select: { licenseeId: true } } },
    }),
    db.ohlqBrandMasterItem.findMany({ select: { itemCode: true, name: true, category: true } }),
  ]);
  const data = buildDailyPurchaseEvents(currentRows, accounts, masters, config);
  let created = 0;
  for (let index = 0; index < data.length; index += 1000) {
    created += (await db.accountSalesEvent.createMany({ skipDuplicates: true, data: data.slice(index, index + 1000) })).count;
  }
  return { created, skippedWithoutBaseline: false };
}
