import fs from 'node:fs';
import path from 'node:path';
import { validateRuntimeEnvironment } from '../../lib/appEnvironment';

const VENDOR = 'Z90399001';
const PRODUCTION_REPO = 'echospirits/ohlq-field-crm';
const MAIN_DATABASE = 'neondb';
const MAIN_COMPUTE_HOST = 'ep-proud-recipe-amosj8m9.c-5.us-east-1.aws.neon.tech';
const MAIN_POOLER_HOST = 'ep-proud-recipe-amosj8m9-pooler.c-5.us-east-1.aws.neon.tech';
const SUMMARY_ID = '9781fc23-73de-4ee8-b0b8-77ae6f9b7c4e';
const WHOLESALE_ID = 'dea7572c-2ea4-45bb-bbbc-29600bd326cc';
const EMPTY_MESSAGE = 'No data meets the criteria that the user has selected';

type ProviderReceipt = {
  fromDate: string;
  toDate: string;
  scope: 'echo-only';
  source: string;
  vendor: typeof VENDOR;
  capturedAt: string;
  complete: true;
};

type ProviderCapture =
  | { kind: 'empty'; receipt: ProviderReceipt & { noDataMessage: string } }
  | { kind: 'csv'; csv: Buffer; receipt: ProviderReceipt & { sha256: string; bytes: number } };

type RunProvider = (
  dates: readonly string[],
  scratch: string,
  receive: (date: string, summary: ProviderCapture, wholesale: ProviderCapture) => Promise<void>,
  progress: (date: string, stage: string) => void,
) => Promise<void>;

type PilotMode = 'observe' | 'apply';

export function readPilotArgs(args: readonly string[]) {
  const [action, from, to] = args;
  const septDate = /^2026-09-(?:0[1-9]|[12][0-9]|30)$/;
  if (args.length !== 3 || (action !== '--observe' && action !== '--apply') ||
      !septDate.test(from) || !septDate.test(to) || from > to) {
    throw new Error('Pass --observe or --apply and an inclusive, ascending September 2026 date range.');
  }
  const mode: PilotMode = action === '--observe' ? 'observe' : 'apply';
  const fromDay = Number(from.slice(-2));
  const toDay = Number(to.slice(-2));
  const dates = Array.from({ length: toDay - fromDay + 1 }, (_, index) =>
    '2026-09-' + String(fromDay + index).padStart(2, '0'));
  return { mode, dates };
}

export function assertMainJob(environment: NodeJS.ProcessEnv) {
  if (environment.GITHUB_ACTIONS !== 'true' || environment.GITHUB_REPOSITORY !== PRODUCTION_REPO ||
      environment.APP_ENV !== 'production' || environment.DATABASE_ENVIRONMENT !== 'production' ||
      environment.VERCEL === '1') {
    throw new Error('Run this pilot only from the production repository’s GitHub Actions environment.');
  }
  const target = new URL(environment.DATABASE_URL ?? '');
  if ((target.protocol !== 'postgresql:' && target.protocol !== 'postgres:') ||
      ![MAIN_COMPUTE_HOST, MAIN_POOLER_HOST].includes(target.hostname) ||
      target.pathname !== '/' + MAIN_DATABASE || ![null, 'public'].includes(target.searchParams.get('schema'))) {
    throw new Error('The database URL does not match the production Neon main endpoint and database.');
  }
  validateRuntimeEnvironment(environment);
  if (!environment.RUNNER_TEMP) throw new Error('The hosted runner temporary directory is unavailable.');
}

function assertReport(capture: ProviderCapture, date: string, reportId: string) {
  const { receipt } = capture;
  const source = new URL(receipt.source);
  if (receipt.vendor !== VENDOR || receipt.scope !== 'echo-only' || receipt.complete !== true ||
      receipt.fromDate !== date || receipt.toDate !== date || !Number.isFinite(Date.parse(receipt.capturedAt)) ||
      source.protocol !== 'https:' || source.hostname !== 'app.powerbigov.us' || source.username || source.password ||
      !source.pathname.endsWith('/rdlreports/' + reportId)) {
    throw new Error('The capture does not prove the exact OHLQ report, date and Echo scope.');
  }
  if (capture.kind === 'empty' && capture.receipt.noDataMessage !== EMPTY_MESSAGE) {
    throw new Error('No-data proof is missing from the report.');
  }
  if (capture.kind === 'csv' && (!capture.csv.length || capture.receipt.bytes !== capture.csv.length)) {
    throw new Error('The native report length does not match the source receipt.');
  }
}

