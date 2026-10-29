import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { validateRuntimeEnvironment } from '../lib/appEnvironment';

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

/** Hosted acceptance only: read TST configuration, download, validate, discard.
 * Never import source facts, refresh forecasts, or repair credentials. */
async function main() {
  const runtime = validateRuntimeEnvironment();
  if (argument('--environment') !== 'test' || runtime.appEnvironment !== 'test'
    || process.env.DATABASE_TARGET_ID !== 'neon-neat-tst'
    || process.env.GITHUB_REPOSITORY !== 'echospirits/neat-tst'
    || process.env.GITHUB_REF !== 'refs/heads/tst') {
    throw new Error('validation-target');
  }
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp || !path.isAbsolute(runnerTemp)) throw new Error('validation-storage');
  const temporaryRoot = path.resolve(runnerTemp);
  const privateDirectory = mkdtempSync(path.join(temporaryRoot, 'neat-source-validation-'));
  if (!privateDirectory.startsWith(`${temporaryRoot}${path.sep}`)) throw new Error('validation-storage');

  const { PrismaClient } = await import('@prisma/client');
  const { ECHO_ORGANIZATION_ID } = await import('../lib/echoAccess');
  const { getOrganizationOhlqCredentials } = await import('../lib/ohlqTenantCredentials');
  const { downloadOhlqBailmentInvoices, downloadOhlqPartnerDc } = await import('../lib/ohlqAnnualSalesReport');
  const { forecastAccess, parseProductionSource } = await import('../lib/productionForecasting/import');
  const { normalizeNativeOhio, ohioItemContext } = await import('../lib/productionForecasting/ohio');
  const { ohioSourceConfiguration } = await import('../lib/productionForecasting/sourceWorkflow');
  const { formatDateInputValue } = await import('../lib/dateTime');
  const { shift } = await import('../lib/productionForecasting/model');
  const db = new PrismaClient();
  try {
    // A server-enforced read-only transaction bounds every database operation.
    // The browser work starts only after the transaction has closed.
    const { organization, credentials, context } = await db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const organization = await forecastAccess(tx, ECHO_ORGANIZATION_ID);
      if (!organization.enabledStates.includes('OH')) throw new Error('validation-market');
      const credentials = await getOrganizationOhlqCredentials(ECHO_ORGANIZATION_ID, tx as unknown as PrismaClient);
      if (!credentials) throw new Error('validation-credentials');
      const context = await ohioItemContext(tx, ECHO_ORGANIZATION_ID);
      return { organization, credentials, context };
    }, { timeout: 30000 });
    const today = formatDateInputValue(new Date(), organization.timezone);
    const through = shift(today, -1);
    const configuration = ohioSourceConfiguration(organization.settings);
    let failures = 0;

    for (const source of ['BAILMENT_PO_INVOICE', 'DISTRIBUTION_CENTER'] as const) {
      let phase = 'configuration';
      try {
        if (source === 'BAILMENT_PO_INVOICE' && (!configuration.historyStart
          || !configuration.directInvoices || configuration.historyStart > through)) {
          throw new Error('validation-source-policy');
        }
        const options = {
          headless: true,
          returnBuffer: true,
          partnerCredentials: credentials,
          reportDate: today,
          debugDir: path.join(privateDirectory, source, 'screenshots'),
          downloadDir: path.join(privateDirectory, source, 'downloads'),
          useServerlessChromium: false,
          logger: { log: () => undefined, error: () => undefined },
          onDiagnostic: (diagnostic: Record<string, string | number | boolean | null>) => {
            console.log(JSON.stringify({ source, status: 'diagnostic', diagnostic }));
          },
        };
        phase = 'download';
        const download = source === 'BAILMENT_PO_INVOICE'
          ? await downloadOhlqBailmentInvoices({ ...options, fromDate: configuration.historyStart! })
          : await downloadOhlqPartnerDc(options);
        phase = 'validation';
        if (!download.csvBuffer || download.reportDate !== today) throw new Error('validation-current-source');
        const csv = download.csvBuffer.toString('utf8');
        const start = source === 'BAILMENT_PO_INVOICE' ? configuration.historyStart! : today;
        const end = source === 'BAILMENT_PO_INVOICE' ? through : today;
        const nativeHistory = source === 'BAILMENT_PO_INVOICE'
          ? { fullPortfolio: true, directInvoices: configuration.directInvoices! } : undefined;
        const native = normalizeNativeOhio(csv, source, context, { start, end, ...nativeHistory });
        if (!native) throw new Error('validation-native-source');
        const parsed = parseProductionSource(native.csv, {
          organizationId: ECHO_ORGANIZATION_ID, market: 'OH', source, start, end,
          observedOn: today, complete: true, ...(nativeHistory ? { nativeHistory } : {}),
        });
        console.log(JSON.stringify({ source, status: 'validated', rows: parsed.rows.length,
          excludedRows: parsed.excludedRows, outsidePortfolioRows: native.outOfScopeRows,
          outsideWindowRows: native.outsideWindowRows, directRows: native.directRows,
          reportDate: today, databaseWrites: 0 }));
      } catch {
        failures++;
        // Provider exceptions may contain private page text or screenshot paths.
        console.error(JSON.stringify({ source, status: 'failed', phase, databaseWrites: 0 }));
      }
    }
    console.log(JSON.stringify({ status: failures ? 'failed' : 'validated', sources: 2,
      failedSources: failures, environment: 'test', databaseTarget: 'neon-neat-tst', databaseWrites: 0 }));
    if (failures) process.exitCode = 1;
  } finally {
    await db.$disconnect();
    // This exact generated child was verified against RUNNER_TEMP before use.
    rmSync(privateDirectory, { recursive: true, force: true });
  }
}

main().catch(() => {
  console.error(JSON.stringify({ status: 'failed', phase: 'validation-setup', databaseWrites: 0 }));
  process.exitCode = 1;
});
