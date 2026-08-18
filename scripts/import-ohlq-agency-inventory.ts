import fs from 'fs';
import path from 'path';
import { importOhlqAgencyInventoryCsv } from '../lib/ohlqAgencyInventoryImport';
import { getOhlqAgencyInventoryObservationDate } from '../lib/ohlqAnnualSalesReport';
import { prisma } from '../lib/prisma';

function loadEnvFile(fileName: string) {
  const envPath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

const getArgValue = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};

async function main() {
  loadEnvFile('.env.local');
  loadEnvFile('.env');
  const inputPath = getArgValue('--file') ?? process.argv[2];
  if (!inputPath) throw new Error('Provide the CSV path with --file <path>.');
  const reportDate = getArgValue('--date') ?? getOhlqAgencyInventoryObservationDate();
  const csv = fs.readFileSync(path.resolve(inputPath));
  const result = await importOhlqAgencyInventoryCsv({ csv, reportDate });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
