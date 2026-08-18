import { OhlqReportDataSource, OhlqReportRunStatus } from '@prisma/client';
import { refreshAgencyIntelligence } from '../lib/agencyIntelligenceService';
import { prisma } from '../lib/prisma';

async function main() {
  const completed = await prisma.ohlqReportImportStatus.findMany({
    where: { status: OhlqReportRunStatus.COMPLETED },
    orderBy: { reportDate: 'desc' },
    select: { dataSource: true, reportDate: true },
  });
  const annualDates = new Set(
    completed
      .filter((row) => row.dataSource === OhlqReportDataSource.ANNUAL_SALES_SUMMARY)
      .map((row) => row.reportDate.toISOString().slice(0, 10)),
  );
  const salesReportDate = completed.find((row) =>
    row.dataSource === OhlqReportDataSource.ANNUAL_SALES_SUMMARY_BY_WHOLESALE &&
    annualDates.has(row.reportDate.toISOString().slice(0, 10)),
  )?.reportDate;
  const inventoryReportDate = completed.find((row) =>
    row.dataSource === OhlqReportDataSource.AGENCY_INVENTORY_REPORT,
  )?.reportDate;

  if (!salesReportDate || !inventoryReportDate) {
    throw new Error('No complete matching sales and inventory inputs are available for Agency intelligence.');
  }

  const result = await refreshAgencyIntelligence({ inventoryReportDate, salesReportDate });
  console.log(JSON.stringify({ inventoryReportDate, salesReportDate, ...result }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
