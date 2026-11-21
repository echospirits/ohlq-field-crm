import { downloadOhlqEchoSalesSummaries } from '../lib/ohlqAnnualSalesReport';
import { importOhlqAnnualSalesCsv } from '../lib/ohlqAnnualSalesImport';
import { prisma } from '../lib/prisma';

let stage = 'target';
let activeDate: string | undefined;

async function main() {
  const endpoint = new URL(process.env.DATABASE_URL ?? '');
  if (process.env.GITHUB_REPOSITORY !== 'echospirits/ohlq-field-crm' ||
      process.env.APP_ENV !== 'production' || process.env.DATABASE_ENVIRONMENT !== 'production' ||
      !/^ep-proud-recipe-amosj8m9(-pooler)?\.c-5\.us-east-1\.aws\.neon\.tech$/.test(endpoint.hostname) ||
      endpoint.pathname !== '/neondb' || ![null, 'public'].includes(endpoint.searchParams.get('schema'))) {
    throw new Error('Expected the production Neon main database on the hosted runner.');
  }
  const [start, end, ...extra] = process.argv.slice(2);
  const parseDate = (value: string) => {
    const millis = Date.parse(value + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(millis) ||
        new Date(millis).toISOString().slice(0, 10) !== value) throw new Error('Invalid report date.');
    return millis;
  };
  const first = parseDate(start);
  const last = parseDate(end);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', dateStyle: 'short' }).format(new Date());
  if (extra.length || start < '2019-09-01' || start > end || end >= today) {
    throw new Error('Expected an explicit historical date range within the approved history.');
  }
  const days = Array.from({ length: (last - first) / 86400000 + 1 }, (_, i) =>
    new Date(first + i * 86400000).toISOString().slice(0, 10));
  const [identity] = await prisma.$queryRaw<{ db: string; schema: string; primary: boolean }[]>`
    SELECT current_database() db, current_schema() schema, NOT pg_is_in_recovery() AS primary
  `;
  if (identity?.db !== 'neondb' || identity.schema !== 'public' || !identity.primary) {
    throw new Error('Unexpected database session.');
  }
  stage = 'download';
  await downloadOhlqEchoSalesSummaries(days, {
    headless: true, logger: { log() {}, error() {} },
    onDiagnostic: diagnostic => { if (typeof diagnostic.stage === 'string') stage = diagnostic.stage; },
  }, async ({ csvBuffer, summaryNativeExport: native, reportDate }) => {
    stage = 'validated-export';
    activeDate = reportDate;
    if (!csvBuffer || !native) throw new Error('Unverified Echo summary export.');
    const result = await importOhlqAnnualSalesCsv({ csv: csvBuffer, reportDate,
      echoOnly: true, evidence: { native, requestReference: 'echo-history:' + process.env.GITHUB_RUN_ID } });
    console.log(JSON.stringify({ reportDate, rows: result.importedRows, receipt: 'committed' }));
    stage = 'download';
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  const safeReason = /^(Duplicate OHLQ sales summary source key\.|Invalid signed integer in OHLQ sales summary\.|Incomplete or incorrectly scoped Annual Sales Summary\.|Incomplete sales summary insert\.|Persisted Echo sales do not match the validated source\.|Stale or unordered conflicting Echo sales source\.|Missing verified statewide Annual Sales Summary evidence\.|OHLQ did not confirm the exact Echo vendor\.)$/.test(message)
    ? message : undefined;
  const code = error && typeof error === 'object' && 'code' in error && /^P\d{4}$/.test(String(error.code))
    ? String(error.code) : undefined;
  const sqlState = error && typeof error === 'object' && 'meta' in error && error.meta &&
    typeof error.meta === 'object' && 'code' in error.meta && /^[0-9A-Z]{5}$/.test(String(error.meta.code))
    ? String(error.meta.code) : undefined;
  console.error(JSON.stringify({ stage, activeDate, safeReason, code, sqlState, timeout: error instanceof Error && error.name === 'TimeoutError' }));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
