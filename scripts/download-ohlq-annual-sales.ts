import { loadLocalEnvironmentFile } from '../lib/environmentFile';
import {
  downloadOhlqAccountMaster,
  downloadOhlqAgencyInventoryReport,
  downloadOhlqAnnualSalesSummary,
  downloadOhlqAnnualSalesSummaryByWholesale,
} from '../lib/ohlqAnnualSalesReport';
import { getOrganizationOhlqCredentials } from '../lib/ohlqTenantCredentials';
import { prisma } from '../lib/prisma';

const reportName = process.argv[2] ?? 'summary';
const getArgValue = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};
const downloader =
  reportName === 'account-master'
    ? downloadOhlqAccountMaster
    : reportName === 'inventory'
    ? downloadOhlqAgencyInventoryReport
    : reportName === 'wholesale'
      ? downloadOhlqAnnualSalesSummaryByWholesale
      : downloadOhlqAnnualSalesSummary;

loadLocalEnvironmentFile('.env.local');
loadLocalEnvironmentFile('.env');

async function main() {
  const options = reportName === 'inventory'
    ? await (async () => {
        const organizationId = getArgValue('--organization');
        if (!organizationId) throw new Error('Inventory downloads require --organization <organization-id>.');
        const partnerCredentials = await getOrganizationOhlqCredentials(organizationId);
        if (!partnerCredentials) throw new Error(`Organization ${organizationId} does not have an OHLQ inventory login.`);
        return { partnerCredentials };
      })()
    : {};
  return downloader(options);
}

main()
  .then((result) => {
    console.log(
      JSON.stringify(
        {
          outputPath: result.outputPath,
          reportDate: result.reportDate,
          runDate: result.runDate,
          sizeBytes: result.sizeBytes,
        },
        null,
        2,
      ),
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
