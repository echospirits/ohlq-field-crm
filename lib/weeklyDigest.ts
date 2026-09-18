import { PhotoType, UserRole, WeeklyDigestStatus, WeeklyDigestType, WorklistStatus, WorklistCategory, type WorklistSource } from '@prisma/client';
import { getUserDisplayName } from './auth';
import { EASTERN_TIME_ZONE, formatDateInputValue, addDaysToDateInputValue, zonedDateTimeToUtc } from './dateTime';
import { getEmailAppBaseUrl, sendEmail, type SendEmailFn } from './email/sendEmail';
import { prisma } from './prisma';
import { ECHO_ORGANIZATION_ID } from './organizations';
import { formatWholesaleLicenseeIds } from './wholesaleAccounts';
import { getWeeklyDigestSales, type WeeklyDigestSales } from './weeklyDigestSales';
import { generateWeeklyDigestNarrative, type DigestNarrative, type DigestEvidence } from './weeklyDigestNarrative';
export { renderTenantWeeklyDigestEmail } from './weeklyDigestEmail';
import { renderTenantWeeklyDigestEmail } from './weeklyDigestEmail';

export const DEFAULT_DIGEST_TIME_ZONE = EASTERN_TIME_ZONE;
const DAY_MS = 24 * 60 * 60 * 1000;
const inactiveWorklistStatuses: WorklistStatus[] = [WorklistStatus.COMPLETED, WorklistStatus.CANCELLED];
export type WeeklyDigestWindow = { now: Date; timeZone: string; pastStart: Date; pastEnd: Date; upcomingStart: Date; upcomingEnd: Date };
type DigestLocation = { name: string; href: string | null; meta?: string | null };
export type DigestVisit = {
  id: string; visitAt: Date; locationType: string; location: DigestLocation; contactName: string | null;
  summary: string | null; outcomes: string | null; nextStep: string | null; followUpDate: Date | null;
  createdByName: string; photoCount: number; photoCountsByType: Partial<Record<PhotoType, number>>;
};
export type DigestWorklistItem = {
  id: string; title: string; detail: string | null; status: WorklistStatus; source: WorklistSource;
  category: WorklistCategory; dueDate: Date | null; completedAt: Date | null; location: DigestLocation;
  assignedToName: string | null; completedByName: string | null; createdByName: string | null;
};
export type WorklistBuckets = { overdue: DigestWorklistItem[]; dueToday: DigestWorklistItem[]; dueThisWeekend: DigestWorklistItem[]; dueNextWeek: DigestWorklistItem[]; noDueDate: DigestWorklistItem[] };
export type DigestBrand = { id: string; displayName: string; appName: string; digestName: string; logoUrl: string | null; brandPrimaryColor: string; brandAccentColor: string; timezone: string };
export type TenantWeeklyDigest = {
  organization: DigestBrand; window: WeeklyDigestWindow; sales: WeeklyDigestSales;
  metrics: { visitsLogged: number; completedWork: number; overdue: number; unassignedOverdue: number; upcoming: number; unassignedUpcoming: number };
  evidence: DigestEvidence[]; evidenceLimited: boolean; narrative: DigestNarrative;
};
export type RenderedDigestEmail = { subject: string; html: string; text: string };
export type DigestSendResult = { recipientEmail: string; digestType: WeeklyDigestType; status: 'sent' | 'skipped' | 'failed'; providerMessageId?: string; errorMessage?: string };
export type DigestRunResult = { attempted: number; sent: number; skipped: number; failed: number; missingEmailSkipped: number; results: DigestSendResult[] };

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
};

const datePartsFormatterCache = new Map<string, Intl.DateTimeFormat>();

