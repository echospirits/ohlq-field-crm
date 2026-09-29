export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { MenuPlacementStatus, WorklistCategory, WorklistSource, WorklistStatus } from '@prisma/client';
import Link from 'next/link';
import { buildPageMetadata } from '../lib/appBrand';
import { getUserDisplayName, requireUser } from '../lib/auth';
import { addDaysToDateInputValue, EASTERN_TIME_ZONE, formatDateOnlyInputValue, formatEasternDateInputValue } from '../lib/dateTime';
import { prisma } from '../lib/prisma';
import { getOrganizationFeatures, requireOrganizationContext } from '../lib/organizations';
import { DashboardOpportunitySummary } from './components/DashboardOpportunitySummary';
import { GlobalSearchForm } from './components/GlobalSearchForm';
import { DashboardAgencyIntelligence } from './components/DashboardAgencyIntelligence';
import { getWorklistLocations } from '../lib/worklistLocations';
import { getSchedulerWeekDates, isValidSchedulerDate } from '../lib/myDayWeekScheduler';
import { createSchedulerWorklistItem, completeSchedulerWorklistItem, updateSchedulerWorklistItem } from './my-week/actions';
import { WorklistScheduler } from './my-week/WorklistScheduler';

export const metadata = buildPageMetadata('My Schedule');

const dashboardTimeZone = EASTERN_TIME_ZONE;
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