function prepareGeneratedReportModule() {
  const generated = path.join(__dirname, 'hosted-report-runtime.generated.ts');
  const productionSourcePath = path.resolve(__dirname, '../../lib/ohlqAnnualSalesReport.ts');
  const base = fs.readFileSync(productionSourcePath, 'utf8')
    .replace(/from (['"])\.\//g, (_, quote: string) => 'from ' + quote + '../../lib/');
  const extensionPath = fs.existsSync(path.join(__dirname, 'report-extension.txt'))
    ? path.join(__dirname, 'report-extension.txt')
    : path.join(__dirname, 'hosted-pilot-report-extension.txt');
  const extension = fs.readFileSync(extensionPath, 'utf8');
  fs.writeFileSync(generated, base + '\n' + extension, { flag: 'wx', mode: 0o600 });
  return generated;
}

async function runPilot(args: string[]) {
  let at = { date: '', step: 'arguments' };
  try {
    const { mode, dates } = readPilotArgs(args);
    at = { date: dates[0], step: 'production-target' };
    assertMainJob(process.env);
    const scratchRoot = process.env.RUNNER_TEMP!;
    const scratch = fs.mkdtempSync(path.join(scratchRoot, 'echo-september-pilot-'));
    const receiptDir = path.join(scratchRoot, 'echo-september-pilot-receipts');
    fs.mkdirSync(receiptDir, { recursive: true, mode: 0o700 });
    const receiptFile = path.join(receiptDir, 'dates.jsonl');

    const { prisma } = await import('../../lib/prisma');
    const { prepareEchoSalesSummary, prepareEchoSalesWholesale, importPreparedEchoSalesDay } = await import('./import');
    try {
      const [target] = await prisma.$queryRawUnsafe<Array<{ database: string; schema: string; inRecovery: boolean }>>(
        'SELECT current_database() AS "database", current_schema() AS "schema", pg_is_in_recovery() AS "inRecovery"',
      );
      if (target?.database !== MAIN_DATABASE || target.schema !== 'public' || target.inRecovery) {
        throw new Error('The database session is not connected to the production primary.');
      }

      const generated = prepareGeneratedReportModule();
      try {
        const { downloadEchoSeptemberPilot } = (await import(generated)) as { downloadEchoSeptemberPilot: RunProvider };
        const jobSummary = process.env.GITHUB_STEP_SUMMARY;
        if (jobSummary) fs.appendFileSync(jobSummary,
          '# Echo Spirits September 2026 pilot\n\n' +
          'Production Neon main · Vendor Z90399001 · ' + mode + '\n\n' +
          '| Date | Summary rows | Wholesale detail rows | Summary inserted | Wholesale inserted |\n' +
          '| --- | ---: | ---: | ---: | ---: |\n');
        await downloadEchoSeptemberPilot(dates, scratch, async (date, summary, wholesale) => {
          assertReport(summary, date, SUMMARY_ID);
          assertReport(wholesale, date, WHOLESALE_ID);
          const summaryRows = summary.kind === 'empty' ? [] :
            prepareEchoSalesSummary({ csv: summary.csv, evidence: summary.receipt }, date).rows;
          const wholesaleRows = wholesale.kind === 'empty' ? [] :
            prepareEchoSalesWholesale({ csv: wholesale.csv, evidence: wholesale.receipt }, date).rows;
          at = { date, step: mode === 'apply' ? 'commit-pair' : 'verify-only' };
          const result = mode === 'apply'
            ? await importPreparedEchoSalesDay({ db: prisma, reportDate: date, summaryRows, wholesaleRows })
            : { summaryRows: summaryRows.length, wholesaleRows: wholesaleRows.length, summaryInserted: 0, wholesaleInserted: 0 };
          const receipt = {
            mode,
            reportDate: date,
            vendor: VENDOR,
            databaseTarget: 'production-neon-main',
            summary: summary.receipt,
            wholesale: wholesale.receipt,
            ...result,
            recordedAt: new Date().toISOString(),
          };
          fs.appendFileSync(receiptFile, JSON.stringify(receipt) + '\n', { mode: 0o600 });
          if (jobSummary) fs.appendFileSync(jobSummary,
            '| ' + date + ' | ' + result.summaryRows + ' | ' + result.wholesaleRows +
            ' | ' + result.summaryInserted + ' | ' + result.wholesaleInserted + ' |\n');
          console.log(JSON.stringify({
            reportDate: date, vendor: VENDOR, action: mode === 'apply' ? 'verified-and-committed' : 'verified-without-writes', ...result,
          }));
        }, (date, step) => {
          at = { date, step };
          console.log(JSON.stringify({ reportDate: date, step }));
        });
      } finally {
        fs.unlinkSync(generated);
      }
    } finally {
      await prisma.$disconnect();
    }
  } catch {
    // Browser and database library messages can contain credentials, request
    // metadata or source rows. Keep the hosted log limited to safe stage data.
    console.error(JSON.stringify({ status: 'failed', reportDate: at.date, step: at.step }));
    process.exitCode = 1;
  }
}

if (require.main === module) void runPilot(process.argv.slice(2));