const getDatePartsFormatter = (timeZone: string) => {
  const existing = datePartsFormatterCache.get(timeZone);

  if (existing) {
    return existing;
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  datePartsFormatterCache.set(timeZone, formatter);
  return formatter;
};

export const getZonedDateParts = (date: Date, timeZone = DEFAULT_DIGEST_TIME_ZONE): ZonedDateParts => {
  const parts = Object.fromEntries(
    getDatePartsFormatter(timeZone)
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: String(parts.weekday),
  };
};

// A fixed Friday-to-Friday calendar window gives cron retries and manual sends
// the same identity, including across DST. Sales cover Friday through Thursday.
export const getWeeklyDigestWindow = (now = new Date(), timeZone = DEFAULT_DIGEST_TIME_ZONE): WeeklyDigestWindow => {
  const today = formatDateInputValue(now, timeZone);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const endDay = addDaysToDateInputValue(today, -((weekday + 2) % 7));
  const pastEnd = zonedDateTimeToUtc(endDay, 0, timeZone);
  return { now, timeZone, pastStart: zonedDateTimeToUtc(addDaysToDateInputValue(endDay, -7), 0, timeZone), pastEnd,
    upcomingStart: pastEnd, upcomingEnd: zonedDateTimeToUtc(addDaysToDateInputValue(endDay, 7), 0, timeZone) };
};
export const isWeeklyDigestCronSendWindow = (now = new Date(), timeZone = DEFAULT_DIGEST_TIME_ZONE) => {
  const local = getZonedDateParts(now, timeZone);
  return local.weekday === 'Fri' && (local.hour === 8 || local.hour === 9);
};
export const shouldSkipExistingDigestLog = (log: { status: WeeklyDigestStatus } | null | undefined) => log?.status === WeeklyDigestStatus.SENT;

const visitInclude = { createdByUser: true, photos: { select: { type: true } } } as const;
const workInclude = { assignedToUser: true, completedByUser: true, createdByUser: true } as const;
async function getVisitRecords(organizationId: string, window: WeeklyDigestWindow) {
  return prisma.loggedVisit.findMany({ where: { organizationId, visitAt: { gte: window.pastStart, lt: window.pastEnd } },
    include: visitInclude, orderBy: [{ visitAt: 'desc' }, { id: 'asc' }], take: 300 });
}
async function getWorklistRecords(organizationId: string, window: WeeklyDigestWindow) {
  const [completedWork, openWork] = await Promise.all([
    prisma.worklistItem.findMany({ where: { organizationId, status: WorklistStatus.COMPLETED, completedAt: { gte: window.pastStart, lt: window.pastEnd } },
      include: workInclude, orderBy: [{ completedAt: 'desc' }, { id: 'asc' }], take: 150 }),
    prisma.worklistItem.findMany({ where: { organizationId, status: { notIn: inactiveWorklistStatuses }, dueDate: { lt: window.upcomingEnd } },
      include: workInclude, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], take: 150 }),
  ]);
  return { completedWork, openWork };
}
type VisitRecord = Awaited<ReturnType<typeof getVisitRecords>>[number];
type WorklistRecords = Awaited<ReturnType<typeof getWorklistRecords>>;
type WorklistRecord = WorklistRecords['completedWork'][number] | WorklistRecords['openWork'][number];
export const isOpenWorklistStatus = (status: WorklistStatus) => !inactiveWorklistStatuses.includes(status);

export const isCompletedInPastWindow = (
  item: Pick<DigestWorklistItem, 'status' | 'completedAt'>,
  window: WeeklyDigestWindow,
) =>
  item.status === WorklistStatus.COMPLETED &&
  Boolean(item.completedAt) &&
  item.completedAt!.getTime() >= window.pastStart.getTime() &&
  item.completedAt!.getTime() < window.pastEnd.getTime();

const getLocalDayKey = (date: Date, timeZone: string) => {
  const parts = getZonedDateParts(date, timeZone);

  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
};

const getLocalWeekday = (date: Date, timeZone: string) => getZonedDateParts(date, timeZone).weekday;

export const bucketWorklistItems = (
  items: DigestWorklistItem[],
  window: WeeklyDigestWindow,
): WorklistBuckets => {
  const todayKey = getLocalDayKey(window.now, window.timeZone);
  const buckets: WorklistBuckets = {
    overdue: [],
    dueToday: [],
    dueThisWeekend: [],
    dueNextWeek: [],
    noDueDate: [],
  };

  for (const item of items) {
    if (!isOpenWorklistStatus(item.status)) {
      continue;
    }

    if (!item.dueDate) {
      buckets.noDueDate.push(item);
      continue;
    }

    if (item.dueDate.getTime() < window.upcomingStart.getTime()) {
      buckets.overdue.push(item);
      continue;
    }

    if (item.dueDate.getTime() >= window.upcomingEnd.getTime()) {
      continue;
    }

    if (getLocalDayKey(item.dueDate, window.timeZone) === todayKey) {
      buckets.dueToday.push(item);
      continue;
    }

    const weekday = getLocalWeekday(item.dueDate, window.timeZone);

    if (weekday === 'Sat' || weekday === 'Sun') {
      buckets.dueThisWeekend.push(item);
    } else {
      buckets.dueNextWeek.push(item);
    }
  }

  return buckets;
};