export default async function Dashboard({ searchParams }: { searchParams?: Promise<{ date?: string; view?: string }> }) {
  const user = await requireUser();
  const { organizationId } = await requireOrganizationContext(user);
  const enabledFeatures = await getOrganizationFeatures(organizationId);
  const params = (await searchParams) ?? {};
  const anchorDate = isValidSchedulerDate(params.date) ? params.date : formatEasternDateInputValue();
  const view = params.view === 'week' ? 'week' : 'day';
  const weekDates = getSchedulerWeekDates(anchorDate);
  const schedulerRangeStart = addDaysToDateInputValue(view === 'week' ? weekDates[0] : anchorDate, -30);
  const schedulerRangeEnd = addDaysToDateInputValue(view === 'week' ? weekDates[6] : anchorDate, 1);
  const ranges = getDashboardRanges();
  const visitQueryStart = ranges.weekStart < ranges.monthStart ? ranges.weekStart : ranges.monthStart;
  const excludedIntelligenceSources: WorklistSource[] = [
    ...(!enabledFeatures.has('AGENCY_INTELLIGENCE') ? [WorklistSource.AGENCY_INTELLIGENCE] : []),
    ...(!enabledFeatures.has('WHOLESALE_OPPORTUNITIES') ? [WorklistSource.OPPORTUNITY_INTELLIGENCE] : []),
  ];

  const [
    activeWorklistItems,
    visits,
    scheduledWorklistItems,
    photosUploadedLastMonth,
    liveMenuPlacements,
    promisedMenuPlacementsWithoutProof,
    staleMenuPlacements,
    schedulerWorklistItems,
    schedulerUsers,
  ] = await Promise.all([
    prisma.worklistItem.count({
      where: { organizationId, status: { notIn: inactiveWorklistStatuses } },
    }),
    prisma.loggedVisit.findMany({
      where: {
        organizationId,
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
        organizationId,
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
        organizationId,
        createdAt: {
          gte: ranges.lastMonthStart,
          lte: ranges.now,
        },
      },
    }),
    prisma.menuPlacement.count({
      where: { organizationId, status: MenuPlacementStatus.LIVE },
    }),
    prisma.menuPlacement.count({
      where: {
        organizationId,
        status: MenuPlacementStatus.PROMISED,
        proofUrl: null,
      },
    }),
    prisma.menuPlacement.count({
      where: {
        organizationId,
        status: MenuPlacementStatus.LIVE,
        OR: [{ lastVerifiedAt: null }, { lastVerifiedAt: { lt: ranges.stalePlacementCutoff } }],
      },
    }),
    prisma.worklistItem.findMany({
      where: {
        organizationId,
        ...(excludedIntelligenceSources.length ? { source: { notIn: excludedIntelligenceSources } } : {}),
        AND: [
          { OR: [{ assignedToUserId: user.id }, { assignedTo: getUserDisplayName(user) }] },
          { status: { in: [WorklistStatus.OPEN, WorklistStatus.IN_PROGRESS] } },
          { OR: [{ dueDate: null }, { dueDate: { gte: new Date(`${schedulerRangeStart}T00:00:00.000Z`), lt: new Date(`${schedulerRangeEnd}T00:00:00.000Z`) } }] },
        ],
      },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { dueTimeMinutes: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 300,
      include: {
        loggedVisit: { select: { locationType: true, agencyId: true, wholesaleAccountId: true } },
        agencyProductIntelligence: { select: { itemCode: true, itemName: true } },
      },
    }),
    prisma.user.findMany({
      where: { organizationId, isActive: true, role: { notIn: ['TASTER', 'PLATFORM_ADMIN'] } },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      select: { id: true, email: true, firstName: true, lastName: true, name: true },
    }),
  ]);

  const schedulerLocations = await getWorklistLocations(schedulerWorklistItems);
  const schedulerAgencyIds = [...new Set([...schedulerLocations.values()].flatMap((location) => location?.type === 'agency' ? [location.id] : []))];
  const schedulerWholesaleIds = [...new Set([...schedulerLocations.values()].flatMap((location) => location?.type === 'wholesale' ? [location.id] : []))];
  const schedulerTargetOverlays = schedulerAgencyIds.length || schedulerWholesaleIds.length
    ? await prisma.organizationAccountOverlay.findMany({
        where: {
          organizationId,
          isTargeting: true,
          OR: [
            { accountType: 'AGENCY', externalAccountId: { in: schedulerAgencyIds } },
            { accountType: 'WHOLESALE', externalAccountId: { in: schedulerWholesaleIds } },
          ],
        },
        select: { accountType: true, externalAccountId: true },
      })
    : [];
  const schedulerTargetedAccountKeys = new Set(schedulerTargetOverlays.map((item) => `${item.accountType}:${item.externalAccountId}`));
  const schedulerItems = schedulerWorklistItems.map((item) => {
    const location = schedulerLocations.get(item.id);
    return {
      id: item.id,
      title: item.title,
      detail: item.detail,
      updatedAt: item.updatedAt.toISOString(),
      dueDate: item.dueDate ? formatDateOnlyInputValue(item.dueDate) : null,
      dueTimeMinutes: item.dueTimeMinutes,
      status: item.status,
      category: item.category,
      agencyId: item.agencyId,
      wholesaleAccountId: item.wholesaleAccountId,
      salesOpportunityId: item.salesOpportunityId,
      agencyProductIntelligenceId: item.agencyProductIntelligenceId,
      productItemCode: item.agencyProductIntelligence?.itemCode ?? null,
      productName: item.agencyProductIntelligence?.itemName ?? null,
      assignedToUserId: item.assignedToUserId,
      assignedTo: item.assignedTo,
      isTargeting: Boolean(location && schedulerTargetedAccountKeys.has(`${location.type === 'agency' ? 'AGENCY' : 'WHOLESALE'}:${location.id}`)),
      location: location ? { id: location.id, name: location.name, type: location.type, href: location.href, businessHours: location.businessHours } : null,
    };
  });

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
      <header className="page-heading page-header dashboard-heading">
        <div>
          <span className="page-eyebrow">Worklist</span>
          <h1>My Schedule</h1>
          <p className="muted">Plan your day or scan the week ahead.</p>
        </div>
      </header>

      <WorklistScheduler
        anchorDate={anchorDate}
        completeAction={completeSchedulerWorklistItem}
        createAction={createSchedulerWorklistItem}
        currentUserId={user.id}
        items={schedulerItems}
        updateAction={updateSchedulerWorklistItem}
        users={schedulerUsers.map((member) => ({ id: member.id, name: getUserDisplayName(member) }))}
        view={view}
      />
      <div className="day-search"><GlobalSearchForm /></div>

      <section className="dashboard-quick-actions" aria-labelledby="quick-actions-title">
        <div className="section-heading">
          <h2 id="quick-actions-title">Quick actions</h2>
        </div>
        <div className="quick-action-panel">
          <Link className="quick-action-card quick-action-primary" href="/visits/new">
            <strong>Log visit</strong>
            <span>Start with account search</span>
          </Link>
          <Link className="quick-action-card" href="/alerts">
            <strong>Worklist</strong>
            <span>{activeWorklistItems} active</span>
          </Link>
          <Link className="quick-action-card" href="/search">
            <strong>Find account</strong>
            <span>{enabledFeatures.has('WHOLESALE_OPPORTUNITIES') ? 'Agency, wholesale, or opportunity' : 'Agency or wholesale'}</span>
          </Link>
        </div>
      </section>

      <details className="dashboard-section dashboard-details">
        <summary><span><strong>Explore opportunities</strong><small>Wholesale recommendations and retail signals</small></span></summary>
        <div className="dashboard-details-content">
          {enabledFeatures.has('WHOLESALE_OPPORTUNITIES') ? <DashboardOpportunitySummary organizationId={organizationId} /> : null}
          {enabledFeatures.has('AGENCY_INTELLIGENCE') ? <DashboardAgencyIntelligence organizationId={organizationId} /> : null}
          {!enabledFeatures.has('WHOLESALE_OPPORTUNITIES') && !enabledFeatures.has('AGENCY_INTELLIGENCE') ? <p className="muted">Opportunity intelligence is not enabled for this organization.</p> : null}
        </div>
      </details>

      <details className="dashboard-section dashboard-details">
        <summary>
          <span>
            <strong>Team activity and performance</strong>
            <small>Visits, scheduling, photos, and menu placement signals</small>
          </span>
          <span className="pill">Week starts Monday</span>
        </summary>

        <div className="grid performance-grid dashboard-details-content">
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
      </details>
    </>
  );
}
