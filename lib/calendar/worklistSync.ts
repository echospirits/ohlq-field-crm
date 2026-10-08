import { randomUUID } from 'crypto';
import { CalendarProviderName, CalendarSyncStatus, WorklistStatus, type CalendarConnection } from '@prisma/client';
import { prisma } from '../prisma';
import { EASTERN_TIME_ZONE, formatDateOnlyInputValue, getZonedDateTimeParts } from '../dateTime';
import { isSideEffectEnabled, logEnvironmentEvent } from '../appEnvironment';
import { getCalendarProvider } from './index';
import { CalendarProviderError, type ExternalCalendarEvent } from './types';
import { CalendarSyncBusyError, withCalendarSyncLock } from './syncLock';
import { buildWorklistCalendarInput, getAccountName, getCalendarEditWinner, getWorklistScheduleHash } from './scheduling';
export { buildWorklistCalendarInput, getCalendarEditWinner, getWorklistScheduleHash } from './scheduling';

const GOOGLE = CalendarProviderName.GOOGLE;
const ACTIVE: WorklistStatus[] = [WorklistStatus.OPEN, WorklistStatus.IN_PROGRESS];
const loadItem = (id: string) => prisma.worklistItem.findUnique({ where: { id }, include: { assignedToUser: true, calendarEvents: { include: { connection: true } } } });
type Item = NonNullable<Awaited<ReturnType<typeof loadItem>>>;
type Link = Item['calendarEvents'][number];
const actionable = (item: Pick<Item, 'dueDate' | 'assignedToUserId' | 'status'>) => Boolean(item.dueDate && item.assignedToUserId && ACTIVE.includes(item.status));
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 1000);
type ItemStatus = 'synced' | 'unchanged' | 'missing' | 'disabled' | 'not-connected' | 'removed' | 'error' | 'busy' | 'environment-disabled';

async function removeEvent(link: Link) {
  if (link.externalEventId) {
    if (!link.connection) throw new Error('Reconnect the original calendar before removing its event.');
    await getCalendarProvider(GOOGLE).deleteEvent({ ...link.connection, selectedCalendarId: link.calendarId ?? link.connection.selectedCalendarId }, link.externalEventId);
  }
  await prisma.worklistCalendarEvent.update({ where: { id: link.id }, data: {
    connectionId: null, externalEventId: null, calendarId: null, eventEtag: null, eventUpdatedAt: null,
    syncStatus: CalendarSyncStatus.DISABLED, syncError: null, lastSyncedAt: new Date(),
  } });
}

