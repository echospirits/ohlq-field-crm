import { createHash } from 'crypto';
import { CalendarProviderName, CalendarSyncStatus, WorklistStatus } from '@prisma/client';
import {
  EASTERN_TIME_ZONE,
  formatDateOnlyInputValue,
  getZonedDateTimeParts,
  zonedDateTimeToUtc,
} from '../dateTime';
import { prisma } from '../prisma';
import { APP_NAME } from '../appBrand';
import { isSideEffectEnabled, logEnvironmentEvent } from '../appEnvironment';
import { getCalendarProvider } from './index';
import { CalendarProviderError, type CalendarEventInput, type ExternalCalendarEvent } from './types';

const ACTIVE_STATUSES: WorklistStatus[] = [WorklistStatus.OPEN, WorklistStatus.IN_PROGRESS];
const GOOGLE = CalendarProviderName.GOOGLE;

type WorklistForCalendar = Awaited<ReturnType<typeof loadWorklistItem>>;

const loadWorklistItem = (id: string) => prisma.worklistItem.findUnique({
  where: { id },
  include: {
    assignedToUser: true,
    calendarEvents: { include: { connection: true } },
  },
});

const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 1000);

export const getWorklistScheduleHash = (item: {
  id: string;
  title: string;
  detail: string | null;
  dueDate: Date | null;
  dueTimeMinutes: number | null;
  assignedToUserId: string | null;
  status: WorklistStatus;
}) => createHash('sha256').update(JSON.stringify({
  id: item.id,
  title: item.title,
  detail: item.detail,
  dueDate: item.dueDate ? formatDateOnlyInputValue(item.dueDate) : null,
  dueTimeMinutes: item.dueTimeMinutes,
  assignedToUserId: item.assignedToUserId,
  status: item.status,
})).digest('hex');

export const buildWorklistCalendarInput = ({
  item,
  accountName,
}: {
  item: NonNullable<WorklistForCalendar>;
  accountName?: string | null;
}): CalendarEventInput => {
  if (!item.dueDate) throw new Error('A due date is required to build a calendar event.');
  const date = formatDateOnlyInputValue(item.dueDate);
  const appBaseUrl = process.env.APP_BASE_URL?.replace(/\/$/, '');
  const context = [
    accountName ? `Account: ${accountName}` : null,
    item.detail ? `Task: ${item.detail}` : null,
    `Source: ${item.source.toLowerCase().replaceAll('_', ' ')}`,
    appBaseUrl ? `${APP_NAME}: ${appBaseUrl}/alerts?worklistItemId=${encodeURIComponent(item.id)}` : null,
    `Managed by ${APP_NAME}. Reschedule this event to update the follow-up.`,
  ].filter(Boolean).join('\n\n');
  const startsAt = item.dueTimeMinutes == null ? null : zonedDateTimeToUtc(date, item.dueTimeMinutes);
  const schedule = item.dueTimeMinutes == null
    ? { kind: 'all-day' as const, date }
    : {
        kind: 'timed' as const,
        startsAt: startsAt!,
        endsAt: new Date(startsAt!.getTime() + 30 * 60 * 1000),
        timeZone: EASTERN_TIME_ZONE,
      };
  return {
    title: `${APP_NAME}: ${item.title}`,
    description: context,
    schedule,
    privateMetadata: { echoCrmManaged: 'true', worklistItemId: item.id },
  };
};

async function getAccountName(item: NonNullable<WorklistForCalendar>) {
  if (item.agencyId) return (await prisma.agency.findUnique({ where: { id: item.agencyId }, select: { name: true } }))?.name ?? null;
  if (item.wholesaleAccountId) return (await prisma.wholesaleAccount.findUnique({ where: { id: item.wholesaleAccountId }, select: { name: true } }))?.name ?? null;
  return null;
}

async function removeExternalEvent(item: NonNullable<WorklistForCalendar>, reason: CalendarSyncStatus) {
  const link = item.calendarEvents.find((event) => event.provider === GOOGLE);
  if (!link) return;
  if (link.externalEventId && link.connection) {
    try {
      await getCalendarProvider(GOOGLE).deleteEvent(link.connection, link.externalEventId);
    } catch (error) {
      await prisma.worklistCalendarEvent.update({
        where: { id: link.id },
        data: { syncStatus: CalendarSyncStatus.ERROR, syncError: getErrorMessage(error), lastSyncedAt: new Date() },
      });
      return;
    }
  }
  await prisma.worklistCalendarEvent.update({
    where: { id: link.id },
    data: {
      connectionId: null,
      externalEventId: null,
      calendarId: null,
      syncStatus: reason,
      syncError: null,
      lastSyncedAt: new Date(),
    },
  });
}

