import fs from 'fs';
import path from 'path';
import { loadLocalEnvironmentFile } from '../lib/environmentFile';
import { importOhlqAgencyInventoryCsv } from '../lib/ohlqAgencyInventoryImport';
import { getOhlqAgencyInventoryObservationDate } from '../lib/ohlqAnnualSalesReport';
import { prisma } from '../lib/prisma';

const getArgValue = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};

async function main() {
  loadLocalEnvironmentFile('.env.local');
  loadLocalEnvironmentFile('.env');
  const inputPath = getArgValue('--file') ?? process.argv[2];
  if (!inputPath) throw new Error('Provide the CSV path with --file <path>.');
  const organizationId = getArgValue('--organization');
  if (!organizationId) throw new Error('Provide the tenant with --organization <organization-id>.');
  const reportDate = getArgValue('--date') ?? getOhlqAgencyInventoryObservationDate();
  const csv = fs.readFileSync(path.resolve(inputPath));
  const result = await importOhlqAgencyInventoryCsv({ csv, organizationId, reportDate });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