const getLocationLookups = async (visits: VisitRecord[], workItems: WorklistRecord[]) => {
  const agencyIds = new Set<string>();
  const wholesaleIds = new Set<string>();
  const contactIds = new Set<string>();

  for (const visit of visits) {
    if (visit.agencyId) agencyIds.add(visit.agencyId);
    if (visit.wholesaleAccountId) wholesaleIds.add(visit.wholesaleAccountId);
    if (visit.contactId) contactIds.add(visit.contactId);
  }

  for (const item of workItems) {
    if (item.agencyId) agencyIds.add(item.agencyId);
    if (item.wholesaleAccountId) wholesaleIds.add(item.wholesaleAccountId);
  }

  const [agencies, wholesaleAccounts, contacts] = await Promise.all([
    prisma.agency.findMany({
      where: { id: { in: Array.from(agencyIds) } },
      select: { id: true, agencyId: true, name: true, city: true, county: true },
    }),
    prisma.wholesaleAccount.findMany({
      where: { id: { in: Array.from(wholesaleIds) } },
      select: {
        id: true,
        licenseeId: true,
        licenseeIds: { select: { licenseeId: true } },
        name: true,
        city: true,
        county: true,
      },
    }),
    prisma.locationContact.findMany({
      where: { id: { in: Array.from(contactIds) } },
      select: { id: true, name: true, role: true },
    }),
  ]);

  return {
    agencyMap: new Map(agencies.map((agency) => [agency.id, agency])),
    wholesaleMap: new Map(wholesaleAccounts.map((account) => [account.id, account])),
    contactMap: new Map(contacts.map((contact) => [contact.id, contact])),
  };
};

const visitToDigestVisit = (
  visit: VisitRecord,
  lookups: Awaited<ReturnType<typeof getLocationLookups>>,
): DigestVisit => {
  const agency = visit.agencyId ? lookups.agencyMap.get(visit.agencyId) : null;
  const wholesale = visit.wholesaleAccountId ? lookups.wholesaleMap.get(visit.wholesaleAccountId) : null;
  const contact = visit.contactId ? lookups.contactMap.get(visit.contactId) : null;
  const photoCountsByType = visit.photos.reduce<Partial<Record<PhotoType, number>>>((counts, photo) => {
    counts[photo.type] = (counts[photo.type] ?? 0) + 1;
    return counts;
  }, {});

  return {
    id: visit.id,
    visitAt: visit.visitAt,
    locationType: visit.locationType,
    location:
      visit.locationType === 'agency'
        ? {
            name: agency?.name ?? 'Agency visit',
            href: visit.agencyId ? `/agencies/${visit.agencyId}` : null,
            meta: agency?.agencyId ?? null,
          }
        : {
            name: wholesale?.name ?? 'Wholesale visit',
            href: visit.wholesaleAccountId ? `/wholesale/${visit.wholesaleAccountId}` : null,
            meta: wholesale ? formatWholesaleLicenseeIds(wholesale) : null,
          },
    contactName: contact ? [contact.name, contact.role].filter(Boolean).join(', ') : null,
    summary: visit.summary,
    outcomes: visit.outcomes,
    nextStep: visit.nextStep,
    followUpDate: visit.followUpDate,
    createdByName: visit.createdByUser ? getUserDisplayName(visit.createdByUser) : visit.createdBy ?? 'Unknown user',
    photoCount: visit.photos.length,
    photoCountsByType,
  };
};