export const getWorklistScheduleFromExternalEvent = (event: ExternalCalendarEvent) => {
  if (event.startDate) {
    const dueDate = new Date(event.startDate + 'T00:00:00.000Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(event.startDate) || !Number.isFinite(dueDate.getTime()) || dueDate.toISOString().slice(0, 10) !== event.startDate) throw new Error('Google returned an invalid event date.');
    return { dueDate, dueTimeMinutes: null };
  }
  if (!event.startDateTime) return null;
  const startsAt = new Date(event.startDateTime);
  if (!Number.isFinite(startsAt.getTime())) throw new Error('Google returned an invalid event time.');
  const parts = getZonedDateTimeParts(startsAt, EASTERN_TIME_ZONE);
  return { dueDate: new Date(parts.year + '-' + String(parts.month).padStart(2, '0') + '-' + String(parts.day).padStart(2, '0') + 'T00:00:00.000Z'), dueTimeMinutes: parts.hour * 60 + parts.minute };
};

async function applyGoogleChange(connection: CalendarConnection, event: ExternalCalendarEvent) {
  const link = await prisma.worklistCalendarEvent.findFirst({ where: { connectionId: connection.id, calendarId: connection.selectedCalendarId, provider: GOOGLE, externalEventId: event.id } });
  if (!link) return 'ignored';
  return prisma.$transaction(async tx => {
    const item = await tx.worklistItem.findUnique({ where: { id: link.worklistItemId } });
    const current = await tx.worklistCalendarEvent.findUnique({ where: { id: link.id } });
    if (!item || !current || current.externalEventId !== event.id || current.connectionId !== connection.id || current.calendarId !== connection.selectedCalendarId || item.assignedToUserId !== connection.userId || !actionable(item)) return 'ignored';
    if (event.etag && event.etag === current.eventEtag) return 'mirrored';
    const hash = getWorklistScheduleHash(item);
    const crmChanged = Boolean(current.crmScheduleHash && current.crmScheduleHash !== hash);
    const winner = getCalendarEditWinner({ crmChangedSinceSync: crmChanged, crmUpdatedAt: item.updatedAt, googleUpdatedAt: event.updatedAt });
    const guard = { id: current.id, connectionId: connection.id, calendarId: connection.selectedCalendarId, externalEventId: event.id, eventEtag: current.eventEtag };
    if (event.status === 'cancelled') {
      const saved = await tx.worklistCalendarEvent.updateMany({ where: guard, data: {
        externalEventId: null, eventEtag: event.etag, eventUpdatedAt: event.updatedAt, crmScheduleHash: hash, lastSyncedAt: new Date(),
        syncStatus: winner === 'CRM' ? CalendarSyncStatus.PENDING : CalendarSyncStatus.REMOVED,
        syncError: winner === 'CRM' ? null : 'Calendar event was removed. Use Restore removed events to recreate it.',
      } });
      if (saved.count !== 1) throw new Error('Calendar link changed during reconciliation. Try again.');
      return winner === 'CRM' ? 'pending' : 'removed';
    }
    const schedule = getWorklistScheduleFromExternalEvent(event);
    if (!schedule) return 'ignored';
    if (winner === 'CRM') {
      const saved = await tx.worklistCalendarEvent.updateMany({ where: guard, data: { eventEtag: event.etag, eventUpdatedAt: event.updatedAt, syncStatus: CalendarSyncStatus.PENDING, syncError: null } });
      if (saved.count !== 1) throw new Error('Calendar link changed during reconciliation. Try again.');
      return 'pending';
    }
    const same = item.dueDate && formatDateOnlyInputValue(item.dueDate) === formatDateOnlyInputValue(schedule.dueDate) && item.dueTimeMinutes === schedule.dueTimeMinutes;
    if (!same) {
      const saved = await tx.worklistItem.updateMany({ where: { id: item.id, updatedAt: item.updatedAt, assignedToUserId: connection.userId, status: { in: ACTIVE } }, data: schedule });
      if (saved.count !== 1) throw new Error('Task changed while applying the calendar edit. Try again.');
    }
    const saved = await tx.worklistCalendarEvent.updateMany({ where: guard, data: {
      eventEtag: event.etag, eventUpdatedAt: event.updatedAt, lastSyncedAt: new Date(), syncError: null,
      syncStatus: crmChanged ? CalendarSyncStatus.PENDING : CalendarSyncStatus.SYNCED,
      crmScheduleHash: getWorklistScheduleHash({ ...item, ...schedule }),
    } });
    if (saved.count !== 1) throw new Error('Calendar link changed while applying the edit. Try again.');
    return same ? 'unchanged' : 'updated';
  });
}

async function syncItemUnlocked(id: string, force: boolean, checkBudget = () => {}): Promise<{ status: ItemStatus }> {
  let item = await loadItem(id);
  if (!item) return { status: 'missing' };
  let link = item.calendarEvents.find(event => event.provider === GOOGLE);
  let connection: CalendarConnection | null = null;
  try {
    if (!actionable(item)) {
      if (link) { checkBudget(); await removeEvent(link); }
      return { status: 'disabled' };
    }
    connection = await prisma.calendarConnection.findUnique({ where: { userId_provider: { userId: item.assignedToUserId!, provider: GOOGLE } } });
    if (link?.externalEventId && (link.connectionId !== connection?.id || link.calendarId !== connection?.selectedCalendarId)) {
      checkBudget();
      await removeEvent(link); // Failure keeps the old identity; never replace it.
      item = await loadItem(id);
      if (!item) return { status: 'missing' };
      link = item.calendarEvents.find(event => event.provider === GOOGLE);
    }
    if (!connection || !connection.syncEnabled || connection.requiresReconnect) {
      await prisma.worklistCalendarEvent.upsert({ where: { worklistItemId_provider: { worklistItemId: id, provider: GOOGLE } },
        create: { worklistItemId: id, provider: GOOGLE, connectionId: connection?.id, syncStatus: CalendarSyncStatus.DISABLED },
        update: { syncStatus: connection?.requiresReconnect ? CalendarSyncStatus.ERROR : CalendarSyncStatus.DISABLED, syncError: connection?.requiresReconnect ? 'Reconnect Google Calendar to continue syncing.' : 'Calendar sync is paused or not connected.' },
      });
      return { status: 'not-connected' };
    }
    if (!item || !actionable(item) || item.assignedToUserId !== connection.userId) return { status: 'busy' };
    if (link?.syncStatus === CalendarSyncStatus.REMOVED) {
      const changed = Boolean(link.crmScheduleHash && link.crmScheduleHash !== getWorklistScheduleHash(item));
      if (!force && getCalendarEditWinner({ crmChangedSinceSync: changed, crmUpdatedAt: item.updatedAt, googleUpdatedAt: link.eventUpdatedAt }) !== 'CRM') return { status: 'removed' };
      await prisma.worklistCalendarEvent.update({ where: { id: link.id }, data: { externalEventId: null, eventEtag: null, syncStatus: CalendarSyncStatus.PENDING } });
      item = await loadItem(id);
      if (!item) return { status: 'missing' };
      link = item.calendarEvents.find(event => event.provider === GOOGLE);
    }
    const provider = getCalendarProvider(GOOGLE);
    if (link?.externalEventId) {
      checkBudget();
      const remote = await provider.getEvent(connection, link.externalEventId);
      if (remote) await applyGoogleChange(connection, remote);
      else if (link.eventEtag) await applyGoogleChange(connection, { id: link.externalEventId, status: 'cancelled', title: null, description: null, startDate: null, startDateTime: null, etag: null, updatedAt: null, privateMetadata: {} });
      item = await loadItem(id);
      if (!item) return { status: 'missing' };
      link = item.calendarEvents.find(event => event.provider === GOOGLE);
      if (!item || !actionable(item) || item.assignedToUserId !== connection.userId) return { status: 'busy' };
      if (link?.syncStatus === CalendarSyncStatus.REMOVED) {
        if (!force) return { status: 'removed' };
        await prisma.worklistCalendarEvent.update({ where: { id: link.id }, data: { externalEventId: null, eventEtag: null, syncStatus: CalendarSyncStatus.PENDING } });
        item = await loadItem(id);
        if (!item) return { status: 'missing' };
        link = item.calendarEvents.find(event => event.provider === GOOGLE);
      }
    }
    if (!force && link?.eventEtag && link.syncStatus === CalendarSyncStatus.SYNCED && link.crmScheduleHash === getWorklistScheduleHash(item)) return { status: 'unchanged' };
    const input = buildWorklistCalendarInput({ item, accountName: await getAccountName(item) });
    if (!link?.externalEventId) {
      const reservedEventId = randomUUID().replaceAll('-', '');
      link = await prisma.worklistCalendarEvent.upsert({ where: { worklistItemId_provider: { worklistItemId: id, provider: GOOGLE } },
        create: { worklistItemId: id, provider: GOOGLE, connectionId: connection.id, calendarId: connection.selectedCalendarId, externalEventId: reservedEventId, syncStatus: CalendarSyncStatus.PENDING },
        update: { connectionId: connection.id, calendarId: connection.selectedCalendarId, externalEventId: reservedEventId, eventEtag: null, syncStatus: CalendarSyncStatus.PENDING },
        include: { connection: true },
      });
    }
    // Reserve before POST; an uncertain response is recovered using this same ID.
    checkBudget();
    const result = link.eventEtag
      ? await provider.updateEvent(connection, link.externalEventId!, input, link.eventEtag)
      : await provider.createEvent(connection, input, link.externalEventId!);
    const latest = await loadItem(id);
    const unchanged = latest && getWorklistScheduleHash(latest) === getWorklistScheduleHash(item);
    await prisma.worklistCalendarEvent.update({ where: { id: link.id }, data: {
      syncStatus: unchanged ? CalendarSyncStatus.SYNCED : CalendarSyncStatus.PENDING,
      eventEtag: result.etag, eventUpdatedAt: result.updatedAt, crmScheduleHash: getWorklistScheduleHash(item), lastSyncedAt: new Date(), syncError: null,
    } });
    return { status: unchanged ? 'synced' : 'busy' };
  } catch (error) {
    if (!item || !await loadItem(id)) return { status: 'missing' };
    const removed = error instanceof CalendarProviderError && error.code === 'event_removed';
    await prisma.worklistCalendarEvent.upsert({ where: { worklistItemId_provider: { worklistItemId: id, provider: GOOGLE } },
      create: { worklistItemId: id, provider: GOOGLE, connectionId: connection?.id, syncStatus: removed ? CalendarSyncStatus.REMOVED : CalendarSyncStatus.ERROR, syncError: errorMessage(error) },
      update: { syncStatus: removed ? CalendarSyncStatus.REMOVED : CalendarSyncStatus.ERROR, syncError: errorMessage(error), lastSyncedAt: new Date(), ...(removed ? { externalEventId: null, eventEtag: null, crmScheduleHash: getWorklistScheduleHash(item) } : {}) },
    });
    if (error instanceof CalendarProviderError && error.requiresReconnect) {
      const failedConnectionId = link?.externalEventId ? link.connectionId : connection?.id;
      if (failedConnectionId) await prisma.calendarConnection.update({ where: { id: failedConnectionId }, data: { requiresReconnect: true, syncEnabled: false, syncError: errorMessage(error) } });
    }
    console.error('Worklist calendar sync failed', { worklistItemId: id, error: errorMessage(error) });
    return { status: removed ? 'removed' : 'error' };
  }
}

export async function syncWorklistItemCalendar(id: string, { force = false } = {}): Promise<{ status: ItemStatus }> {
  if (!isSideEffectEnabled('calendar')) return { status: 'environment-disabled' };
  try { return await withCalendarSyncLock(() => syncItemUnlocked(id, force)); }
  catch (error) {
    if (!(error instanceof CalendarSyncBusyError)) throw error;
    if (!await loadItem(id)) return { status: 'missing' };
    await prisma.worklistCalendarEvent.upsert({ where: { worklistItemId_provider: { worklistItemId: id, provider: GOOGLE } }, create: { worklistItemId: id, provider: GOOGLE, syncStatus: CalendarSyncStatus.PENDING }, update: {} });
    return { status: 'busy' };
  }
}

const emptyCounts = (reason?: string) => ({ skipped: reason ? 1 : 0, reason: reason ?? null, updated: 0, removed: 0, ignored: 0, pushed: 0, failed: 0 });
async function reconcileUnlocked(connectionId: string, restoreRemoved: boolean, budgetMs: number) {
  const connection = await prisma.calendarConnection.findUnique({ where: { id: connectionId } });
  if (!connection || connection.provider !== GOOGLE) return emptyCounts('not-connected');
  if (connection.requiresReconnect) return emptyCounts('reconnect');
  if (!connection.syncEnabled) return emptyCounts('paused');
  const counts = emptyCounts();
  const provider = getCalendarProvider(GOOGLE);
  let syncToken = connection.syncToken;
  let pageToken: string | null = null;
  let nextSyncToken: string | null = null;
  const started = Date.now();
  const checkBudget = () => { if (Date.now() - started > budgetMs) throw new Error('Calendar check exceeded its time budget. The previous cursor was retained; try again.'); };
  try {
    do {
      checkBudget();
      let page;
      try { page = await provider.listChanges(connection, syncToken, pageToken); }
      catch (error) {
        if (!syncToken || !(error instanceof CalendarProviderError) || error.code !== 'sync_token_expired') throw error;
        syncToken = null; pageToken = null; nextSyncToken = null;
        page = await provider.listChanges(connection, null, null);
      }
      for (const event of page.events) {
        checkBudget();
        const outcome = await applyGoogleChange(connection, event);
        if (outcome === 'updated') counts.updated++;
        else if (outcome === 'removed') counts.removed++;
        else counts.ignored++;
      }
      pageToken = page.nextPageToken; nextSyncToken = page.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
    if (!nextSyncToken) throw new Error('Google did not return a complete sync cursor. Try again.');
    // Pull first, then recover deferred creates, changed tasks, and old-owner cleanup.
    const items = await prisma.worklistItem.findMany({ where: { OR: [
      { assignedToUserId: connection.userId, dueDate: { not: null }, status: { in: ACTIVE } },
      { calendarEvents: { some: { connectionId: connection.id, provider: GOOGLE } } },
    ] }, select: { id: true } });
    for (const item of items) {
      checkBudget();
      const result = await syncItemUnlocked(item.id, restoreRemoved, checkBudget);
      if (result.status === 'synced') counts.pushed++;
      else if (['error', 'busy', 'not-connected'].includes(result.status)) counts.failed++;
    }
    const saved = await prisma.calendarConnection.updateMany({ where: { id: connection.id, selectedCalendarId: connection.selectedCalendarId, providerAccountId: connection.providerAccountId, syncToken: connection.syncToken }, data: {
      syncToken: nextSyncToken, lastSyncAt: counts.failed ? undefined : new Date(),
      syncError: counts.failed ? counts.failed + ' task(s) could not finish syncing. Check task calendar status and retry.' : null,
    } });
    if (saved.count !== 1) throw new Error('Calendar settings changed during the check. Try again.');
    logEnvironmentEvent('calendar.check.completed', { connectionId, ...counts, durationMs: Date.now() - started });
    return counts;
  } catch (error) {
    const reconnect = error instanceof CalendarProviderError && error.requiresReconnect;
    await prisma.calendarConnection.updateMany({ where: { id: connection.id, selectedCalendarId: connection.selectedCalendarId, providerAccountId: connection.providerAccountId }, data: { syncError: errorMessage(error), ...(reconnect ? { requiresReconnect: true, syncEnabled: false } : {}) } });
    throw error;
  }
}

export async function syncGoogleCalendarConnection(connectionId: string, { restoreRemoved = false, budgetMs = 180_000 } = {}) {
  if (!isSideEffectEnabled('calendar')) return emptyCounts('environment-disabled');
  try { return await withCalendarSyncLock(() => reconcileUnlocked(connectionId, restoreRemoved, Math.min(budgetMs, 180_000))); }
  catch (error) { if (error instanceof CalendarSyncBusyError) return emptyCounts('busy'); throw error; }
}

export async function syncAllGoogleCalendarConnections() {
  const result = { attempted: 0, succeeded: 0, failed: 0, skipped: 0, updated: 0, removed: 0, ignored: 0, retried: 0 };
  if (!isSideEffectEnabled('calendar')) return result;
  const connections = await prisma.calendarConnection.findMany({ where: { provider: GOOGLE, syncEnabled: true, requiresReconnect: false }, select: { id: true } });
  result.attempted = connections.length;
  const started = Date.now();
  for (const [index, connection] of connections.entries()) {
    const remaining = 240_000 - (Date.now() - started);
    if (remaining < 30_000) {
      result.failed += connections.length - index;
      logEnvironmentEvent('calendar.poll.budget-exhausted', { remainingConnections: connections.length - index });
      break;
    }
    try {
      const counts = await syncGoogleCalendarConnection(connection.id, { budgetMs: remaining - 30_000 });
      result.updated += counts.updated; result.removed += counts.removed; result.ignored += counts.ignored; result.retried += counts.pushed;
      if (counts.skipped) result.skipped++;
      else if (counts.failed) result.failed++;
      else result.succeeded++;
    } catch (error) { result.failed++; console.error('Google calendar polling failed', { connectionId: connection.id, error: errorMessage(error) }); }
  }
  logEnvironmentEvent('calendar.poll.completed', result);
  return result;
}

export async function syncOutstandingWorklistItemsForUser(userId: string) {
  const connection = await prisma.calendarConnection.findUnique({ where: { userId_provider: { userId, provider: GOOGLE } } });
  return connection ? syncGoogleCalendarConnection(connection.id) : emptyCounts('not-connected');
}

export async function changeGoogleCalendarSettings(userId: string, calendarId: string, syncEnabled: boolean, disconnect = false) {
  if (!isSideEffectEnabled('calendar')) return { status: 'environment-disabled' };
  try {
    return await withCalendarSyncLock(async () => {
      const started = Date.now();
      const connection = await prisma.calendarConnection.findUnique({ where: { userId_provider: { userId, provider: GOOGLE } } });
      if (!connection) return { status: 'not-connected' };
      const calendars = disconnect ? [] : await getCalendarProvider(GOOGLE).listCalendars(connection);
      const selected = calendars.find(calendar => calendar.id === calendarId);
      if (!disconnect && !selected) return { status: 'invalid-calendar' };
      const changed = !disconnect && selected!.id !== connection.selectedCalendarId;
      if (disconnect || changed || !syncEnabled) {
        await prisma.calendarConnection.update({ where: { id: connection.id }, data: { syncEnabled: false } });
        const links = await prisma.worklistCalendarEvent.findMany({ where: { connectionId: connection.id }, include: { connection: true } });
        for (const link of links) {
          try {
            if (Date.now() - started > 180_000) throw new Error('Calendar cleanup exceeded its time budget. Retry to finish removing the remaining events.');
            await removeEvent(link);
          }
          catch (error) {
            await prisma.worklistCalendarEvent.update({ where: { id: link.id }, data: { syncStatus: CalendarSyncStatus.ERROR, syncError: errorMessage(error) } });
            await prisma.calendarConnection.update({ where: { id: connection.id }, data: { syncError: 'Some events could not be removed. Reconnect if needed, then retry the settings change.', ...(error instanceof CalendarProviderError && error.requiresReconnect ? { requiresReconnect: true } : {}) } });
            return { status: 'cleanup-failed' };
          }
        }
      }
      if (disconnect) { await prisma.calendarConnection.delete({ where: { id: connection.id } }); return { status: 'disconnected' }; }
      await prisma.calendarConnection.update({ where: { id: connection.id }, data: { selectedCalendarId: selected!.id, selectedCalendarName: selected!.name, syncEnabled, ...(changed ? { syncToken: null, lastSyncAt: null } : {}), syncError: null } });
      return { status: 'updated' };
    });
  } catch (error) {
    if (error instanceof CalendarSyncBusyError) return { status: 'busy' };
    console.error('Calendar settings change failed', { userId, error: errorMessage(error) });
    return { status: 'settings-failed' };
  }
}
