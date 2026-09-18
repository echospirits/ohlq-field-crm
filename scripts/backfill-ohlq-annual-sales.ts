import path from 'path';
import { appendFileSync } from 'node:fs';
import { loadLocalEnvironmentFile } from '../lib/environmentFile';
import { runOhlqAnnualSalesWorkflow } from '../lib/ohlqAnnualSalesWorkflow';
import { prisma } from '../lib/prisma';
import { runOpportunityIntelligenceAfterImport } from '../lib/opportunityEngine';
import { runAgencyMarketIntelligenceAfterImport } from '../lib/agencyMarketIntelligenceService';
import { pruneOhlqAnnualSalesRows } from '../lib/ohlqAnnualSalesRetention';
import { toOhlqDateOnlyUtc } from '../lib/ohlqDataStatus';

const easternTimeZone = 'America/New_York';

const getArgValue = (name: string) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
};

const formatIsoDate = (date: Date) => date.toISOString().slice(0, 10);

const todayInEastern = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone: easternTimeZone,
    year: 'numeric',
  }).formatToParts(new Date());

  const value = (type: Intl.DateTimeFormatPartTypes) => {
    const part = parts.find((item) => item.type === type)?.value;
    if (!part) throw new Error(`Unable to resolve Eastern date part: ${type}`);
    return Number(part);
  };

  return {
    day: value('day'),
    month: value('month'),
    year: value('year'),
  };
};

const getLastCompleteReportDates = (days: number) => {
  const today = todayInEastern();

  return Array.from({ length: days }, (_, index) => {
    const offset = days - index;
    return formatIsoDate(new Date(Date.UTC(today.year, today.month - 1, today.day - offset, 12)));
  });
};

const assertIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Expected YYYY-MM-DD date, received: ${value}`);
  }

  return value;
};

async function main() {
  loadLocalEnvironmentFile('.env.local');
  loadLocalEnvironmentFile('.env');

  const explicitDate = getArgValue('--date');
  const days = Number(getArgValue('--days') ?? '7');
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('--days must be between 1 and 30.');
  const dates = explicitDate ? [assertIsoDate(explicitDate)] : getLastCompleteReportDates(days);
  const importOnly = process.argv.includes('--import-only');
  const intelligenceOnly = process.argv.includes('--intelligence-only');
  if (importOnly && intelligenceOnly) throw new Error('Choose either --import-only or --intelligence-only.');

  if (intelligenceOnly) {
    // Evaluation rebuilds the retained sales ledger. Evaluate once at the latest
    // date after all backfill dates and inventory have loaded, then prune.
    const reportDate = dates.at(-1)!;
    console.log(`Starting post-import opportunity intelligence for ${reportDate}.`);
    console.log(JSON.stringify(await runOpportunityIntelligenceAfterImport({ reportDate: toOhlqDateOnlyUtc(reportDate) })));
    console.log(`Starting post-import Agency market intelligence for ${reportDate}.`);
    console.log(JSON.stringify(await runAgencyMarketIntelligenceAfterImport({ asOfDate: toOhlqDateOnlyUtc(reportDate) })));
    console.log(JSON.stringify(await pruneOhlqAnnualSalesRows({ reportDate })));
    return;
  }

  for (const reportDate of dates) {
    console.log(`Starting OHLQ annual sales backfill for ${reportDate}.`);
    const result = await runOhlqAnnualSalesWorkflow({
      downloadOptions: {
        debugDir: path.join(process.cwd(), 'output', 'playwright'),
        downloadDir: path.join(process.cwd(), 'output', 'ohlq-downloads'),
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
