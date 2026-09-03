export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { Prisma, WorklistCategory, WorklistSource, WorklistStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { buildPageMetadata } from '../../lib/appBrand';
import { getUserDisplayName, requireUser } from '../../lib/auth';
import { EASTERN_TIME_ZONE, formatDateOnlyInputValue, formatTimeMinutesInput, formatWorklistDue, parseTimeInputToMinutes } from '../../lib/dateTime';
import { syncWorklistItemCalendar } from '../../lib/calendar/worklistSync';
import { evaluateOpportunityIntelligence } from '../../lib/opportunityEngine';
import { splitReactivationPurchasedAgainDetail } from '../../lib/ohlqWholesaleReactivation';
import { prisma } from '../../lib/prisma';
import { getOrganizationFeatures, requireOrganizationContext } from '../../lib/organizations';
import { getAgenciesForVisitPicker, getWholesaleAccountsForVisitPicker } from '../../lib/visitPickerOptions';
import { getWorklistLocationFallbackLabel, getWorklistLocations } from '../../lib/worklistLocations';
import { createVisit } from '../visits/actions';
import { WorklistActions } from '../alerts/WorklistActions';
import { WorkViewNavigation } from '../components/WorkViewNavigation';
import { WorklistDetail } from '../alerts/WorklistDetail';

export const metadata = buildPageMetadata('My Week');

const dashboardTimeZone = EASTERN_TIME_ZONE;
const inactiveWorklistStatuses = [WorklistStatus.COMPLETED, WorklistStatus.CANCELLED];

const statusLabels: Record<WorklistStatus, string> = {
  [WorklistStatus.OPEN]: 'Open',
  [WorklistStatus.IN_PROGRESS]: 'In progress',
  [WorklistStatus.COMPLETED]: 'Completed',
  [WorklistStatus.CANCELLED]: 'Cancelled',
};

const sourceLabels: Record<WorklistSource, string> = {
  [WorklistSource.AGENCY_INTELLIGENCE]: 'Agency intelligence',
  [WorklistSource.MANUAL]: 'Manual',
  [WorklistSource.OHLQ_WHOLESALE_REACTIVATION]: 'OHLQ wholesale reactivation',
  [WorklistSource.OPPORTUNITY_INTELLIGENCE]: 'Opportunity intelligence',
  [WorklistSource.TARGET_ACCOUNT_INTELLIGENCE]: 'Target account intelligence',
  [WorklistSource.VISIT_FOLLOW_UP]: 'Visit follow-up',
};

const weekLabelFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: dashboardTimeZone,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

const datePartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: dashboardTimeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

type WorklistActionStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

const toOptional = (value: FormDataEntryValue | null | undefined) => {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toWorklistStatus = (value: FormDataEntryValue | string | null | undefined) => {
  const status = String(value ?? WorklistStatus.OPEN);
  return Object.values(WorklistStatus).includes(status as WorklistStatus)
    ? (status as WorklistStatus)
    : WorklistStatus.OPEN;
};

const toDate = (value: FormDataEntryValue | null | undefined) => {
  const date = toOptional(value);
  return date ? new Date(`${date}T00:00:00`) : null;
};

const getDateParts = (date: Date): DateParts => {
  const parts = Object.fromEntries(
    datePartsFormatter
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

const getWeekRange = () => {
  const now = new Date();
  const localToday = getDateParts(now);
  const localWeekday = new Date(Date.UTC(localToday.year, localToday.month - 1, localToday.day)).getUTCDay();
  const weekStartDate = addLocalDays(localToday.year, localToday.month, localToday.day, -localWeekday);
  const nextWeekStartDate = addLocalDays(weekStartDate.year, weekStartDate.month, weekStartDate.day, 7);
  const weekEndDate = addLocalDays(weekStartDate.year, weekStartDate.month, weekStartDate.day, 6);

  return {
    weekStart: zonedTimeToUtc(weekStartDate.year, weekStartDate.month, weekStartDate.day),
    nextWeekStart: zonedTimeToUtc(nextWeekStartDate.year, nextWeekStartDate.month, nextWeekStartDate.day),
    weekEnd: zonedTimeToUtc(weekEndDate.year, weekEndDate.month, weekEndDate.day, 23, 59, 59),
  };
};

async function updateWorklistStatus(formData: FormData) {
  'use server';

  const currentUser = await requireUser();
  const { organizationId } = await requireOrganizationContext(currentUser);
  const id = toOptional(formData.get('id'));
  const status = toWorklistStatus(formData.get('status'));

  if (!id) {
    return;
  }

  const owned = await prisma.worklistItem.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!owned) return;
  const item = await prisma.worklistItem.update({
    where: { id: owned.id },
    data: {
      status,
      completedAt: status === WorklistStatus.COMPLETED ? new Date() : null,
      cancelledAt: status === WorklistStatus.CANCELLED ? new Date() : null,
      completedByUserId: status === WorklistStatus.COMPLETED ? currentUser.id : null,
      cancelledByUserId: status === WorklistStatus.CANCELLED ? currentUser.id : null,
    },
  });
  await syncWorklistItemCalendar(id);
  if (item.wholesaleAccountId) await evaluateOpportunityIntelligence({ accountIds: [item.wholesaleAccountId], organizationId });

  revalidatePath('/my-week');
  revalidatePath('/alerts');
  revalidatePath('/');
}

async function updateWorklistItem(formData: FormData) {
  'use server';
  const currentUser = await requireUser();
  const { organizationId } = await requireOrganizationContext(currentUser);
  const id = toOptional(formData.get('id'));
  const title = toOptional(formData.get('title'));
  const assignedToUserId = toOptional(formData.get('assignedToUserId'));
  if (!id || !title) return;
  const assignedUser = assignedToUserId
    ? await prisma.user.findFirst({ where: { id: assignedToUserId, organizationId, isActive: true, role: { not: 'TASTER' } } })
    : null;
  if (assignedToUserId && !assignedUser) return;
  const dueDate = toDate(formData.get('dueDate'));
  const owned = await prisma.worklistItem.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!owned) return;
  await prisma.worklistItem.update({
    where: { id: owned.id },
    data: {
      title,
      detail: toOptional(formData.get('detail')),
      dueDate,
      dueTimeMinutes: dueDate ? parseTimeInputToMinutes(formData.get('dueTime')) : null,
      assignedToUserId: assignedUser?.id ?? null,
      assignedTo: assignedUser ? getUserDisplayName(assignedUser) : null,
    },
  });
  await syncWorklistItemCalendar(id);
  revalidatePath('/my-week');
  revalidatePath('/alerts');
  revalidatePath('/');
}

export default async function MyWeekPage() {
  const currentUser = await requireUser();
  const { organizationId } = await requireOrganizationContext(currentUser);
  const enabledFeatures = await getOrganizationFeatures(organizationId);
  const excludedIntelligenceSources: WorklistSource[] = [
    ...(!enabledFeatures.has('AGENCY_INTELLIGENCE') ? [WorklistSource.AGENCY_INTELLIGENCE] : []),
    ...(!enabledFeatures.has('WHOLESALE_OPPORTUNITIES') ? [WorklistSource.OPPORTUNITY_INTELLIGENCE] : []),
  ];
  const actorName = getUserDisplayName(currentUser);
  const ranges = getWeekRange();
  const assignedWhere: Prisma.WorklistItemWhereInput = {
    OR: [{ assignedToUserId: currentUser.id }, { assignedTo: actorName }],
  };
  const dueThisWeekWhere: Prisma.WorklistItemWhereInput = {
    dueDate: {
      gte: ranges.weekStart,
      lt: ranges.nextWeekStart,
    },
  };

  const [items, agencyOptions, wholesaleOptions, contacts, tags, users] = await Promise.all([
    prisma.worklistItem.findMany({
      where: {
        organizationId,
        ...(excludedIntelligenceSources.length ? { source: { notIn: excludedIntelligenceSources } } : {}),
        AND: [
          assignedWhere,
          { status: { notIn: inactiveWorklistStatuses } },
          { OR: [{ dueDate: null }, dueThisWeekWhere] },
        ],
      },
      take: 300,
      include: {
        calendarEvents: { where: { provider: 'GOOGLE' } },
        assignedToUser: true,
        cancelledByUser: true,
        completedByUser: true,
        createdByUser: true,
        loggedVisit: {
          select: {
            locationType: true,
            agencyId: true,
            wholesaleAccountId: true,
          },
        },
        agencyProductIntelligence: { select: { itemCode: true, itemName: true } },
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    }),
    getAgenciesForVisitPicker(),
    getWholesaleAccountsForVisitPicker(),
    prisma.locationContact.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      take: 1000,
      select: {
        id: true,
        name: true,
        role: true,
        phone: true,
        email: true,
        agencyId: true,
        wholesaleAccountId: true,
      },
    }),
    prisma.tag.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        color: true,
      },
    }),
    prisma.user.findMany({
      where: { organizationId, isActive: true, role: { not: 'TASTER' } },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      select: { id: true, email: true, firstName: true, lastName: true, name: true },
    }),
  ]);

  const worklistLocations = await getWorklistLocations(items);
  const dueThisWeek = items.filter((item) => item.dueDate);
  const noDate = items.filter((item) => !item.dueDate);
  const groups = [
    { key: 'due', title: 'Due this week', items: dueThisWeek },
    { key: 'undated', title: 'No specific date', items: noDate },
  ];

  return (
    <>
      <header className="page-heading page-header">
        <div>
          <span className="page-eyebrow">My work</span>
          <h1>My Week</h1>
          <p className="muted">
            Assigned to {actorName} for {weekLabelFormatter.format(ranges.weekStart)} -{' '}
            {weekLabelFormatter.format(ranges.weekEnd)}
          </p>
        </div>
      </header>
      <WorkViewNavigation active="week" showPursuing={enabledFeatures.has('WHOLESALE_OPPORTUNITIES')} />

      <div className="grid account-summary-grid">
        <div className="card metric-card">
          <h3>Total items</h3>
          <p className="metric-value">{items.length}</p>
        </div>
        <div className="card metric-card">
          <h3>Due this week</h3>
          <p className="metric-value">{dueThisWeek.length}</p>
        </div>
        <div className="card metric-card">
          <h3>No date</h3>
          <p className="metric-value">{noDate.length}</p>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="muted activity-empty">No active assigned worklist items for this week.</p>
      ) : (
        groups.map((group) => (
          <section className="worklist-section" key={group.key}>
            <div className="section-heading">
              <h2>{group.title}</h2>
              <span className="pill">{group.items.length}</span>
            </div>

            {group.items.length === 0 ? (
              <p className="muted">No matching items.</p>
            ) : (
              <div className="table-scroll"><table className="responsive-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Location / Due</th>
                    <th>Source</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item) => {
                    const parsedDetail = splitReactivationPurchasedAgainDetail(item.detail);
                    const location = worklistLocations.get(item.id);

                    return (
                      <tr key={item.id}>
                        <td data-label="Item">
                          <strong>{item.title}</strong>
                          <div className="inline-meta">
                            <span className="pill">{statusLabels[item.status]}</span>
                            <span className="pill">{item.category.toLowerCase()}</span>
                          </div>
                          <WorklistDetail detail={item.detail} />
                          <div className="muted item-meta">
                            Created by{' '}
                            {item.createdByUser
                              ? getUserDisplayName(item.createdByUser)
                              : item.createdBy || 'Unknown user'}
                          </div>
                        </td>
                        <td data-label="Location / Due">
                          {location ? (
                            <Link className="table-link" href={location.href}>
                              {location.name}
                            </Link>
                          ) : (
                            <strong>{getWorklistLocationFallbackLabel(item)}</strong>
                          )}
                          <div className="muted">{formatWorklistDue(item.dueDate, item.dueTimeMinutes) || 'No due date'}</div>
                        </td>
                        <td data-label="Source">{sourceLabels[item.source]}</td>
                        <td data-label="Actions">
                          <WorklistActions
                            actorName={actorName}
                            currentUserId={currentUser.id}
                            agencies={agencyOptions}
                            contacts={contacts}
                            createVisitAction={createVisit}
                            item={{
                              id: item.id,
                              title: item.title,
                              detail: parsedDetail.detail,
                              editDetail: item.detail,
                              dueDate: formatDateOnlyInputValue(item.dueDate ?? undefined),
                              dueTime: formatTimeMinutesInput(item.dueTimeMinutes),
                              assignedToUserId: item.assignedToUserId,
                              calendarSyncStatus: item.calendarEvents[0]?.syncStatus ?? null,
                              calendarSyncError: item.calendarEvents[0]?.syncError ?? null,
                              status: item.status as WorklistActionStatus,
                              category: item.category,
                              agencyId: item.agencyId,
                              wholesaleAccountId: item.wholesaleAccountId,
                              salesOpportunityId: item.salesOpportunityId,
                              agencyProductIntelligenceId: item.agencyProductIntelligenceId,
                              productItemCode: item.agencyProductIntelligence?.itemCode ?? null,
                              productName: item.agencyProductIntelligence?.itemName ?? null,
                              location: location
                                ? { id: location.id, name: location.name, type: location.type }
                                : null,
                            }}
                            tags={tags}
                            users={users.map((user) => ({ id: user.id, name: getUserDisplayName(user) }))}
                            updateItemAction={updateWorklistItem}
                            updateStatusAction={updateWorklistStatus}
                            wholesaleAccounts={wholesaleOptions}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            )}
          </section>
        ))
      )}
    </>
  );
}
