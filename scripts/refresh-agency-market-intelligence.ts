import { OhlqReportDataSource, OhlqReportRunStatus } from '@prisma/client';
import { refreshAgencyMarketIntelligence } from '../lib/agencyMarketIntelligenceService';
import { ECHO_ORGANIZATION_ID } from '../lib/organizations';
import { prisma } from '../lib/prisma';

async function main() {
  const latestSales = await prisma.ohlqReportImportStatus.findFirst({
    where: {
      dataSource: OhlqReportDataSource.ANNUAL_SALES_SUMMARY,
      status: OhlqReportRunStatus.COMPLETED,
    },
    orderBy: { reportDate: 'desc' },
    select: { reportDate: true },
  });
  if (!latestSales) throw new Error('No completed Agency retail-sales import is available.');

  const organizationId = process.argv[2] || ECHO_ORGANIZATION_ID;
  const result = await refreshAgencyMarketIntelligence({
    asOfDate: latestSales.reportDate,
    organizationId,
  });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
