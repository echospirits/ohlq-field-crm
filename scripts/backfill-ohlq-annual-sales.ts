import fs from 'fs';
import path from 'path';
import { runOhlqAnnualSalesWorkflow } from '../lib/ohlqAnnualSalesWorkflow';
import { prisma } from '../lib/prisma';

const easternTimeZone = 'America/New_York';

function loadEnvFile(fileName: string) {
  const envPath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(envPath)) return;

  const contents = fs.readFileSync(envPath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

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
  loadEnvFile('.env.local');
  loadEnvFile('.env');

  const explicitDate = getArgValue('--date');
  const days = Number(getArgValue('--days') ?? '7');
  const dates = explicitDate ? [assertIsoDate(explicitDate)] : getLastCompleteReportDates(days);

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
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
