export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { Prisma, WorklistCategory, WorklistSource, WorklistStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { getUserDisplayName, requireUser } from '../../lib/auth';
import { EASTERN_TIME_ZONE, formatDateOnly } from '../../lib/dateTime';
import { splitReactivationPurchasedAgainDetail } from '../../lib/ohlqWholesaleReactivation';
import { prisma } from '../../lib/prisma';
import { getAgenciesForVisitPicker, getWholesaleAccountsForVisitPicker } from '../../lib/visitPickerOptions';
import { createVisit } from '../visits/actions';
import { WorklistActions } from '../alerts/WorklistActions';
import { WorklistDetail } from '../alerts/WorklistDetail';

const dashboardTimeZone = EASTERN_TIME_ZONE;
const inactiveWorklistStatuses = [WorklistStatus.COMPLETED, WorklistStatus.CANCELLED];

const statusLabels: Record<WorklistStatus, string> = {
  [WorklistStatus.OPEN]: 'Open',
  [WorklistStatus.IN_PROGRESS]: 'In progress',
  [WorklistStatus.COMPLETED]: 'Completed',
  [WorklistStatus.CANCELLED]: 'Cancelled',
};

const sourceLabels: Record<WorklistSource, string> = {
  [WorklistSource.MANUAL]: 'Manual',
  [WorklistSource.OHLQ_WHOLESALE_REACTIVATION]: 'OHLQ wholesale reactivation',
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
  const id = toOptional(formData.get('id'));
  const status = toWorklistStatus(formData.get('status'));

  if (!id) {
    return;
  }

  await prisma.worklistItem.update({
    where: { id },
    data: {
      status,
      completedAt: status === WorklistStatus.COMPLETED ? new Date() : null,
      cancelledAt: status === WorklistStatus.CANCELLED ? new Date() : null,
      completedByUserId: status === WorklistStatus.COMPLETED ? currentUser.id : null,
      cancelledByUserId: status === WorklistStatus.CANCELLED ? currentUser.id : null,
    },
  });

  revalidatePath('/my-week');
  revalidatePath('/alerts');
  revalidatePath('/');
}

export default async function MyWeekPage() {
  const currentUser = await requireUser();
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

  const [items, agencyOptions, wholesaleOptions, contacts, tags] = await Promise.all([
    prisma.worklistItem.findMany({
      where: {
        AND: [
          assignedWhere,
          { status: { notIn: inactiveWorklistStatuses } },
          { OR: [{ dueDate: null }, dueThisWeekWhere] },
        ],
      },
      take: 300,
      include: {
        assignedToUser: true,
        cancelledByUser: true,
        completedByUser: true,
        createdByUser: true,
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    }),
    getAgenciesForVisitPicker(),
    getWholesaleAccountsForVisitPicker(),
    prisma.locationContact.findMany({
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
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        color: true,
      },
    }),
  ]);

  const agencyMap = Object.fromEntries(agencyOptions.map((agency) => [agency.id, agency.name]));
  const wholesaleMap = Object.fromEntries(wholesaleOptions.map((account) => [account.id, account.name]));
  const dueThisWeek = items.filter((item) => item.dueDate);
  const noDate = items.filter((item) => !item.dueDate);
  const groups = [
    { key: 'due', title: 'Due this week', items: dueThisWeek },
    { key: 'undated', title: 'No specific date', items: noDate },
  ];

  return (
    <>
      <h1>My Week</h1>
      <p className="muted">
        Assigned to {actorName} for {weekLabelFormatter.format(ranges.weekStart)} -{' '}
        {weekLabelFormatter.format(ranges.weekEnd)}
      </p>

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
              <table className="responsive-table">
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
                    const location =
                      item.category === WorklistCategory.AGENCY
                        ? agencyMap[item.agencyId ?? '']
                        : item.category === WorklistCategory.WHOLESALE
                          ? wholesaleMap[item.wholesaleAccountId ?? '']
                          : '';
                    const locationHref =
                      item.category === WorklistCategory.AGENCY && item.agencyId
                        ? `/agencies/${item.agencyId}`
                        : item.category === WorklistCategory.WHOLESALE && item.wholesaleAccountId
                          ? `/wholesale/${item.wholesaleAccountId}`
                          : null;

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
                          {locationHref ? (
                            <Link className="table-link" href={locationHref}>
                              {location || 'Open account'}
                            </Link>
                          ) : (
                            <strong>{location || 'General'}</strong>
                          )}
                          <div className="muted">{formatDateOnly(item.dueDate) || 'No due date'}</div>
                        </td>
                        <td data-label="Source">{sourceLabels[item.source]}</td>
                        <td data-label="Actions">
                          <WorklistActions
                            actorName={actorName}
                            agencies={agencyOptions}
                            contacts={contacts}
                            createVisitAction={createVisit}
                            item={{
                              id: item.id,
                              title: item.title,
                              detail: parsedDetail.detail,
                              status: item.status as WorklistActionStatus,
                              category: item.category,
                              agencyId: item.agencyId,
                              wholesaleAccountId: item.wholesaleAccountId,
                            }}
                            tags={tags}
                            updateStatusAction={updateWorklistStatus}
                            wholesaleAccounts={wholesaleOptions}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        ))
      )}
    </>
  );
}
