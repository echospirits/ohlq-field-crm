import fs from 'fs';
import path from 'path';
import {
  downloadOhlqAccountMaster,
  downloadOhlqAgencyInventoryReport,
  downloadOhlqAnnualSalesSummary,
  downloadOhlqAnnualSalesSummaryByWholesale,
} from '../lib/ohlqAnnualSalesReport';
import { getOrganizationOhlqCredentials } from '../lib/ohlqTenantCredentials';
import { prisma } from '../lib/prisma';

function loadEnvFile(fileName: string) {
  const envPath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(envPath)) return;

  const contents = fs.readFileSync(envPath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

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

loadEnvFile('.env.local');
loadEnvFile('.env');

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