export async function syncWorklistItemCalendar(worklistItemId: string, { force = false } = {}) {
  if (!isSideEffectEnabled('calendar')) {
    logEnvironmentEvent('calendar.sync.suppressed', { worklistItemId });
    return { status: 'environment-disabled' as const };
  }
  const item = await loadWorklistItem(worklistItemId);
  if (!item) return { status: 'missing' as const };
  const existing = item.calendarEvents.find((event) => event.provider === GOOGLE);
  const actionable = Boolean(item.dueDate && item.assignedToUserId && ACTIVE_STATUSES.includes(item.status));
  if (!actionable) {
    await removeExternalEvent(item, CalendarSyncStatus.DISABLED);
    return { status: 'disabled' as const };
  }

  const connection = await prisma.calendarConnection.findUnique({
    where: { userId_provider: { userId: item.assignedToUserId!, provider: GOOGLE } },
  });
  const reassigned = Boolean(existing?.connection && existing.connection.userId !== item.assignedToUserId);
  if (reassigned) {
    await removeExternalEvent(item, CalendarSyncStatus.DISABLED);
  }
  if (!connection || !connection.syncEnabled || connection.requiresReconnect) {
    await prisma.worklistCalendarEvent.upsert({
      where: { worklistItemId_provider: { worklistItemId: item.id, provider: GOOGLE } },
      create: { worklistItemId: item.id, provider: GOOGLE, syncStatus: CalendarSyncStatus.DISABLED },
      update: { connectionId: null, externalEventId: null, calendarId: null, syncStatus: CalendarSyncStatus.DISABLED, syncError: connection?.syncError ?? null },
    });
    return { status: 'not-connected' as const };
  }

  const refreshedItem = reassigned ? await loadWorklistItem(worklistItemId) : item;
  if (!refreshedItem) return { status: 'missing' as const };
  const link = refreshedItem.calendarEvents.find((event) => event.provider === GOOGLE);
  if (!force && !reassigned && link?.syncStatus === CalendarSyncStatus.REMOVED && !link.externalEventId) {
    return { status: 'removed' as const };
  }
  const input = buildWorklistCalendarInput({ item: refreshedItem, accountName: await getAccountName(refreshedItem) });
  const provider = getCalendarProvider(GOOGLE);
  try {
    const result = link?.externalEventId && link.connectionId === connection.id
      ? await provider.updateEvent(connection, link.externalEventId, input)
      : await provider.createEvent(connection, input);
    await prisma.worklistCalendarEvent.upsert({
      where: { worklistItemId_provider: { worklistItemId: item.id, provider: GOOGLE } },
      create: {
        worklistItemId: item.id, provider: GOOGLE, connectionId: connection.id,
        externalEventId: result.externalEventId, calendarId: connection.selectedCalendarId,
        syncStatus: CalendarSyncStatus.SYNCED, eventUpdatedAt: result.updatedAt, eventEtag: result.etag,
        crmScheduleHash: getWorklistScheduleHash(refreshedItem), lastSyncedAt: new Date(),
      },
      update: {
        connectionId: connection.id, externalEventId: result.externalEventId, calendarId: connection.selectedCalendarId,
        syncStatus: CalendarSyncStatus.SYNCED, eventUpdatedAt: result.updatedAt, eventEtag: result.etag,
        crmScheduleHash: getWorklistScheduleHash(refreshedItem), lastSyncedAt: new Date(), syncError: null,
      },
    });
    return { status: 'synced' as const };
  } catch (error) {
    const removed = error instanceof CalendarProviderError && error.code === 'event_removed';
    await prisma.worklistCalendarEvent.upsert({
      where: { worklistItemId_provider: { worklistItemId: item.id, provider: GOOGLE } },
      create: { worklistItemId: item.id, provider: GOOGLE, connectionId: connection.id, syncStatus: removed ? CalendarSyncStatus.REMOVED : CalendarSyncStatus.ERROR, syncError: getErrorMessage(error) },
      update: { connectionId: connection.id, externalEventId: removed ? null : undefined, syncStatus: removed ? CalendarSyncStatus.REMOVED : CalendarSyncStatus.ERROR, syncError: getErrorMessage(error), lastSyncedAt: new Date() },
    });
    if (error instanceof CalendarProviderError && error.requiresReconnect) {
      await prisma.calendarConnection.update({ where: { id: connection.id }, data: { requiresReconnect: true, syncEnabled: false, syncError: getErrorMessage(error) } });
    }
    console.error('Worklist calendar sync failed', { worklistItemId, error: getErrorMessage(error) });
    return { status: removed ? 'removed' as const : 'error' as const };
  }
}

export const getWorklistScheduleFromExternalEvent = (event: ExternalCalendarEvent) => {
  if (event.startDate) return { dueDate: new Date(`${event.startDate}T00:00:00.000Z`), dueTimeMinutes: null };
  if (!event.startDateTime) return null;
  const parts = getZonedDateTimeParts(new Date(event.startDateTime), EASTERN_TIME_ZONE);
  return {
    dueDate: new Date(`${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T00:00:00.000Z`),
    dueTimeMinutes: parts.hour * 60 + parts.minute,
  };
};