const workItemToDigestItem = (
  item: WorklistRecord,
  lookups: Awaited<ReturnType<typeof getLocationLookups>>,
): DigestWorklistItem => {
  const agency = item.agencyId ? lookups.agencyMap.get(item.agencyId) : null;
  const wholesale = item.wholesaleAccountId ? lookups.wholesaleMap.get(item.wholesaleAccountId) : null;
  const location =
    item.category === WorklistCategory.AGENCY
      ? {
          name: agency?.name ?? 'Agency',
          href: item.agencyId ? `/agencies/${item.agencyId}` : null,
          meta: agency?.agencyId ?? null,
        }
      : item.category === WorklistCategory.WHOLESALE
        ? {
            name: wholesale?.name ?? 'Wholesale account',
            href: item.wholesaleAccountId ? `/wholesale/${item.wholesaleAccountId}` : null,
            meta: wholesale ? formatWholesaleLicenseeIds(wholesale) : null,
          }
        : {
            name: 'General',
            href: null,
            meta: null,
          };

  return {
    id: item.id,
    title: item.title,
    detail: item.detail,
    status: item.status,
    source: item.source,
    category: item.category,
    dueDate: item.dueDate,
    completedAt: item.completedAt,
    location,
    assignedToName: item.assignedToUser ? getUserDisplayName(item.assignedToUser) : item.assignedTo,
    completedByName: item.completedByUser ? getUserDisplayName(item.completedByUser) : null,
    createdByName: item.createdByUser ? getUserDisplayName(item.createdByUser) : item.createdBy,
  };
};

export async function getTenantWeeklyDigest(organizationId: string, requestedWindow = getWeeklyDigestWindow(),
  summarize: typeof generateWeeklyDigestNarrative = generateWeeklyDigestNarrative): Promise<TenantWeeklyDigest> {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: {
    id: true, displayName: true, appName: true, digestName: true, logoUrl: true, brandPrimaryColor: true, brandAccentColor: true, timezone: true,
  } });
  if (!organization) throw new Error('Digest tenant not found.');
  const window = getWeeklyDigestWindow(requestedWindow.now, organization.timezone);
  const visitWhere = { organizationId, visitAt: { gte: window.pastStart, lt: window.pastEnd } };
  const completedWhere = { organizationId, status: WorklistStatus.COMPLETED, completedAt: { gte: window.pastStart, lt: window.pastEnd } };
  // Worklist dueDate is a date-only value stored at UTC midnight.
  const dueStart = new Date(`${formatDateInputValue(window.upcomingStart, window.timeZone)}T00:00:00Z`);
  const dueEnd = new Date(`${formatDateInputValue(window.upcomingEnd, window.timeZone)}T00:00:00Z`);
  const overdueWhere = { organizationId, status: { notIn: inactiveWorklistStatuses }, dueDate: { lt: dueStart } };
  const upcomingWhere = { organizationId, status: { notIn: inactiveWorklistStatuses }, dueDate: { gte: dueStart, lt: dueEnd } };
  const unassigned = { assignedToUserId: null, OR: [{ assignedTo: null }, { assignedTo: '' }] };
  const [visits, work, sales, visitsLogged, completedWork, overdue, unassignedOverdue, upcoming, unassignedUpcoming] = await Promise.all([
    getVisitRecords(organizationId, window), getWorklistRecords(organizationId, { ...window, upcomingEnd: dueEnd }),
    getWeeklyDigestSales(organizationId, window), prisma.loggedVisit.count({ where: visitWhere }),
    prisma.worklistItem.count({ where: completedWhere }), prisma.worklistItem.count({ where: overdueWhere }),
    prisma.worklistItem.count({ where: { ...overdueWhere, ...unassigned } }), prisma.worklistItem.count({ where: upcomingWhere }),
    prisma.worklistItem.count({ where: { ...upcomingWhere, ...unassigned } }),
  ]);
  const lookups = await getLocationLookups(visits, [...work.completedWork, ...work.openWork]);
  const clip = (value: string) => value.length > 900 ? `${value.slice(0, 897)}...` : value;
  const evidence: DigestEvidence[] = [
    ...visits.map((record): DigestEvidence => {
      const visit = visitToDigestVisit(record, lookups);
      return { id: `visit:${visit.id}`, kind: 'visit', account: visit.location.name, href: visit.location.href,
        date: visit.visitAt.toISOString(), owner: visit.createdByName,
        text: clip([visit.summary, visit.outcomes && `Reported outcomes: ${visit.outcomes}`, visit.nextStep && `Next step: ${visit.nextStep}`,
          visit.followUpDate && `Follow-up date: ${visit.followUpDate.toISOString().slice(0, 10)}`].filter(Boolean).join('\n')) };
    }),
    ...[...work.completedWork, ...work.openWork].map((record): DigestEvidence => {
      const item = workItemToDigestItem(record, lookups);
      return { id: `task:${item.id}`, kind: item.status === WorklistStatus.COMPLETED ? 'completed' : item.dueDate! < dueStart ? 'overdue' : 'upcoming',
        account: item.location.name, href: item.location.href, date: (item.completedAt ?? item.dueDate!).toISOString(),
        owner: item.assignedToName, text: clip([item.title, item.detail].filter(Boolean).join('\n')) };
    }),
  ];
  const input = { organization, window, sales, metrics: { visitsLogged, completedWork, overdue, unassignedOverdue, upcoming, unassignedUpcoming }, evidence,
    evidenceLimited: visitsLogged > visits.length || completedWork > work.completedWork.length || overdue + upcoming > work.openWork.length };
  return { ...input, narrative: await summarize(input) };
}

