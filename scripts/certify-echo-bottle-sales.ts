import { downloadOhlqEchoSalesSummaries } from '../lib/ohlqAnnualSalesReport';
import { importOhlqAnnualSalesCsv } from '../lib/ohlqAnnualSalesImport';
import { prisma } from '../lib/prisma';

async function main() {
  const endpoint = new URL(process.env.DATABASE_URL ?? '');
  if (process.env.GITHUB_REPOSITORY !== 'echospirits/ohlq-field-crm' ||
      process.env.APP_ENV !== 'production' || process.env.DATABASE_ENVIRONMENT !== 'production' ||
      !/^ep-proud-recipe-amosj8m9(-pooler)?\.c-5\.us-east-1\.aws\.neon\.tech$/.test(endpoint.hostname) ||
      endpoint.pathname !== '/neondb' || ![null, 'public'].includes(endpoint.searchParams.get('schema'))) {
    throw new Error('Expected the production Neon main database on the hosted runner.');
  }
  const [start, end] = process.argv.slice(2);
  const days = Array.from({ length: 30 }, (_, i) => '2026-09-' + String(i + 1).padStart(2, '0'));
  if (!days.includes(start) || !days.includes(end) || start > end) throw new Error('Expected a September 2026 pilot range.');
  const [identity] = await prisma.$queryRaw<{ db: string; schema: string; primary: boolean }[]>`
    SELECT current_database() db, current_schema() schema, NOT pg_is_in_recovery() AS primary
  `;
  if (identity?.db !== 'neondb' || identity.schema !== 'public' || !identity.primary) {
    throw new Error('Unexpected database session.');
  }
  await downloadOhlqEchoSalesSummaries(days.filter(day => day >= start && day <= end), {
    headless: true, logger: { log() {}, error() {} },
  }, async ({ csvBuffer, summaryNativeExport: native, reportDate }) => {
    if (!csvBuffer || native?.scope !== 'VENDOR_FILTERED') throw new Error('Unverified Echo summary export.');
    const result = await importOhlqAnnualSalesCsv({ csv: csvBuffer, reportDate,
      evidence: { native, requestReference: 'september-reconciliation:' + process.env.GITHUB_RUN_ID } });
    console.log(JSON.stringify({ reportDate, rows: result.importedRows, receipt: 'committed' }));
  });
}

main().catch(() => {
  console.error('Echo September certification failed. Check the last committed date before resuming.');
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