async function applyGoogleChange(connectionId: string, event: ExternalCalendarEvent) {
  const link = await prisma.worklistCalendarEvent.findFirst({
    where: { connectionId, provider: GOOGLE, externalEventId: event.id },
    include: { worklistItem: true },
  });
  if (!link) return 'ignored';
  if (event.status === 'cancelled') {
    await prisma.worklistCalendarEvent.update({
      where: { id: link.id },
      data: { externalEventId: null, syncStatus: CalendarSyncStatus.REMOVED, eventEtag: event.etag, eventUpdatedAt: event.updatedAt, lastSyncedAt: new Date(), syncError: 'Calendar event was removed by the user.' },
    });
    return 'removed';
  }
  if (event.etag && event.etag === link.eventEtag) return 'mirrored';
  const schedule = getWorklistScheduleFromExternalEvent(event);
  if (!schedule) return 'ignored';
  const sameDate = link.worklistItem.dueDate && formatDateOnlyInputValue(link.worklistItem.dueDate) === formatDateOnlyInputValue(schedule.dueDate);
  const sameTime = link.worklistItem.dueTimeMinutes === schedule.dueTimeMinutes;
  const updatedItem = sameDate && sameTime
    ? link.worklistItem
    : await prisma.worklistItem.update({ where: { id: link.worklistItemId }, data: schedule });
  await prisma.worklistCalendarEvent.update({
    where: { id: link.id },
    data: { syncStatus: CalendarSyncStatus.SYNCED, eventEtag: event.etag, eventUpdatedAt: event.updatedAt, lastSyncedAt: new Date(), syncError: null, crmScheduleHash: getWorklistScheduleHash(updatedItem) },
  });
  return sameDate && sameTime ? 'unchanged' : 'updated';
}

export async function syncGoogleCalendarConnection(connectionId: string) {
  if (!isSideEffectEnabled('calendar')) return { skipped: 1, updated: 0, removed: 0, ignored: 0 };
  const connection = await prisma.calendarConnection.findUnique({ where: { id: connectionId } });
  if (!connection || connection.provider !== GOOGLE || !connection.syncEnabled || connection.requiresReconnect) return { skipped: 1, updated: 0, removed: 0, ignored: 0 };
  const provider = getCalendarProvider(GOOGLE);
  let syncToken = connection.syncToken;
  let pageToken: string | null = null;
  let nextSyncToken: string | null = null;
  const counts = { skipped: 0, updated: 0, removed: 0, ignored: 0 };
  try {
    do {
      let page;
      try {
        page = await provider.listChanges(connection, syncToken, pageToken);
      } catch (error) {
        if (syncToken && error instanceof CalendarProviderError && error.code === 'sync_token_expired') {
          syncToken = null;
          pageToken = null;
          page = await provider.listChanges(connection, null, null);
        } else throw error;
      }
      for (const event of page.events) {
        const result = await applyGoogleChange(connection.id, event);
        if (result === 'updated') counts.updated += 1;
        else if (result === 'removed') counts.removed += 1;
        else counts.ignored += 1;
      }
      pageToken = page.nextPageToken;
      nextSyncToken = page.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
    await prisma.calendarConnection.update({ where: { id: connection.id }, data: { syncToken: nextSyncToken ?? syncToken, lastSyncAt: new Date(), syncError: null } });
    return counts;
  } catch (error) {
    const reconnect = error instanceof CalendarProviderError && error.requiresReconnect;
    await prisma.calendarConnection.update({ where: { id: connection.id }, data: { syncError: getErrorMessage(error), requiresReconnect: reconnect, syncEnabled: reconnect ? false : undefined, lastSyncAt: new Date() } });
    throw error;
  }
}

export async function syncAllGoogleCalendarConnections() {
  if (!isSideEffectEnabled('calendar')) {
    logEnvironmentEvent('calendar.poll.suppressed');
    return { attempted: 0, succeeded: 0, failed: 0, updated: 0, removed: 0, ignored: 0, retried: 0 };
  }
  const connections = await prisma.calendarConnection.findMany({ where: { provider: GOOGLE, syncEnabled: true, requiresReconnect: false }, select: { id: true } });
  const result = { attempted: connections.length, succeeded: 0, failed: 0, updated: 0, removed: 0, ignored: 0, retried: 0 };
  for (const connection of connections) {
    try {
      const retryLinks = await prisma.worklistCalendarEvent.findMany({
        where: { connectionId: connection.id, syncStatus: { in: [CalendarSyncStatus.ERROR, CalendarSyncStatus.PENDING] } },
        select: { worklistItemId: true },
      });
      for (const link of retryLinks) {
        await syncWorklistItemCalendar(link.worklistItemId);
        result.retried += 1;
      }
      const counts = await syncGoogleCalendarConnection(connection.id);
      result.succeeded += 1;
      result.updated += counts.updated;
      result.removed += counts.removed;
      result.ignored += counts.ignored;
    } catch (error) {
      result.failed += 1;
      console.error('Google calendar polling failed', { connectionId: connection.id, error: getErrorMessage(error) });
    }
  }
  return result;
}

export async function syncOutstandingWorklistItemsForUser(userId: string) {
  if (!isSideEffectEnabled('calendar')) return 0;
  const items = await prisma.worklistItem.findMany({ where: { assignedToUserId: userId, dueDate: { not: null }, status: { in: ACTIVE_STATUSES } }, select: { id: true } });
  for (const item of items) await syncWorklistItemCalendar(item.id);
  return items.length;
}