const uniqueDigestWhere = (
  organizationId: string,
  digestType: WeeklyDigestType,
  recipientEmail: string,
  window: WeeklyDigestWindow,
) => ({
  organizationId_digestType_recipientEmail_periodStart_periodEnd: {
    organizationId,
    digestType,
    recipientEmail,
    periodStart: window.pastStart,
    periodEnd: window.pastEnd,
  },
});

async function sendRenderedDigestWithLog({
  digestType,
  recipientUserId,
  recipientEmail,
  window,
  rendered,
  emailSender = sendEmail,
  organizationId,
}: {
  digestType: WeeklyDigestType;
  recipientUserId: string | null;
  recipientEmail: string;
  window: WeeklyDigestWindow;
  rendered: RenderedDigestEmail;
  emailSender?: SendEmailFn;
  organizationId: string;
}): Promise<DigestSendResult> {
  // Reuse the team enum in storage; USER_WEEKLY remains only for historical logs.
  // Match legacy rolling windows ending on this Friday as well, preventing a
  // second email during the transition to the fixed calendar-week identity.
  const existing = await prisma.weeklyDigestLog.findFirst({
    where: { organizationId, recipientEmail: { equals: recipientEmail, mode: 'insensitive' }, status: WeeklyDigestStatus.SENT,
      periodEnd: { gte: window.pastEnd, lt: new Date(window.pastEnd.getTime() + 26 * 60 * 60 * 1000) } },
  });
  if (shouldSkipExistingDigestLog(existing)) return { recipientEmail, digestType, status: 'skipped', providerMessageId: existing!.providerMessageId ?? undefined };

  const log = await prisma.weeklyDigestLog.upsert({
    where: uniqueDigestWhere(organizationId, digestType, recipientEmail, window),
    create: { organizationId, digestType, recipientUserId, recipientEmail, periodStart: window.pastStart, periodEnd: window.pastEnd,
      scheduledFor: window.now, status: WeeklyDigestStatus.PENDING },
    update: {},
  });
  const claimed = await prisma.weeklyDigestLog.updateMany({
    where: { id: log.id, status: { not: WeeklyDigestStatus.SENT }, OR: [
      { status: { not: WeeklyDigestStatus.PENDING } }, { runAt: null }, { runAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } },
    ] },
    data: { status: WeeklyDigestStatus.PENDING, recipientUserId, runAt: new Date(), errorMessage: null, lastSkipReason: null, attemptCount: { increment: 1 } },
  });
  if (!claimed.count) return { recipientEmail, digestType, status: 'skipped' };

  try {
    const sent = await emailSender({
      to: recipientEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: `${organizationId}:${digestType}:${recipientEmail}:${window.pastStart.toISOString()}:${window.pastEnd.toISOString()}`,
    });

    if (sent.suppressed) {
      await prisma.weeklyDigestLog.update({
        where: { id: log.id },
        data: {
          organizationId,
          status: WeeklyDigestStatus.SKIPPED,
          errorMessage: null,
          lastSkippedAt: new Date(),
          lastSkipReason: 'Email delivery is disabled in this environment.',
          runAt: new Date(),
        },
      });
      return { recipientEmail, digestType, status: 'skipped' };
    }

    await prisma.weeklyDigestLog.update({
      where: { id: log.id },
      data: {
        organizationId,
        status: WeeklyDigestStatus.SENT,
        providerMessageId: sent.providerMessageId,
        errorMessage: null,
        runAt: new Date(),
      },
    });

    return {
      recipientEmail,
      digestType,
      status: 'sent',
      providerMessageId: sent.providerMessageId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown email send failure';

    await prisma.weeklyDigestLog.update({
      where: { id: log.id },
      data: {
        status: WeeklyDigestStatus.FAILED,
        errorMessage,
        runAt: new Date(),
      },
    });

    return {
      recipientEmail,
      digestType,
      status: 'failed',
      errorMessage,
    };
  }
}

