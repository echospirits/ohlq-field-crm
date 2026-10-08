import { createHash } from 'crypto';
import { WorklistStatus } from '@prisma/client';
import {
  EASTERN_TIME_ZONE,
  formatDateOnlyInputValue,
  isValidZonedDateTime,
  zonedDateTimeToUtc,
} from '../dateTime';
import { prisma } from '../prisma';
import { APP_NAME } from '../appBrand';
import { type CalendarEventInput } from './types';

type WorklistForCalendar = Awaited<ReturnType<typeof loadWorklistItem>>;

const loadWorklistItem = (id: string) => prisma.worklistItem.findUnique({
  where: { id },
  include: {
    assignedToUser: true,
    calendarEvents: { include: { connection: true } },
  },
});

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

export async function getAccountName(item: NonNullable<WorklistForCalendar>) {
  if (item.agencyId) return (await prisma.agency.findUnique({ where: { id: item.agencyId }, select: { name: true } }))?.name ?? null;
  if (item.wholesaleAccountId) return (await prisma.wholesaleAccount.findUnique({ where: { id: item.wholesaleAccountId }, select: { name: true } }))?.name ?? null;
  return null;
}
