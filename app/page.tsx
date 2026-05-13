export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import {
  MenuPlacementStatus,
  OhlqReportDataSource,
  OhlqReportRunStatus,
  UserRole,
  WorklistCategory,
  WorklistStatus,
} from '@prisma/client';
import Link from 'next/link';
import { getUserDisplayName, requireUser } from '../lib/auth';
import {
  formatOhlqDate,
  OHLQ_DATA_SOURCE_CONFIGS,
  toOhlqDateOnlyUtc,
} from '../lib/ohlqDataStatus';
import { prisma } from '../lib/prisma';

const dashboardTimeZone = 'America/New_York';
const inactiveWorklistStatuses = [WorklistStatus.COMPLETED, WorklistStatus.CANCELLED];
const dashboardDataStatusDays = 7;

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

type VisitRecord = {
  visitAt: Date;
  locationType: string;
  createdBy: string | null;
  createdByUser: {
    email: string;
    name: string | null;
  } | null;
};

const zonedFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: dashboardTimeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const shortDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: dashboardTimeZone,
  month: 'short',
  day: 'numeric',
});

const getDateParts = (date: Date): DateParts => {
  const parts = Object.fromEntries(
    zonedFormatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
};

const zonedTimeToUtc = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0) => {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const localGuess = getDateParts(utcGuess);
  const localGuessAsUtc = Date.UTC(
    localGuess.year,
    localGuess.month - 1,
    localGuess.day,
    localGuess.hour,
    localGuess.minute,
    localGuess.second,
  );
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, second);

  return new Date(desiredUtc - (localGuessAsUtc - utcGuess.getTime()));
};

const addLocalDays = (year: number, month: number, day: number, days: number) => {
  const date = new Date(Date.UTC(year, month - 1, day + days));

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
};

const getDashboardRanges = () => {
  const now = new Date();
  const localToday = getDateParts(now);
  const localWeekday = new Date(Date.UTC(localToday.year, localToday.month - 1, localToday.day)).getUTCDay();
  const daysSinceMonday = (localWeekday + 6) % 7;
  const weekStartDate = addLocalDays(localToday.year, localToday.month, localToday.day, -daysSinceMonday);
  const nextSevenEndDate = addLocalDays(localToday.year, localToday.month, localToday.day, 7);
  const lastMonthStart = new Date(now);
  lastMonthStart.setUTCDate(lastMonthStart.getUTCDate() - 30);
  const stalePlacementCutoff = new Date(now);
  stalePlacementCutoff.setUTCDate(stalePlacementCutoff.getUTCDate() - 30);

  return {
    now,
    weekStart: zonedTimeToUtc(weekStartDate.year, weekStartDate.month, weekStartDate.day),
    monthStart: zonedTimeToUtc(localToday.year, localToday.month, 1),
    dueDateStart: new Date(Date.UTC(localToday.year, localToday.month - 1, localToday.day)),
    nextSevenDueDateEnd: new Date(Date.UTC(nextSevenEndDate.year, nextSevenEndDate.month - 1, nextSevenEndDate.day)),
    lastMonthStart,
    stalePlacementCutoff,
  };
};

const formatDateRange = (start: Date, end: Date) =>
  `${shortDateFormatter.format(start)} - ${shortDateFormatter.format(end)}`;

const formatReportDateLabel = (isoDate: string) =>
  shortDateFormatter.format(new Date(`${isoDate}T12:00:00.000Z`));

const runTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: dashboardTimeZone,
});

const formatRunTime = (date: Date | null | undefined) => (date ? runTimeFormatter.format(date) : 'No success yet');

const getRecentReportDates = (days: number) => {
  const today = getDateParts(new Date());

  return Array.from({ length: days }, (_, index) => {
    const offset = days - index;
    const date = addLocalDays(today.year, today.month, today.day, -offset);
    return formatOhlqDate(new Date(Date.UTC(date.year, date.month - 1, date.day, 12)));
  });
};

const buildCountMap = (counts: Array<{ reportDate: Date; _count: { _all: number } }>) =>
  new Map(counts.map((item) => [formatOhlqDate(item.reportDate), item._count._all]));