export async function sendTestWeeklyDigestEmail({
  recipientEmail,
  rendered,
  emailSender = sendEmail,
}: {
  recipientEmail: string;
  rendered: RenderedDigestEmail;
  emailSender?: SendEmailFn;
}) {
  return emailSender({
    to: recipientEmail,
    subject: `[TEST] ${rendered.subject}`,
    html: rendered.html,
    text: rendered.text,
    idempotencyKey: `test:${recipientEmail}:${rendered.subject}:${Date.now()}`,
  });
}


export async function sendWeeklyDigestForAllUsers(options: {
  window?: WeeklyDigestWindow;
  organizationId?: string;
  emailSender?: SendEmailFn;
  appBaseUrl?: string;
  digestLoader?: typeof getTenantWeeklyDigest;
} = {}): Promise<DigestRunResult> {
  const window = options.window ?? getWeeklyDigestWindow();
  const entitledOrganizations = await prisma.organizationFeature.findMany({
    where: { ...(options.organizationId ? { organizationId: options.organizationId } : {}), featureKey: 'WEEKLY_DIGEST', enabled: true,
      organization: { active: true, accountStatus: { notIn: ['SUSPENDED', 'CANCELLED'] } } }, select: { organizationId: true },
  });
  const entitled = new Set(entitledOrganizations.map((item) => item.organizationId));
  const recipients = await prisma.user.findMany({
    where: { isActive: true, OR: [
      { organizationId: { in: [...entitled] } },
      // Preserve Echo delivery for platform administrators without a home tenant.
      // Administrators who belong to a tenant receive that tenant's brief.
      ...(entitled.has(ECHO_ORGANIZATION_ID) ? [{ role: UserRole.PLATFORM_ADMIN, organizationId: null }] : []),
    ] },
    orderBy: [{ organizationId: 'asc' }, { id: 'asc' }],
    select: { id: true, organizationId: true, email: true, role: true },
  });
  const results: DigestSendResult[] = [];
  const groups = new Map<string, typeof recipients>();
  let missingEmailSkipped = 0;
  const seen = new Set<string>();
  for (const user of recipients) {
    const organizationId = user.organizationId ?? (user.role === UserRole.PLATFORM_ADMIN ? ECHO_ORGANIZATION_ID : null);
    if (!organizationId || !entitled.has(organizationId)) continue;
    const email = user.email?.trim().toLowerCase();
    if (!email) { missingEmailSkipped++; continue; }
    const key = `${organizationId}:${email}`;
    if (seen.has(key)) continue;
    seen.add(key);
    groups.set(organizationId, [...(groups.get(organizationId) ?? []), { ...user, email }]);
  }
  for (const [organizationId, users] of groups) {
    try {
      // One data snapshot, one interpretation and one rendered email per tenant.
      const digest = await (options.digestLoader ?? getTenantWeeklyDigest)(organizationId, window);
      const rendered = renderTenantWeeklyDigestEmail(digest, options.appBaseUrl);
      for (const user of users) {
        try {
          results.push(await sendRenderedDigestWithLog({ organizationId, digestType: WeeklyDigestType.ADMIN_WEEKLY,
            recipientUserId: user.id, recipientEmail: user.email!, window: digest.window, rendered, emailSender: options.emailSender }));
        } catch {
          results.push({ recipientEmail: user.email!, digestType: WeeklyDigestType.ADMIN_WEEKLY, status: 'failed', errorMessage: 'Digest delivery could not be recorded. Retry the run.' });
        }
      }
    } catch {
      for (const user of users) results.push({ recipientEmail: user.email!, digestType: WeeklyDigestType.ADMIN_WEEKLY, status: 'failed', errorMessage: 'Tenant digest could not be prepared. Retry the run.' });
    }
  }
  return { attempted: results.length, sent: results.filter((item) => item.status === 'sent').length,
    skipped: results.filter((item) => item.status === 'skipped').length, failed: results.filter((item) => item.status === 'failed').length, missingEmailSkipped, results };
}
