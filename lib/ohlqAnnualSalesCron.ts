import {
  OhlqReportRunStatus,
  type OhlqReportDataSource,
  type OhlqReportImportStatus,
  type PrismaClient,
} from '@prisma/client';
import { prisma } from './prisma';
import {
  formatOhlqDate,
  OHLQ_DATA_SOURCE_CONFIGS,
  toOhlqDateOnlyUtc,
} from './ohlqDataStatus';

export const OHLQ_CRON_TIME_ZONE = 'America/New_York';
export const DEFAULT_OHLQ_CRON_CATCHUP_DAYS = 3;
export const DEFAULT_OHLQ_CRON_MAX_REPORT_DATES = 2;
export const DEFAULT_OHLQ_CRON_REFRESH_DAYS = 2;

type ImportStatusSnapshot = Pick<OhlqReportImportStatus, 'dataSource' | 'reportDate' | 'status'>;

const requiredSources = OHLQ_DATA_SOURCE_CONFIGS.map((config) => config.source);

function parsePositiveInteger(rawValue: string | undefined | null, fallback: number, { max }: { max: number }) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export function getOhlqCronCatchupDays(rawValue: string | null | undefined = process.env.OHLQ_CRON_CATCHUP_DAYS) {
  return parsePositiveInteger(rawValue, DEFAULT_OHLQ_CRON_CATCHUP_DAYS, { max: 14 });
}

export function getOhlqCronMaxReportDates(rawValue: string | null | undefined = process.env.OHLQ_CRON_MAX_REPORT_DATES) {
  return parsePositiveInteger(rawValue, DEFAULT_OHLQ_CRON_MAX_REPORT_DATES, { max: 5 });
}

export function getOhlqCronRefreshDays(rawValue: string | null | undefined = process.env.OHLQ_CRON_REFRESH_DAYS) {
  return parsePositiveInteger(rawValue, DEFAULT_OHLQ_CRON_REFRESH_DAYS, { max: 5 });
}

function getEasternDateIso(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone: OHLQ_CRON_TIME_ZONE,
    year: 'numeric',
  }).formatToParts(now);

  const value = (type: Intl.DateTimeFormatPartTypes) => {
    const part = parts.find((item) => item.type === type)?.value;
    if (!part) throw new Error(`Unable to resolve Eastern date part: ${type}`);
    return part;
  };

  return `${value('year')}-${value('month')}-${value('day')}`;
}

function addDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return formatOhlqDate(date);
}

export function getOhlqCronCandidateReportDates(now = new Date(), catchupDays = getOhlqCronCatchupDays()) {
  const yesterday = addDays(getEasternDateIso(now), -1);

  return Array.from({ length: catchupDays }, (_, index) => addDays(yesterday, -index));
}

export function getOhlqCronReportDatesToRefresh(now = new Date(), refreshDays = getOhlqCronRefreshDays()) {
  return getOhlqCronCandidateReportDates(now, refreshDays);
}

export function selectOhlqCronReportDatesNeedingImport({
  candidateReportDates,
  maxReportDates,
  statuses,
}: {
  candidateReportDates: string[];
  maxReportDates: number;
  statuses: ImportStatusSnapshot[];
}) {
  const completedSourcesByDate = new Map<string, Set<OhlqReportDataSource>>();

  for (const status of statuses) {
    if (status.status !== OhlqReportRunStatus.COMPLETED) continue;

    const reportDate = formatOhlqDate(status.reportDate);
    const completedSources = completedSourcesByDate.get(reportDate) ?? new Set<OhlqReportDataSource>();
    completedSources.add(status.dataSource);
    completedSourcesByDate.set(reportDate, completedSources);
  }

  return candidateReportDates
    .filter((reportDate) => {
      const completedSources = completedSourcesByDate.get(reportDate);
      return requiredSources.some((source) => !completedSources?.has(source));
    })
    .slice(0, maxReportDates);
}

export async function getOhlqCronReportDatesToRun({
  catchupDays = getOhlqCronCatchupDays(),
  db = prisma,
  maxReportDates = getOhlqCronMaxReportDates(),
  now = new Date(),
}: {
  catchupDays?: number;
  db?: PrismaClient;
  maxReportDates?: number;
  now?: Date;
} = {}) {
  const candidateReportDates = getOhlqCronCandidateReportDates(now, catchupDays);
  const statuses = await db.ohlqReportImportStatus.findMany({
    select: {
      dataSource: true,
      reportDate: true,
      status: true,
    },
    where: {
      reportDate: {
        in: candidateReportDates.map(toOhlqDateOnlyUtc),
      },
    },
  });

  return selectOhlqCronReportDatesNeedingImport({
    candidateReportDates,
    maxReportDates,
    statuses,
  });
}