const getPipelineStatusLabel = (status: OhlqReportRunStatus | undefined, count: number) => {
  if (status === OhlqReportRunStatus.ERRORED) return 'Errored';
  if (status === OhlqReportRunStatus.RUNNING) return 'Running';
  if (status === OhlqReportRunStatus.COMPLETED || count > 0) return 'Completed';
  return 'Not Yet Run';
};

const statusClassName = (status: string) => {
  if (status === 'Completed') return 'status-pill status-completed';
  if (status === 'Errored') return 'status-pill status-errored';
  if (status === 'Running') return 'status-pill status-running';
  return 'status-pill status-muted';
};

const getVisitCounts = (visits: VisitRecord[]) => ({
  total: visits.length,
  agency: visits.filter((visit) => visit.locationType === 'agency').length,
  wholesale: visits.filter((visit) => visit.locationType === 'wholesale').length,
});

const getPerUserVisitCounts = (visits: VisitRecord[], weekStart: Date, monthStart: Date) => {
  const users = new Map<string, { name: string; week: number; month: number }>();

  visits.forEach((visit) => {
    const name = visit.createdByUser ? getUserDisplayName(visit.createdByUser) : visit.createdBy || 'Unknown user';
    const metrics = users.get(name) ?? { name, week: 0, month: 0 };

    if (visit.visitAt.getTime() >= weekStart.getTime()) {
      metrics.week += 1;
    }

    if (visit.visitAt.getTime() >= monthStart.getTime()) {
      metrics.month += 1;
    }

    users.set(name, metrics);
  });

  return Array.from(users.values())
    .filter((metrics) => metrics.week > 0 || metrics.month > 0)
    .sort((a, b) => b.week - a.week || b.month - a.month || a.name.localeCompare(b.name));
};

function MetricSplits({ agency, wholesale }: { agency: number; wholesale: number }) {
  return (
    <div className="metric-splits">
      <div className="metric-split">
        <span>Agency</span>
        <strong>{agency}</strong>
      </div>
      <div className="metric-split">
        <span>Wholesale</span>
        <strong>{wholesale}</strong>
      </div>
    </div>
  );
}

