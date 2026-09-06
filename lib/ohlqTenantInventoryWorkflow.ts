import os from 'node:os';
import path from 'node:path';
import { OhlqReportDataSource, OhlqReportRunStatus, type PrismaClient } from '@prisma/client';
import { refreshAgencyIntelligence } from './agencyIntelligenceService';
import { importOhlqAgencyInventoryCsv } from './ohlqAgencyInventoryImport';
import { downloadOhlqAgencyInventoryReport, getOhlqAgencyInventoryObservationDate } from './ohlqAnnualSalesReport';
import { getOrganizationOhlqCredentials } from './ohlqTenantCredentials';
import { completeTenantInventoryRun, errorTenantInventoryRun, startTenantInventoryRun } from './ohlqTenantInventoryStatus';
import { prisma } from './prisma';

type Logger = Pick<Console, 'error' | 'log'>;

export async function runOhlqTenantInventoryWorkflow({
  db = prisma,
  logger = console,
}: {
  db?: PrismaClient;
  logger?: Logger;
} = {}) {
  if (!process.env.OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY?.trim()) {
    throw new Error('OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY is required.');
  }

  const reportDate = getOhlqAgencyInventoryObservationDate();
  const organizations = await db.organization.findMany({
    where: { active: true, ohlqCredentials: { isNot: null } },
    orderBy: { id: 'asc' },
    select: {
      displayName: true,
      id: true,
      features: { where: { enabled: true, featureKey: 'AGENCY_INTELLIGENCE' }, select: { id: true } },
    },
  });
  const latestSales = await db.ohlqReportImportStatus.findFirst({
    where: { dataSource: OhlqReportDataSource.ANNUAL_SALES_SUMMARY, status: OhlqReportRunStatus.COMPLETED },
    orderBy: { reportDate: 'desc' },
    select: { reportDate: true },
  });
  const failures: string[] = [];
  let importedRows = 0;

  for (const organization of organizations) {
    await startTenantInventoryRun(organization.id, reportDate, db);
    try {
      const credentials = await getOrganizationOhlqCredentials(organization.id, db);
      if (!credentials) throw new Error('Tenant OHLQ credentials are no longer configured.');
      const download = await downloadOhlqAgencyInventoryReport({
        debugDir: path.join(os.tmpdir(), 'ohlq-playwright', organization.id),
        downloadDir: path.join(os.tmpdir(), 'ohlq-downloads', organization.id),
        headless: true,
        partnerCredentials: credentials,
        reportDate,
        returnBuffer: true,
        useServerlessChromium: process.env.VERCEL === '1',
      });
      if (!download.csvBuffer) throw new Error('Inventory download completed without a CSV buffer.');
      const result = await importOhlqAgencyInventoryCsv({ csv: download.csvBuffer, db, organizationId: organization.id, reportDate: download.reportDate });
      importedRows += result.importedRows;
      await completeTenantInventoryRun(organization.id, download, result, db);
      if (organization.features.length && latestSales) {
        await refreshAgencyIntelligence({ db, inventoryReportDate: new Date(`${download.reportDate}T00:00:00.000Z`), organizationId: organization.id, salesReportDate: latestSales.reportDate });
      }
      logger.log(JSON.stringify({ organizationId: organization.id, inventoryRows: result.importedRows, reportDate: download.reportDate }));
    } catch (error) {
      failures.push(organization.id);
      await errorTenantInventoryRun(organization.id, reportDate, error, db).catch(() => undefined);
      logger.error(`Tenant inventory failed for ${organization.displayName} (${organization.id}): ${error instanceof Error ? error.message : error}`);
    }
  }

  logger.log(`Tenant inventory processed ${organizations.length} configured organization(s).`);
  if (failures.length) throw new Error(`Tenant inventory failed for ${failures.length} organization(s): ${failures.join(', ')}`);
  return { configuredOrganizations: organizations.length, importedRows };
}
