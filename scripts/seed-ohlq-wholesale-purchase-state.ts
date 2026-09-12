import os from 'os';
import path from 'path';
import { loadLocalEnvironmentFile } from '../lib/environmentFile';
import { syncOhlqAnnualSalesByWholesalePurchaseStateCsv } from '../lib/ohlqAnnualSalesImport';
import {
  downloadOhlqAnnualSalesSummaryByWholesale,
  getOhlqAnnualSalesReportDate,
} from '../lib/ohlqAnnualSalesReport';
import { syncOhlqWholesaleReactivationWorklist } from '../lib/ohlqWholesaleReactivation';
import { prisma } from '../lib/prisma';

const easternTimeZone = 'America/New_York';

const getArgValue = (name: string) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] ?? null;
};

const hasFlag = (name: string) => process.argv.includes(name);

const assertIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Expected YYYY-MM-DD date, received: ${value}`);
  }

  return value;
};

const formatIsoDate = (date: Date) => date.toISOString().slice(0, 10);

const addUtcDays = (isoDate: string, days: number) => {
  const [year, month, day] = isoDate.split('-').map(Number);
  return formatIsoDate(new Date(Date.UTC(year, month - 1, day + days, 12)));
};

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

const getDateRange = (from: string, to: string) => {
  const dates: string[] = [];
  for (let date = assertIsoDate(from); date <= to; date = addUtcDays(date, 1)) {
    dates.push(date);
  }

  return dates;
};

const getReportDates = () => {
  const explicitDate = getArgValue('--date');
  const from = getArgValue('--from');
  const to = getArgValue('--to');

  if (explicitDate) return [getOhlqAnnualSalesReportDate(assertIsoDate(explicitDate)).iso];

  if (from || to) {
    if (!from || !to) throw new Error('Use both --from and --to when seeding a date range.');
    const rangeStart = getOhlqAnnualSalesReportDate(assertIsoDate(from)).iso;
    const rangeEnd = getOhlqAnnualSalesReportDate(assertIsoDate(to)).iso;
    if (rangeStart > rangeEnd) throw new Error('--from must be on or before --to.');
    return getDateRange(rangeStart, rangeEnd);
  }

  const days = Number(getArgValue('--days') ?? '90');
  if (!Number.isInteger(days) || days < 1 || days > 120) {
    throw new Error('--days must be a whole number between 1 and 120.');
  }

  return getLastCompleteReportDates(days);
};

async function main() {
  loadLocalEnvironmentFile('.env.local');
  loadLocalEnvironmentFile('.env');

  const reportDates = getReportDates();
  const skipReactivationSync = hasFlag('--skip-reactivation-sync');
  const headless = process.env.OHLQ_HEADLESS !== '0';
  const debugDir = process.env.VERCEL
    ? path.join(os.tmpdir(), 'ohlq-playwright')
    : path.join(process.cwd(), 'output', 'playwright');
  const downloadDir = process.env.VERCEL
    ? path.join(os.tmpdir(), 'ohlq-downloads')
    : path.join(process.cwd(), 'output', 'ohlq-downloads');

  console.log(
    `Starting OHLQ wholesale purchase-state seed for ${reportDates.length} report date(s): ${reportDates.join(', ')}.`,
  );

  const totals = {
    matchedPermitNumbers: 0,
    parsedRows: 0,
    skippedRows: 0,
    unmatchedPermitNumbers: new Set<string>(),
    updatedAccounts: 0,
  };

  for (const reportDate of reportDates) {
    console.log(`Downloading OHLQ Annual Sales Summary by Wholesale for ${reportDate}.`);
    const download = await downloadOhlqAnnualSalesSummaryByWholesale({
      debugDir,
      downloadDir,
      headless,
      reportDate,
      returnBuffer: true,
      useServerlessChromium: process.env.VERCEL === '1',
    });

    if (!download.csvBuffer) {
      throw new Error(`OHLQ wholesale report ${reportDate} downloaded without a CSV buffer.`);
    }

    const result = await syncOhlqAnnualSalesByWholesalePurchaseStateCsv({
      csv: download.csvBuffer,
      reportDate,
    });

    totals.matchedPermitNumbers += result.echoPurchaseState.matchedPermitNumbers;
    totals.parsedRows += result.parsedRows;
    totals.skippedRows += result.skippedRows;
    totals.updatedAccounts += result.echoPurchaseState.updatedAccounts;
    result.echoPurchaseState.unmatchedPermitNumbers.forEach((permitNumber) =>
      totals.unmatchedPermitNumbers.add(permitNumber),
    );

    console.log(
      JSON.stringify(
        {
          matchedPermitNumbers: result.echoPurchaseState.matchedPermitNumbers,
          parsedRows: result.parsedRows,
          reportDate,
          skippedRows: result.skippedRows,
          unmatchedPermitNumbers: result.echoPurchaseState.unmatchedPermitNumbers.length,
          updatedAccounts: result.echoPurchaseState.updatedAccounts,
        },
        null,
        2,
      ),
    );
  }

  const wholesaleReactivation = skipReactivationSync
    ? null
    : await syncOhlqWholesaleReactivationWorklist();

  console.log(
    JSON.stringify(
      {
        ok: true,
        reportDates,
        totals: {
          matchedPermitNumbers: totals.matchedPermitNumbers,
          parsedRows: totals.parsedRows,
          skippedRows: totals.skippedRows,
          unmatchedPermitNumbers: totals.unmatchedPermitNumbers.size,
          updatedAccounts: totals.updatedAccounts,
        },
        wholesaleReactivation,
      },
      null,
      2,
    ),
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
