import { appendFileSync } from 'node:fs';
import { loadLocalEnvironmentFile } from '../lib/environmentFile';
import { runOhlqAnnualSalesWorkflow } from '../lib/ohlqAnnualSalesWorkflow';
import { prisma } from '../lib/prisma';
import { runOpportunityIntelligenceAfterImport } from '../lib/opportunityEngine';
import { runAgencyMarketIntelligenceAfterImport } from '../lib/agencyMarketIntelligenceService';
import { OHLQ_PERMANENT_SALES_VENDOR_ID, pruneOhlqAnnualSalesRows } from '../lib/ohlqAnnualSalesRetention';
import { toOhlqDateOnlyUtc } from '../lib/ohlqDataStatus';
import { getOhlqReportStorageDirectories } from '../lib/ohlqReportStorage';
import { resolveOhlqBackfillDates } from '../lib/ohlqLoadDates';

const getArgValue = (name: string) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  if (process.argv.lastIndexOf(name) !== index) throw new Error(`${name} may only be provided once.`);
  return value;
};

async function main() {
  loadLocalEnvironmentFile('.env.local');
  loadLocalEnvironmentFile('.env');

  const explicitDates = getArgValue('--dates');
  const dates = resolveOhlqBackfillDates({
    date: getArgValue('--date'),
    dates: explicitDates,
    days: getArgValue('--days'),
  });
  const importOnly = process.argv.includes('--import-only');
  const intelligenceOnly = process.argv.includes('--intelligence-only');
  if (importOnly && intelligenceOnly) throw new Error('Choose either --import-only or --intelligence-only.');

  if (intelligenceOnly) {
    // Evaluation rebuilds the retained sales ledger. Evaluate once at the latest
    // date after all backfill dates and inventory have loaded, then prune.
    const reportDate = dates.at(-1)!;
    console.log(`Starting post-import opportunity intelligence for ${reportDate}.`);
    const assessmentRefresh = await runOpportunityIntelligenceAfterImport({ reportDate: toOhlqDateOnlyUtc(reportDate) });
    console.log(JSON.stringify(assessmentRefresh));
    console.log(`Full wholesale refresh persisted ${assessmentRefresh.intelligence.persisted} current assessments; no research was requested.`);
    console.log(`Starting post-import Agency market intelligence for ${reportDate}.`);
    console.log(JSON.stringify(await runAgencyMarketIntelligenceAfterImport({ asOfDate: toOhlqDateOnlyUtc(reportDate) })));
    const retention = await pruneOhlqAnnualSalesRows({ reportDate });
    console.log(`OHLQ sales retention preserves Echo vendor ${OHLQ_PERMANENT_SALES_VENDOR_ID} without an age limit; all other vendors use the ${retention.retentionDays}-day window.`);
    console.log(JSON.stringify(retention));
    return;
  }

  const failures: Array<{ reportDate: string; error: unknown }> = [];
  for (const reportDate of dates) {
    console.log(`Starting OHLQ annual sales backfill for ${reportDate}.`);
    try {
      const result = await runOhlqAnnualSalesWorkflow({
        downloadOptions: {
          ...getOhlqReportStorageDirectories(),
          headless: true,
          useServerlessChromium: false,
        },
        reportDate,
        deferIntelligence: importOnly,
      });

      console.log(
        JSON.stringify(
          {
            annualSalesSummary: result.reports.annualSalesSummary,
            annualSalesSummaryByWholesale: result.reports.annualSalesSummaryByWholesale,
            durationMs: result.durationMs,
            ok: result.ok,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      if (!importOnly || explicitDates == null) throw error;
      // Explicit import-only dates are independent. A missing older report must
      // not prevent the newest requested report from being attempted.
      failures.push({ reportDate, error });
      console.error(`OHLQ annual sales import failed for ${reportDate}; continuing the remaining requested dates.`);
    }
  }
  if (failures.length) {
    throw new AggregateError(failures.map(({ error }) => error), `Failed OHLQ report date(s): ${failures.map(({ reportDate }) => reportDate).join(', ')}.`);
  }
  if (importOnly && process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `report_date=${dates.at(-1)}\n`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
