export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { WorklistCategory, WorklistStatus } from '@prisma/client';
import { getUserDisplayName, requireUser } from '../lib/auth';
import { prisma } from '../lib/prisma';

const dashboardTimeZone = 'America/New_York';
const inactiveWorklistStatuses = [WorklistStatus.COMPLETED, WorklistStatus.CANCELLED];

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

  return {
    now,
    weekStart: zonedTimeToUtc(weekStartDate.year, weekStartDate.month, weekStartDate.day),
    monthStart: zonedTimeToUtc(localToday.year, localToday.month, 1),
    dueDateStart: new Date(Date.UTC(localToday.year, localToday.month - 1, localToday.day)),
    nextSevenDueDateEnd: new Date(Date.UTC(nextSevenEndDate.year, nextSevenEndDate.month - 1, nextSevenEndDate.day)),
    lastMonthStart,
  };
};

const formatDateRange = (start: Date, end: Date) =>
  `${shortDateFormatter.format(start)} - ${shortDateFormatter.format(end)}`;

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
  await requireUser();

  const ranges = getDashboardRanges();
  const visitQueryStart = ranges.weekStart < ranges.monthStart ? ranges.weekStart : ranges.monthStart;

  const [activeWorklistItems, visits, scheduledWorklistItems, photosUploadedLastMonth] = await Promise.all([
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

  return (
    <>
      <h1>Daily Operating Dashboard</h1>

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
        </div>
      </section>
    </>
  );
}
