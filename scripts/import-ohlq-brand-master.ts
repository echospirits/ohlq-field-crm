import { readFile } from 'node:fs/promises';
import { importOhlqBrandMasterCsv } from '../lib/ohlqBrandMasterImport';
import { prisma } from '../lib/prisma';

async function main() {
  const filePath = process.argv[2] ?? process.env.OHLQ_BRAND_MASTER_CSV;

  if (!filePath) {
    throw new Error('Usage: npm run import:ohlq-brand-master -- <path-to-brand-master.csv>');
  }

  const csv = await readFile(filePath);
  const result = await importOhlqBrandMasterCsv({ csv });

  console.log(
    [
      'OHLQ brand master import complete.',
      `Imported: ${result.importedRows}.`,
      `Replaced: ${result.deletedRows}.`,
      `Parsed: ${result.parsedRows}.`,
      `Skipped: ${result.skippedRows}.`,
    ].join(' '),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