export default async function Dashboard() {
  const user = await requireUser();

  const ranges = getDashboardRanges();
  const visitQueryStart = ranges.weekStart < ranges.monthStart ? ranges.weekStart : ranges.monthStart;
  const reportDates = getRecentReportDates(dashboardDataStatusDays);
  const reportStartDate = toOhlqDateOnlyUtc(reportDates[0]);
  const reportEndDate = toOhlqDateOnlyUtc(reportDates[reportDates.length - 1]);

  const [
    activeWorklistItems,
    visits,
    scheduledWorklistItems,
    photosUploadedLastMonth,
    liveMenuPlacements,
    promisedMenuPlacementsWithoutProof,
    staleMenuPlacements,
    annualDataCounts,
    wholesaleDataCounts,
    pipelineStatusRows,
  ] = await Promise.all([
    prisma.worklistItem.count({
      where: { status: { notIn: inactiveWorklistStatuses } },
    }),
    prisma.loggedVisit.findMany({
      where: {
        visitAt: {
          gte: visitQueryStart,
          lte: ranges.now,
        },
      },
      select: {
        visitAt: true,
        locationType: true,
        createdBy: true,
        createdByUser: {
          select: {
            email: true,
            name: true,
          },
        },
      },
    }),
    prisma.worklistItem.groupBy({
      by: ['category'],
      where: {
        status: { notIn: inactiveWorklistStatuses },
        category: { in: [WorklistCategory.AGENCY, WorklistCategory.WHOLESALE] },
        dueDate: {
          gte: ranges.dueDateStart,
          lt: ranges.nextSevenDueDateEnd,
        },
      },
      _count: { _all: true },
    }),
    prisma.visitPhoto.count({
      where: {
        createdAt: {
          gte: ranges.lastMonthStart,
          lte: ranges.now,
        },
      },
    }),
    prisma.menuPlacement.count({
      where: { status: MenuPlacementStatus.LIVE },
    }),
    prisma.menuPlacement.count({
      where: {
        status: MenuPlacementStatus.PROMISED,
        proofUrl: null,
      },
    }),
    prisma.menuPlacement.count({
      where: {
        status: MenuPlacementStatus.LIVE,
        OR: [{ lastVerifiedAt: null }, { lastVerifiedAt: { lt: ranges.stalePlacementCutoff } }],
      },
    }),
    prisma.ohlqAnnualSalesRow.groupBy({
      by: ['reportDate'],
      where: { reportDate: { gte: reportStartDate, lte: reportEndDate } },
      _count: { _all: true },
      orderBy: { reportDate: 'asc' },
    }),
    prisma.ohlqAnnualSalesByWholesaleRow.groupBy({
      by: ['reportDate'],
      where: { reportDate: { gte: reportStartDate, lte: reportEndDate } },
      _count: { _all: true },
      orderBy: { reportDate: 'asc' },
    }),
    prisma.ohlqReportImportStatus.findMany({
      where: { reportDate: { gte: reportStartDate, lte: reportEndDate } },
      orderBy: [{ reportDate: 'asc' }, { dataSource: 'asc' }],
    }),
  ]);

  const weekVisits = visits.filter((visit) => visit.visitAt.getTime() >= ranges.weekStart.getTime());
  const monthVisits = visits.filter((visit) => visit.visitAt.getTime() >= ranges.monthStart.getTime());
  const weekCounts = getVisitCounts(weekVisits);
  const monthCounts = getVisitCounts(monthVisits);
  const perUserCounts = getPerUserVisitCounts(visits, ranges.weekStart, ranges.monthStart);
  const scheduledAgencyVisits =
    scheduledWorklistItems.find((item) => item.category === WorklistCategory.AGENCY)?._count._all ?? 0;
  const scheduledWholesaleVisits =
    scheduledWorklistItems.find((item) => item.category === WorklistCategory.WHOLESALE)?._count._all ?? 0;
  const scheduledVisitTotal = scheduledAgencyVisits + scheduledWholesaleVisits;
  const countsBySource = {
    [OhlqReportDataSource.ANNUAL_SALES_SUMMARY]: buildCountMap(annualDataCounts),
    [OhlqReportDataSource.ANNUAL_SALES_SUMMARY_BY_WHOLESALE]: buildCountMap(wholesaleDataCounts),
  };
  const statusBySourceDate = new Map(
    pipelineStatusRows.map((row) => [`${row.dataSource}:${formatOhlqDate(row.reportDate)}`, row]),
  );
  const latestReportDate = reportDates[reportDates.length - 1];
  const pipelineSummaries = OHLQ_DATA_SOURCE_CONFIGS.map((config) => {
    const counts = countsBySource[config.source];
    const latestCount = counts.get(latestReportDate) ?? 0;
    const latestStatusRow = statusBySourceDate.get(`${config.source}:${latestReportDate}`);
    const dayStatuses = reportDates.map((date) => {
      const count = counts.get(date) ?? 0;
      const statusRow = statusBySourceDate.get(`${config.source}:${date}`);
      return getPipelineStatusLabel(statusRow?.status, count);
    });
    const lastSuccessfulAt = pipelineStatusRows
      .filter((row) => row.dataSource === config.source && row.lastSuccessfulAt)
      .sort((a, b) => Number(b.lastSuccessfulAt) - Number(a.lastSuccessfulAt))[0]?.lastSuccessfulAt;

    return {
      completedDays: dayStatuses.filter((status) => status === 'Completed').length,
      config,
      erroredDays: dayStatuses.filter((status) => status === 'Errored').length,
      latestCount,
      latestReportDate,
      latestStatus: getPipelineStatusLabel(latestStatusRow?.status, latestCount),
      lastSuccessfulAt,
      missingDays: dayStatuses.filter((status) => status === 'Not Yet Run').length,
    };
  });

  return (
    <>
      <h1>Daily Operating Dashboard</h1>

      <section className="quick-action-panel">
        <Link className="quick-action-card quick-action-primary" href="/visits/new">
          <strong>Log visit</strong>
          <span>Start with account search</span>
        </Link>
        <Link className="quick-action-card" href="/alerts">
          <strong>Worklist</strong>
          <span>{activeWorklistItems} active</span>
        </Link>
        <Link className="quick-action-card" href="/agencies">
          <strong>Find agency</strong>
          <span>Search and log</span>
        </Link>
        <Link className="quick-action-card" href="/wholesale">
          <strong>Find wholesale</strong>
          <span>Search or create</span>
        </Link>
        <Link className="quick-action-card" href="/recipes">
          <strong>Recipe database</strong>
          <span>Search and suggest</span>
        </Link>
      </section>

      <div className="grid">
        <div className="card metric-card">
          <h3>Active worklist</h3>
          <p className="metric-value">{activeWorklistItems}</p>
          <p className="muted metric-caption">Open and in-progress items</p>
        </div>
      </div>

      <section className="dashboard-section">
        <div className="section-heading">
          <h2>Performance</h2>
          <span className="pill">Week starts Monday</span>
        </div>

        <div className="grid performance-grid">
          <div className="card metric-card">
            <h3>Visits this week</h3>
            <p className="metric-value">{weekCounts.total}</p>
            <p className="muted metric-caption">{formatDateRange(ranges.weekStart, ranges.now)}</p>
            <MetricSplits agency={weekCounts.agency} wholesale={weekCounts.wholesale} />
          </div>

          <div className="card metric-card">
            <h3>Visits this month</h3>
            <p className="metric-value">{monthCounts.total}</p>
            <p className="muted metric-caption">{formatDateRange(ranges.monthStart, ranges.now)}</p>
            <MetricSplits agency={monthCounts.agency} wholesale={monthCounts.wholesale} />
          </div>

          <div className="card metric-card metric-card-wide">
            <h3>Visits by user</h3>
            <div className="user-metric-list">
              {perUserCounts.length > 0 ? (
                perUserCounts.map((metrics) => (
                  <div className="user-metric-row" key={metrics.name}>
                    <span>{metrics.name}</span>
                    <strong>{metrics.week} week</strong>
                    <strong>{metrics.month} month</strong>
                  </div>
                ))
              ) : (
                <p className="muted metric-empty">No visits logged this week or month.</p>
              )}
            </div>
          </div>

          <div className="card metric-card">
            <h3>Visits scheduled</h3>
            <p className="metric-value">{scheduledVisitTotal}</p>
            <p className="muted metric-caption">Next 7 days</p>
            <MetricSplits agency={scheduledAgencyVisits} wholesale={scheduledWholesaleVisits} />
          </div>

          <div className="card metric-card">
            <h3>Photos uploaded</h3>
            <p className="metric-value">{photosUploadedLastMonth}</p>
            <p className="muted metric-caption">Last 30 days</p>
          </div>

          <div className="card metric-card">
            <h3>Live placements</h3>
            <p className="metric-value">{liveMenuPlacements}</p>
            <p className="muted metric-caption">Current menu placements</p>
          </div>

          <div className="card metric-card">
            <h3>Promised, no proof</h3>
            <p className="metric-value">{promisedMenuPlacementsWithoutProof}</p>
            <p className="muted metric-caption">Need proof or verification</p>
          </div>

          <div className="card metric-card">
            <h3>Stale placements</h3>
            <p className="metric-value">{staleMenuPlacements}</p>
            <p className="muted metric-caption">Live, not verified in 30 days</p>
          </div>
        </div>
      </section>

      <section className="dashboard-section data-pipeline-section">
        <div className="section-heading">
          <h2>Data Pipeline</h2>
          <span className="pill">Latest report date {formatReportDateLabel(latestReportDate)}</span>
          {user.role === UserRole.ADMIN ? (
            <Link className="btn secondary compact-btn" href="/admin/data-status">
              Open Data Status
            </Link>
          ) : null}
        </div>

        <div className="grid data-pipeline-grid">
          {pipelineSummaries.map((summary) => (
            <div className="card metric-card data-pipeline-card" key={summary.config.source}>
              <div className="data-pipeline-title">
                <h3>{summary.config.label}</h3>
                <span className={statusClassName(summary.latestStatus)}>{summary.latestStatus}</span>
              </div>
              <p className="metric-value">{summary.latestCount.toLocaleString('en-US')}</p>
              <p className="muted metric-caption">Rows for {formatReportDateLabel(summary.latestReportDate)}</p>
              <div className="metric-splits">
                <div className="metric-split">
                  <span>Completed days</span>
                  <strong>{summary.completedDays}/{dashboardDataStatusDays}</strong>
                </div>
                <div className="metric-split">
                  <span>Errored / not yet run</span>
                  <strong>
                    {summary.erroredDays} / {summary.missingDays}
                  </strong>
                </div>
              </div>
              <p className="muted metric-caption">Last success: {formatRunTime(summary.lastSuccessfulAt)}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
