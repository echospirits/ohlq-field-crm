import { createHash } from 'crypto';
import { CalendarProviderName, CalendarSyncStatus, WorklistStatus } from '@prisma/client';
import {
  EASTERN_TIME_ZONE,
  formatDateOnlyInputValue,
  getZonedDateTimeParts,
  isValidZonedDateTime,
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

export function getCalendarEditWinner({
  crmChangedSinceSync,
  crmUpdatedAt,
  googleUpdatedAt,
}: {
  crmChangedSinceSync: boolean;
  crmUpdatedAt: Date | null;
  googleUpdatedAt: Date | null;
}): 'CRM' | 'GOOGLE' {
  if (!crmChangedSinceSync) return 'GOOGLE';
  if (!googleUpdatedAt) return 'CRM';
  if (!crmUpdatedAt) return 'GOOGLE';
  // A timestamp tie is resolved in favor of the incoming Calendar change.
  return crmUpdatedAt.getTime() > googleUpdatedAt.getTime() ? 'CRM' : 'GOOGLE';
}

export const buildWorklistCalendarInput = ({
  item,
  accountName,
}: {
  item: NonNullable<WorklistForCalendar>;
  accountName?: string | null;
}): CalendarEventInput => {
  if (!item.dueDate) throw new Error('A due date is required to build a calendar event.');
  const date = formatDateOnlyInputValue(item.dueDate);
  if (item.dueTimeMinutes != null && !isValidZonedDateTime(date, item.dueTimeMinutes, EASTERN_TIME_ZONE)) {
    throw new Error('The Worklist schedule contains a local time that does not exist on this date.');
  }
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
  if (!force && existing?.syncStatus === CalendarSyncStatus.REMOVED) {
    if (existing.externalEventId) return { status: 'removed' as const };
    const crmChangedSinceRemoval = Boolean(existing.crmScheduleHash && existing.crmScheduleHash !== getWorklistScheduleHash(item));
    if (getCalendarEditWinner({ crmChangedSinceSync: crmChangedSinceRemoval, crmUpdatedAt: item.updatedAt, googleUpdatedAt: existing.eventUpdatedAt }) !== 'CRM') {
      return { status: 'removed' as const };
    }
  }
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
      ? await provider.updateEvent(connection, link.externalEventId, input, link.eventEtag)
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
      update: { connectionId: connection.id, syncStatus: removed ? CalendarSyncStatus.REMOVED : CalendarSyncStatus.ERROR, syncError: getErrorMessage(error), lastSyncedAt: new Date() },
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
    const outcome = await prisma.$transaction(async (tx) => {
      const [currentItem, currentLink] = await Promise.all([
        tx.worklistItem.findUnique({ where: { id: link.worklistItemId } }),
        tx.worklistCalendarEvent.findUnique({ where: { id: link.id } }),
      ]);
      if (!currentItem || !currentLink || currentLink.externalEventId !== event.id || currentLink.eventEtag !== link.eventEtag) {
        throw new Error('Calendar or Worklist data changed while reconciling a removed event. Retry the sync.');
      }
      const crmChangedSinceSync = Boolean(currentLink.crmScheduleHash && currentLink.crmScheduleHash !== getWorklistScheduleHash(currentItem));
      const winner = getCalendarEditWinner({
        crmChangedSinceSync,
        crmUpdatedAt: currentItem.updatedAt,
        googleUpdatedAt: event.updatedAt,
      });
      const updated = await tx.worklistCalendarEvent.updateMany({
        where: { id: currentLink.id, externalEventId: event.id, eventEtag: currentLink.eventEtag },
        data: winner === 'CRM'
          ? { externalEventId: null, calendarId: null, syncStatus: CalendarSyncStatus.PENDING, eventEtag: null, eventUpdatedAt: event.updatedAt, syncError: null }
          : { externalEventId: null, syncStatus: CalendarSyncStatus.REMOVED, eventEtag: event.etag, eventUpdatedAt: event.updatedAt, lastSyncedAt: new Date(), syncError: 'Calendar event was removed by the user.' },
      });
      if (updated.count !== 1) throw new Error('Calendar event changed while reconciling its removal. Retry the sync.');
      return winner === 'CRM' ? 'crm-newer' as const : 'removed' as const;
    });
    if (outcome === 'removed') return outcome;
    const syncResult = await syncWorklistItemCalendar(link.worklistItemId, { force: true });
    if (syncResult.status === 'error') throw new Error('The newer CRM task could not be restored to Google Calendar. Retry the sync.');
    return syncResult.status === 'synced' ? 'updated' : 'ignored';
  }
  if (event.etag && event.etag === link.eventEtag) return 'mirrored';
  const schedule = getWorklistScheduleFromExternalEvent(event);
  if (!schedule) return 'ignored';
  const outcome = await prisma.$transaction(async (tx) => {
    const [currentItem, currentLink] = await Promise.all([
      tx.worklistItem.findUnique({ where: { id: link.worklistItemId } }),
      tx.worklistCalendarEvent.findUnique({ where: { id: link.id } }),
    ]);
    if (!currentItem || !currentLink || currentLink.eventEtag !== link.eventEtag) {
      throw new Error('Calendar or Worklist data changed while reconciling an event. Retry the sync.');
    }

    const currentHash = getWorklistScheduleHash(currentItem);
    const crmChangedSinceSync = Boolean(currentLink.crmScheduleHash && currentLink.crmScheduleHash !== currentHash);
    const winner = getCalendarEditWinner({
      crmChangedSinceSync,
      crmUpdatedAt: currentItem.updatedAt,
      googleUpdatedAt: event.updatedAt,
    });
    if (winner === 'CRM') {
      const remembered = await tx.worklistCalendarEvent.updateMany({
        where: { id: currentLink.id, eventEtag: currentLink.eventEtag },
        data: {
          eventEtag: event.etag,
          eventUpdatedAt: event.updatedAt,
          syncStatus: CalendarSyncStatus.PENDING,
          syncError: null,
        },
      });
      if (remembered.count !== 1) throw new Error('Calendar event changed while reconciling a newer CRM edit. Retry the sync.');
      return 'crm-newer' as const;
    }

    const sameDate = currentItem.dueDate && formatDateOnlyInputValue(currentItem.dueDate) === formatDateOnlyInputValue(schedule.dueDate);
    const sameTime = currentItem.dueTimeMinutes === schedule.dueTimeMinutes;
    if (!sameDate || !sameTime) {
      const written = await tx.worklistItem.updateMany({
        where: { id: link.worklistItemId, updatedAt: currentItem.updatedAt },
        data: schedule,
      });
      if (written.count !== 1) throw new Error('Worklist item changed while applying the newer Calendar edit. Retry the sync.');
    }
    const updatedItem = sameDate && sameTime ? currentItem : { ...currentItem, ...schedule };
    const linked = await tx.worklistCalendarEvent.updateMany({
      where: { id: currentLink.id, eventEtag: currentLink.eventEtag },
      data: {
        syncStatus: CalendarSyncStatus.SYNCED,
        eventEtag: event.etag,
        eventUpdatedAt: event.updatedAt,
        lastSyncedAt: new Date(),
        syncError: null,
        crmScheduleHash: getWorklistScheduleHash(updatedItem),
      },
    });
    if (linked.count !== 1) throw new Error('Calendar event changed while applying the newer Calendar edit. Retry the sync.');
    return sameDate && sameTime ? 'unchanged' as const : 'updated' as const;
  });

  if (outcome !== 'crm-newer') return outcome;
  const syncResult = await syncWorklistItemCalendar(link.worklistItemId);
  if (syncResult.status === 'error') throw new Error('The newer CRM schedule could not be pushed to Google Calendar. Retry the sync.');
  return syncResult.status === 'synced' ? 'updated' : 'ignored';
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
