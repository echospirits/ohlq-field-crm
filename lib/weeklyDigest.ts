import {
  PhotoType,
  UserRole,
  WeeklyDigestStatus,
  WeeklyDigestType,
  WorklistCategory,
  WorklistSource,
  WorklistStatus,
} from '@prisma/client';
import { getUserDisplayName } from './auth';
import { getEmailAppBaseUrl, sendEmail, type SendEmailFn } from './email/sendEmail';
import { prisma } from './prisma';
import { formatWholesaleLicenseeIds } from './wholesaleAccounts';

export const DEFAULT_DIGEST_TIME_ZONE = 'America/New_York';

const DAY_MS = 24 * 60 * 60 * 1000;
const inactiveWorklistStatuses: WorklistStatus[] = [WorklistStatus.COMPLETED, WorklistStatus.CANCELLED];
const maxEmailVisits = 10;
const maxEmailCompletedWork = 10;
const maxEmailUpcomingWork = 15;

type DigestUser = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  role: UserRole;
  isActive: boolean;
};

type DigestLocation = {
  name: string;
  href: string | null;
  meta?: string | null;
};

export type WeeklyDigestWindow = {
  now: Date;
  timeZone: string;
  pastStart: Date;
  pastEnd: Date;
  upcomingStart: Date;
  upcomingEnd: Date;
};

export type DigestVisit = {
  id: string;
  visitAt: Date;
  locationType: string;
  location: DigestLocation;
  contactName: string | null;
  summary: string | null;
  outcomes: string | null;
  nextStep: string | null;
  followUpDate: Date | null;
  createdByName: string;
  photoCount: number;
  photoCountsByType: Partial<Record<PhotoType, number>>;
};

export type DigestWorklistItem = {
  id: string;
  title: string;
  detail: string | null;
  status: WorklistStatus;
  source: WorklistSource;
  category: WorklistCategory;
  dueDate: Date | null;
  completedAt: Date | null;
  location: DigestLocation;
  assignedToName: string | null;
  completedByName: string | null;
  createdByName: string | null;
};

export type WorklistBuckets = {
  overdue: DigestWorklistItem[];
  dueToday: DigestWorklistItem[];
  dueThisWeekend: DigestWorklistItem[];
  dueNextWeek: DigestWorklistItem[];
  noDueDate: DigestWorklistItem[];
};

export type UserWeeklyDigest = {
  kind: 'user';
  user: DigestUser;
  userName: string;
  window: WeeklyDigestWindow;
  visits: DigestVisit[];
  completedWork: DigestWorklistItem[];
  upcomingWork: DigestWorklistItem[];
  noDueDateWork: DigestWorklistItem[];
  workBuckets: WorklistBuckets;
  metrics: {
    visitsLogged: number;
    photosUploaded: number;
    completedWork: number;
    upcomingAssigned: number;
    overdue: number;
  };
  focusSentence: string;
};

export type AdminWeeklyDigest = {
  kind: 'admin';
  window: WeeklyDigestWindow;
  users: UserWeeklyDigest[];
  unassigned: {
    overdue: DigestWorklistItem[];
    upcoming: DigestWorklistItem[];
    noDueDate: DigestWorklistItem[];
  };
  totals: {
    activeUsers: number;
    visitsLogged: number;
    photosUploaded: number;
    completedWork: number;
    upcomingAssigned: number;
    overdue: number;
    unassignedUpcoming: number;
    unassignedOverdue: number;
  };
  noActivityUsers: DigestUser[];
};

export type RenderedDigestEmail = {
  subject: string;
  html: string;
  text: string;
};

export type DigestSendResult = {
  recipientEmail: string;
  digestType: WeeklyDigestType;
  status: 'sent' | 'skipped' | 'failed';
  providerMessageId?: string;
  errorMessage?: string;
};

export type DigestRunResult = {
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
  missingEmailSkipped: number;
  results: DigestSendResult[];
};

type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
};

type VisitRecord = Awaited<ReturnType<typeof getVisitRecords>>[number];
type WorklistRecords = Awaited<ReturnType<typeof getWorklistRecords>>;
type WorklistRecord = WorklistRecords['completedWork'][number] | WorklistRecords['openWork'][number];

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

export const getWeeklyDigestWindow = (
  now = new Date(),
  timeZone = DEFAULT_DIGEST_TIME_ZONE,
): WeeklyDigestWindow => ({
  now,
  timeZone,
  pastStart: new Date(now.getTime() - 7 * DAY_MS),
  pastEnd: now,
  upcomingStart: now,
  upcomingEnd: new Date(now.getTime() + 7 * DAY_MS),
});

export const isWeeklyDigestCronSendWindow = (now = new Date(), timeZone = DEFAULT_DIGEST_TIME_ZONE) => {
  const local = getZonedDateParts(now, timeZone);

  return local.weekday === 'Fri' && (local.hour === 8 || local.hour === 9);
};

const formatDate = (date: Date | null | undefined, timeZone = DEFAULT_DIGEST_TIME_ZONE) =>
  date
    ? new Intl.DateTimeFormat('en-US', {
        timeZone,
        month: 'short',
        day: 'numeric',
      }).format(date)
    : '';

const formatDateTime = (date: Date | null | undefined, timeZone = DEFAULT_DIGEST_TIME_ZONE) =>
  date
    ? new Intl.DateTimeFormat('en-US', {
        timeZone,
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(date)
    : '';

const formatRangeLabel = (window: WeeklyDigestWindow) =>
  `${formatDate(window.pastStart, window.timeZone)} - ${formatDate(window.pastEnd, window.timeZone)}`;

const escapeHtml = (value: string | null | undefined) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const absoluteUrl = (path: string, appBaseUrl: string) => `${appBaseUrl.replace(/\/+$/, '')}${path}`;

const statusLabel: Record<WorklistStatus, string> = {
  [WorklistStatus.OPEN]: 'Open',
  [WorklistStatus.IN_PROGRESS]: 'In progress',
  [WorklistStatus.COMPLETED]: 'Completed',
  [WorklistStatus.CANCELLED]: 'Cancelled',
};

const sourceLabel: Record<WorklistSource, string> = {
  [WorklistSource.MANUAL]: 'Manual',
  [WorklistSource.OHLQ_WHOLESALE_REACTIVATION]: 'OHLQ wholesale reactivation',
  [WorklistSource.VISIT_FOLLOW_UP]: 'Visit follow-up',
};

const categoryLabel: Record<WorklistCategory, string> = {
  [WorklistCategory.AGENCY]: 'Agency',
  [WorklistCategory.WHOLESALE]: 'Wholesale',
  [WorklistCategory.GENERAL]: 'General',
};

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

export const buildUserFocusSentence = (digest: Pick<UserWeeklyDigest, 'metrics'>) => {
  if (digest.metrics.overdue > 0) {
    return `You have ${digest.metrics.overdue} overdue item${digest.metrics.overdue === 1 ? '' : 's'} and ${digest.metrics.upcomingAssigned} upcoming follow-up${digest.metrics.upcomingAssigned === 1 ? '' : 's'}.`;
  }

  if (digest.metrics.visitsLogged === 0 && digest.metrics.upcomingAssigned > 0) {
    return `No visits logged this week; start with the ${digest.metrics.upcomingAssigned} due item${digest.metrics.upcomingAssigned === 1 ? '' : 's'} below.`;
  }

  if (digest.metrics.visitsLogged === 0 && digest.metrics.completedWork === 0) {
    return 'No visit or completed worklist activity this week.';
  }

  return `You logged ${digest.metrics.visitsLogged} visit${digest.metrics.visitsLogged === 1 ? '' : 's'} and completed ${digest.metrics.completedWork} worklist item${digest.metrics.completedWork === 1 ? '' : 's'} this week.`;
};

export const canPreviewWeeklyDigest = (
  currentUser: Pick<DigestUser, 'id' | 'role'>,
  requestedUserId: string,
) => currentUser.role === UserRole.ADMIN || currentUser.id === requestedUserId;

export const shouldSkipExistingDigestLog = (
  log: { status: WeeklyDigestStatus } | null | undefined,
) => log?.status === WeeklyDigestStatus.SENT;

const getAssignedWorklistFilter = (user: DigestUser) => ({
  OR: [{ assignedToUserId: user.id }, { assignedTo: getUserDisplayName(user) }],
});

async function getVisitRecords(user: DigestUser, window: WeeklyDigestWindow) {
  const actorName = getUserDisplayName(user);

  return prisma.loggedVisit.findMany({
    where: {
      visitAt: {
        gte: window.pastStart,
        lt: window.pastEnd,
      },
      OR: [{ createdByUserId: user.id }, { createdBy: actorName }],
    },
    include: {
      createdByUser: true,
      photos: {
        select: {
          type: true,
        },
      },
    },
    orderBy: [{ visitAt: 'desc' }],
    take: 500,
  });
}

async function getWorklistRecords(user: DigestUser, window: WeeklyDigestWindow) {
  const assignedWhere = getAssignedWorklistFilter(user);

  const [completedWork, openWork] = await Promise.all([
    prisma.worklistItem.findMany({
      where: {
        status: WorklistStatus.COMPLETED,
        completedAt: {
          gte: window.pastStart,
          lt: window.pastEnd,
        },
        OR: [
          { completedByUserId: user.id },
          { assignedToUserId: user.id },
          { assignedTo: getUserDisplayName(user) },
        ],
      },
      include: {
        assignedToUser: true,
        completedByUser: true,
        createdByUser: true,
      },
      orderBy: [{ completedAt: 'desc' }, { updatedAt: 'desc' }],
      take: 500,
    }),
    prisma.worklistItem.findMany({
      where: {
        AND: [
          assignedWhere,
          { status: { notIn: inactiveWorklistStatuses } },
          {
            OR: [
              { dueDate: null },
              { dueDate: { lt: window.upcomingEnd } },
            ],
          },
        ],
      },
      include: {
        assignedToUser: true,
        completedByUser: true,
        createdByUser: true,
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
      take: 500,
    }),
  ]);

  return { completedWork, openWork };
}

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

export async function getActiveDigestRecipients() {
  return prisma.user.findMany({
    where: { isActive: true },
    orderBy: [{ role: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }, { email: 'asc' }],
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      name: true,
      role: true,
      isActive: true,
    },
  });
}

export async function getUserWeeklyDigest(userId: string, window: WeeklyDigestWindow) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      name: true,
      role: true,
      isActive: true,
    },
  });

  if (!user) {
    throw new Error('User not found');
  }

  const [visits, worklists] = await Promise.all([
    getVisitRecords(user, window),
    getWorklistRecords(user, window),
  ]);
  const allWorkItems = [...worklists.completedWork, ...worklists.openWork];
  const lookups = await getLocationLookups(visits, allWorkItems);
  const digestVisits = visits.map((visit) => visitToDigestVisit(visit, lookups));
  const completedWork = worklists.completedWork.map((item) => workItemToDigestItem(item, lookups));
  const openWork = worklists.openWork.map((item) => workItemToDigestItem(item, lookups));
  const workBuckets = bucketWorklistItems(openWork, window);
  const upcomingWork = [...workBuckets.dueToday, ...workBuckets.dueThisWeekend, ...workBuckets.dueNextWeek];
  const noDueDateWork = workBuckets.noDueDate;
  const metrics = {
    visitsLogged: digestVisits.length,
    photosUploaded: digestVisits.reduce((sum, visit) => sum + visit.photoCount, 0),
    completedWork: completedWork.length,
    upcomingAssigned: upcomingWork.length,
    overdue: workBuckets.overdue.length,
  };
  const digest: UserWeeklyDigest = {
    kind: 'user',
    user,
    userName: getUserDisplayName(user),
    window,
    visits: digestVisits,
    completedWork,
    upcomingWork,
    noDueDateWork,
    workBuckets,
    metrics,
    focusSentence: '',
  };

  digest.focusSentence = buildUserFocusSentence(digest);

  return digest;
}

const getUnassignedDigestItems = async (window: WeeklyDigestWindow) => {
  const items = await prisma.worklistItem.findMany({
    where: {
      status: { notIn: inactiveWorklistStatuses },
      assignedToUserId: null,
      OR: [{ assignedTo: null }, { assignedTo: '' }],
      AND: [
        {
          OR: [{ dueDate: null }, { dueDate: { lt: window.upcomingEnd } }],
        },
      ],
    },
    include: {
      assignedToUser: true,
      completedByUser: true,
      createdByUser: true,
    },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    take: 500,
  });
  const lookups = await getLocationLookups([], items);
  const digestItems = items.map((item) => workItemToDigestItem(item, lookups));
  const buckets = bucketWorklistItems(digestItems, window);

  return {
    overdue: buckets.overdue,
    upcoming: [...buckets.dueToday, ...buckets.dueThisWeekend, ...buckets.dueNextWeek],
    noDueDate: buckets.noDueDate,
  };
};

export async function getAdminWeeklyDigest(window: WeeklyDigestWindow) {
  const users = await getActiveDigestRecipients();
  const [userDigests, unassigned] = await Promise.all([
    Promise.all(users.map((user) => getUserWeeklyDigest(user.id, window))),
    getUnassignedDigestItems(window),
  ]);
  const totals = {
    activeUsers: users.length,
    visitsLogged: userDigests.reduce((sum, digest) => sum + digest.metrics.visitsLogged, 0),
    photosUploaded: userDigests.reduce((sum, digest) => sum + digest.metrics.photosUploaded, 0),
    completedWork: userDigests.reduce((sum, digest) => sum + digest.metrics.completedWork, 0),
    upcomingAssigned: userDigests.reduce((sum, digest) => sum + digest.metrics.upcomingAssigned, 0),
    overdue: userDigests.reduce((sum, digest) => sum + digest.metrics.overdue, 0),
    unassignedUpcoming: unassigned.upcoming.length,
    unassignedOverdue: unassigned.overdue.length,
  };

  return {
    kind: 'admin',
    window,
    users: userDigests,
    unassigned,
    totals,
    noActivityUsers: userDigests
      .filter((digest) => digest.metrics.visitsLogged === 0 && digest.metrics.completedWork === 0)
      .map((digest) => digest.user),
  } satisfies AdminWeeklyDigest;
}

const metricCard = (label: string, value: number) => `
  <td style="padding:12px;border:1px solid #d7dde8;border-radius:6px;background:#f8fafc;">
    <div style="font-size:22px;font-weight:700;color:#14213d;">${value}</div>
    <div style="font-size:12px;color:#5f6b7a;">${escapeHtml(label)}</div>
  </td>
`;

const emptyText = (message: string) => `<p style="margin:8px 0 0;color:#5f6b7a;">${escapeHtml(message)}</p>`;

const renderLink = (label: string, href: string | null, appBaseUrl: string) =>
  href
    ? `<a href="${escapeHtml(absoluteUrl(href, appBaseUrl))}" style="color:#0f766e;text-decoration:underline;">${escapeHtml(label)}</a>`
    : escapeHtml(label);

const renderWorkItemList = (
  items: DigestWorklistItem[],
  window: WeeklyDigestWindow,
  appBaseUrl: string,
  options?: { max?: number; emphasizeOverdue?: boolean },
) => {
  const capped = items.slice(0, options?.max ?? maxEmailUpcomingWork);

  if (capped.length === 0) {
    return '';
  }

  return `
    <ul style="margin:8px 0 0;padding-left:20px;">
      ${capped
        .map((item) => {
          const isOverdue = Boolean(item.dueDate && item.dueDate.getTime() < window.upcomingStart.getTime());
          const dueLabel = item.dueDate ? formatDate(item.dueDate, window.timeZone) : 'No due date';
          const title = `${item.title} - ${item.location.name}`;

          return `
            <li style="margin:0 0 10px;color:${options?.emphasizeOverdue && isOverdue ? '#b91c1c' : '#1f2937'};">
              <strong>${renderLink(title, item.location.href, appBaseUrl)}</strong>
              <div style="font-size:12px;color:#5f6b7a;">${escapeHtml(categoryLabel[item.category])} | ${escapeHtml(sourceLabel[item.source])} | Due ${escapeHtml(dueLabel)}${item.assignedToName ? ` | Owner ${escapeHtml(item.assignedToName)}` : ''}</div>
              ${item.detail ? `<div style="font-size:13px;color:#374151;margin-top:3px;">${escapeHtml(item.detail)}</div>` : ''}
            </li>
          `;
        })
        .join('')}
    </ul>
    ${items.length > capped.length ? `<p style="font-size:12px;color:#5f6b7a;">${items.length - capped.length} more item${items.length - capped.length === 1 ? '' : 's'} in CRM.</p>` : ''}
  `;
};

const renderVisitList = (visits: DigestVisit[], window: WeeklyDigestWindow, appBaseUrl: string) => {
  const capped = visits.slice(0, maxEmailVisits);

  if (capped.length === 0) {
    return emptyText('No visits logged in this period.');
  }

  const grouped = capped.reduce<Record<string, DigestVisit[]>>((groups, visit) => {
    const key = formatDate(visit.visitAt, window.timeZone);
    groups[key] = groups[key] ?? [];
    groups[key].push(visit);
    return groups;
  }, {});

  return `
    ${Object.entries(grouped)
      .map(
        ([day, dayVisits]) => `
          <h4 style="margin:12px 0 6px;color:#14213d;">${escapeHtml(day)}</h4>
          <ul style="margin:0;padding-left:20px;">
            ${dayVisits
              .map((visit) => {
                const photoTypes = Object.entries(visit.photoCountsByType)
                  .map(([type, count]) => `${type.toLowerCase()}: ${count}`)
                  .join(', ');

                return `
                  <li style="margin:0 0 12px;">
                    <strong>${renderLink(visit.location.name, visit.location.href, appBaseUrl)}</strong>
                    <div style="font-size:12px;color:#5f6b7a;">${escapeHtml(formatDateTime(visit.visitAt, window.timeZone))}${visit.contactName ? ` | ${escapeHtml(visit.contactName)}` : ''} | Photos ${visit.photoCount}${photoTypes ? ` (${escapeHtml(photoTypes)})` : ''}</div>
                    ${visit.summary ? `<div style="font-size:13px;color:#374151;margin-top:3px;">${escapeHtml(visit.summary)}</div>` : ''}
                    ${visit.outcomes ? `<div style="font-size:13px;color:#374151;margin-top:3px;"><strong>Outcomes:</strong> ${escapeHtml(visit.outcomes)}</div>` : ''}
                    ${visit.nextStep ? `<div style="font-size:13px;color:#374151;margin-top:3px;"><strong>Next:</strong> ${escapeHtml(visit.nextStep)}</div>` : ''}
                  </li>
                `;
              })
              .join('')}
          </ul>
        `,
      )
      .join('')}
    ${visits.length > capped.length ? `<p style="font-size:12px;color:#5f6b7a;">${visits.length - capped.length} more visit${visits.length - capped.length === 1 ? '' : 's'} in CRM.</p>` : ''}
  `;
};

const renderCompletedWork = (items: DigestWorklistItem[], window: WeeklyDigestWindow, appBaseUrl: string) => {
  const capped = items.slice(0, maxEmailCompletedWork);

  if (capped.length === 0) {
    return emptyText('No completed worklist items in this period.');
  }

  return `
    <ul style="margin:8px 0 0;padding-left:20px;">
      ${capped
        .map(
          (item) => `
            <li style="margin:0 0 10px;">
              <strong>${renderLink(`${item.title} - ${item.location.name}`, item.location.href, appBaseUrl)}</strong>
              <div style="font-size:12px;color:#5f6b7a;">Completed ${escapeHtml(formatDate(item.completedAt, window.timeZone))}${item.completedByName ? ` by ${escapeHtml(item.completedByName)}` : ''} | ${escapeHtml(statusLabel[item.status])}</div>
            </li>
          `,
        )
        .join('')}
    </ul>
    ${items.length > capped.length ? `<p style="font-size:12px;color:#5f6b7a;">${items.length - capped.length} more completed item${items.length - capped.length === 1 ? '' : 's'} in CRM.</p>` : ''}
  `;
};

const renderSection = (title: string, body: string) => `
  <section style="margin-top:24px;">
    <h3 style="font-size:18px;margin:0 0 8px;color:#14213d;">${escapeHtml(title)}</h3>
    ${body}
  </section>
`;

const baseEmail = (preheader: string, body: string) => `
<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>${escapeHtml(preheader)}</title>
  </head>
  <body style="margin:0;background:#edf1f7;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(preheader)}</div>
    <main style="max-width:760px;margin:0 auto;padding:24px 12px;">
      <div style="background:#ffffff;border:1px solid #d7dde8;border-radius:8px;padding:24px;">
        ${body}
      </div>
    </main>
  </body>
</html>`;

export function renderUserWeeklyDigestEmail(digest: UserWeeklyDigest, appBaseUrl = getEmailAppBaseUrl({ allowLocalFallback: true })) {
  const rangeLabel = formatRangeLabel(digest.window);
  const subject = `Your Echo CRM weekly summary: ${rangeLabel}`;
  const html = baseEmail(
    digest.focusSentence,
    `
      <h1 style="font-size:24px;margin:0;color:#14213d;">Your Echo CRM weekly summary</h1>
      <p style="margin:6px 0 0;color:#5f6b7a;">${escapeHtml(rangeLabel)}</p>
      <p style="font-size:16px;margin:18px 0;color:#1f2937;">${escapeHtml(digest.focusSentence)}</p>
      <table role="presentation" cellspacing="8" cellpadding="0" style="width:100%;border-collapse:separate;border-spacing:8px;margin:0 -8px 8px;">
        <tr>
          ${metricCard('visits logged', digest.metrics.visitsLogged)}
          ${metricCard('photos uploaded', digest.metrics.photosUploaded)}
          ${metricCard('completed work', digest.metrics.completedWork)}
        </tr>
        <tr>
          ${metricCard('upcoming assigned', digest.metrics.upcomingAssigned)}
          ${metricCard('overdue', digest.metrics.overdue)}
          ${metricCard('no due date', digest.noDueDateWork.length)}
        </tr>
      </table>
      ${renderSection('Visit activity', renderVisitList(digest.visits, digest.window, appBaseUrl))}
      ${renderSection('Completed work', renderCompletedWork(digest.completedWork, digest.window, appBaseUrl))}
      ${renderSection('Overdue', digest.workBuckets.overdue.length ? renderWorkItemList(digest.workBuckets.overdue, digest.window, appBaseUrl, { emphasizeOverdue: true }) : emptyText('No overdue assigned work.'))}
      ${renderSection('Due today', digest.workBuckets.dueToday.length ? renderWorkItemList(digest.workBuckets.dueToday, digest.window, appBaseUrl) : emptyText('Nothing due today.'))}
      ${digest.workBuckets.dueThisWeekend.length ? renderSection('Due this weekend', renderWorkItemList(digest.workBuckets.dueThisWeekend, digest.window, appBaseUrl)) : ''}
      ${renderSection('Due next week', digest.workBuckets.dueNextWeek.length ? renderWorkItemList(digest.workBuckets.dueNextWeek, digest.window, appBaseUrl) : emptyText('No additional due items in the next 7 days.'))}
      ${renderSection('No due date', digest.noDueDateWork.length ? renderWorkItemList(digest.noDueDateWork, digest.window, appBaseUrl, { max: 8 }) : emptyText('No assigned no-date work.'))}
      <p style="margin-top:24px;"><a href="${escapeHtml(absoluteUrl('/my-week', appBaseUrl))}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:10px 14px;border-radius:6px;">View My Week in CRM</a></p>
    `,
  );
  const text = [
    subject,
    '',
    digest.focusSentence,
    '',
    `Visits logged: ${digest.metrics.visitsLogged}`,
    `Photos uploaded: ${digest.metrics.photosUploaded}`,
    `Completed worklist items: ${digest.metrics.completedWork}`,
    `Upcoming assigned items: ${digest.metrics.upcomingAssigned}`,
    `Overdue items: ${digest.metrics.overdue}`,
    '',
    `Open My Week: ${absoluteUrl('/my-week', appBaseUrl)}`,
  ].join('\n');

  return { subject, html, text } satisfies RenderedDigestEmail;
}

const renderUserScoreboard = (digest: AdminWeeklyDigest) => `
  <table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin-top:8px;">
    <thead>
      <tr>
        <th align="left" style="border-bottom:1px solid #d7dde8;padding:8px;">User</th>
        <th align="right" style="border-bottom:1px solid #d7dde8;padding:8px;">Visits</th>
        <th align="right" style="border-bottom:1px solid #d7dde8;padding:8px;">Completed</th>
        <th align="right" style="border-bottom:1px solid #d7dde8;padding:8px;">Upcoming</th>
        <th align="right" style="border-bottom:1px solid #d7dde8;padding:8px;">Overdue</th>
      </tr>
    </thead>
    <tbody>
      ${digest.users
        .map(
          (userDigest) => `
            <tr>
              <td style="border-bottom:1px solid #edf1f7;padding:8px;">${escapeHtml(userDigest.userName)}</td>
              <td align="right" style="border-bottom:1px solid #edf1f7;padding:8px;">${userDigest.metrics.visitsLogged}</td>
              <td align="right" style="border-bottom:1px solid #edf1f7;padding:8px;">${userDigest.metrics.completedWork}</td>
              <td align="right" style="border-bottom:1px solid #edf1f7;padding:8px;">${userDigest.metrics.upcomingAssigned}</td>
              <td align="right" style="border-bottom:1px solid #edf1f7;padding:8px;color:${userDigest.metrics.overdue > 0 ? '#b91c1c' : '#1f2937'};">${userDigest.metrics.overdue}</td>
            </tr>
          `,
        )
        .join('')}
    </tbody>
  </table>
`;

const renderAdminUserDetails = (digest: AdminWeeklyDigest, appBaseUrl: string) =>
  digest.users
    .map(
      (userDigest) => `
        <div style="border-top:1px solid #edf1f7;padding-top:12px;margin-top:12px;">
          <h4 style="margin:0 0 4px;color:#14213d;">${escapeHtml(userDigest.userName)}</h4>
          <p style="margin:0 0 8px;color:#5f6b7a;font-size:12px;">${userDigest.metrics.visitsLogged} visits | ${userDigest.metrics.completedWork} completed | ${userDigest.metrics.upcomingAssigned} upcoming | ${userDigest.metrics.overdue} overdue</p>
          ${userDigest.visits.length > 0 ? `<strong style="font-size:13px;">Recent visits</strong>${renderVisitList(userDigest.visits.slice(0, 3), userDigest.window, appBaseUrl)}` : emptyText('No visits logged.')}
          ${userDigest.workBuckets.overdue.length > 0 ? `<strong style="font-size:13px;color:#b91c1c;">Overdue work</strong>${renderWorkItemList(userDigest.workBuckets.overdue.slice(0, 5), userDigest.window, appBaseUrl, { emphasizeOverdue: true })}` : ''}
        </div>
      `,
    )
    .join('');

export function renderAdminWeeklyDigestEmail(digest: AdminWeeklyDigest, appBaseUrl = getEmailAppBaseUrl({ allowLocalFallback: true })) {
  const rangeLabel = formatRangeLabel(digest.window);
  const subject = `Echo CRM team weekly summary: ${rangeLabel}`;
  const allOverdue = digest.users.flatMap((userDigest) => userDigest.workBuckets.overdue);
  const allUpcoming = digest.users.flatMap((userDigest) => userDigest.upcomingWork);
  const html = baseEmail(
    `Team summary: ${digest.totals.visitsLogged} visits, ${digest.totals.overdue} overdue items.`,
    `
      <h1 style="font-size:24px;margin:0;color:#14213d;">Echo CRM team weekly summary</h1>
      <p style="margin:6px 0 0;color:#5f6b7a;">${escapeHtml(rangeLabel)}</p>
      <table role="presentation" cellspacing="8" cellpadding="0" style="width:100%;border-collapse:separate;border-spacing:8px;margin:16px -8px 8px;">
        <tr>
          ${metricCard('active users', digest.totals.activeUsers)}
          ${metricCard('visits logged', digest.totals.visitsLogged)}
          ${metricCard('photos uploaded', digest.totals.photosUploaded)}
        </tr>
        <tr>
          ${metricCard('completed work', digest.totals.completedWork)}
          ${metricCard('upcoming assigned', digest.totals.upcomingAssigned)}
          ${metricCard('overdue', digest.totals.overdue)}
        </tr>
      </table>
      ${renderSection('Per-user scoreboard', renderUserScoreboard(digest))}
      ${renderSection('Overdue work', allOverdue.length ? renderWorkItemList(allOverdue, digest.window, appBaseUrl, { max: 20, emphasizeOverdue: true }) : emptyText('No overdue assigned work.'))}
      ${renderSection('Upcoming work', allUpcoming.length ? renderWorkItemList(allUpcoming, digest.window, appBaseUrl, { max: 20 }) : emptyText('No assigned work due in the next 7 days.'))}
      ${renderSection('Unassigned work', digest.unassigned.overdue.length || digest.unassigned.upcoming.length || digest.unassigned.noDueDate.length ? `${renderWorkItemList([...digest.unassigned.overdue, ...digest.unassigned.upcoming, ...digest.unassigned.noDueDate], digest.window, appBaseUrl, { max: 20, emphasizeOverdue: true })}` : emptyText('No unassigned due or no-date work.'))}
      ${renderSection('No-activity users', digest.noActivityUsers.length ? `<p style="margin:8px 0;color:#5f6b7a;">${escapeHtml(digest.noActivityUsers.map((user) => getUserDisplayName(user)).join(', '))}</p>` : emptyText('Every active user logged visits or completed work this week.'))}
      ${renderSection('Per-user details', renderAdminUserDetails(digest, appBaseUrl))}
      <p style="margin-top:24px;"><a href="${escapeHtml(absoluteUrl('/alerts', appBaseUrl))}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:10px 14px;border-radius:6px;">View Worklist in CRM</a></p>
    `,
  );
  const text = [
    subject,
    '',
    `Active users: ${digest.totals.activeUsers}`,
    `Visits logged: ${digest.totals.visitsLogged}`,
    `Completed work: ${digest.totals.completedWork}`,
    `Upcoming assigned: ${digest.totals.upcomingAssigned}`,
    `Overdue: ${digest.totals.overdue}`,
    `Unassigned upcoming: ${digest.totals.unassignedUpcoming}`,
    `Unassigned overdue: ${digest.totals.unassignedOverdue}`,
    '',
    `Open Worklist: ${absoluteUrl('/alerts', appBaseUrl)}`,
  ].join('\n');

  return { subject, html, text } satisfies RenderedDigestEmail;
}

const uniqueDigestWhere = (
  digestType: WeeklyDigestType,
  recipientEmail: string,
  window: WeeklyDigestWindow,
) => ({
  digestType_recipientEmail_periodStart_periodEnd: {
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
}: {
  digestType: WeeklyDigestType;
  recipientUserId: string | null;
  recipientEmail: string;
  window: WeeklyDigestWindow;
  rendered: RenderedDigestEmail;
  emailSender?: SendEmailFn;
}): Promise<DigestSendResult> {
  const existing = await prisma.weeklyDigestLog.findUnique({
    where: uniqueDigestWhere(digestType, recipientEmail, window),
  });

  if (shouldSkipExistingDigestLog(existing)) {
    await prisma.weeklyDigestLog.update({
      where: { id: existing!.id },
      data: {
        lastSkippedAt: new Date(),
        lastSkipReason: 'Duplicate digest trigger skipped because this period was already sent.',
      },
    });

    return {
      recipientEmail,
      digestType,
      status: 'skipped',
      providerMessageId: existing!.providerMessageId ?? undefined,
    };
  }

  const log = existing
    ? await prisma.weeklyDigestLog.update({
        where: { id: existing.id },
        data: {
          status: WeeklyDigestStatus.PENDING,
          recipientUserId,
          scheduledFor: window.now,
          runAt: window.now,
          errorMessage: null,
          lastSkipReason: null,
          attemptCount: { increment: 1 },
        },
      })
    : await prisma.weeklyDigestLog.create({
        data: {
          digestType,
          recipientUserId,
          recipientEmail,
          periodStart: window.pastStart,
          periodEnd: window.pastEnd,
          scheduledFor: window.now,
          runAt: window.now,
          status: WeeklyDigestStatus.PENDING,
          attemptCount: 1,
        },
      });

  try {
    const sent = await emailSender({
      to: recipientEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: `${digestType}:${recipientEmail}:${window.pastStart.toISOString()}:${window.pastEnd.toISOString()}`,
    });

    await prisma.weeklyDigestLog.update({
      where: { id: log.id },
      data: {
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

export async function sendWeeklyDigestForUser(
  userId: string,
  options?: {
    window?: WeeklyDigestWindow;
    recipientEmail?: string;
    emailSender?: SendEmailFn;
    appBaseUrl?: string;
  },
) {
  const window = options?.window ?? getWeeklyDigestWindow();
  const digest = await getUserWeeklyDigest(userId, window);
  const recipientEmail = options?.recipientEmail ?? digest.user.email;

  if (!recipientEmail) {
    return {
      recipientEmail: '',
      digestType: WeeklyDigestType.USER_WEEKLY,
      status: 'skipped',
      errorMessage: 'Missing recipient email',
    } satisfies DigestSendResult;
  }

  return sendRenderedDigestWithLog({
    digestType: WeeklyDigestType.USER_WEEKLY,
    recipientUserId: digest.user.id,
    recipientEmail,
    window,
    rendered: renderUserWeeklyDigestEmail(digest, options?.appBaseUrl),
    emailSender: options?.emailSender,
  });
}

export async function sendAdminWeeklyDigestToUser(
  adminUserId: string,
  options?: {
    window?: WeeklyDigestWindow;
    recipientEmail?: string;
    emailSender?: SendEmailFn;
    appBaseUrl?: string;
  },
) {
  const window = options?.window ?? getWeeklyDigestWindow();
  const [adminUser, digest] = await Promise.all([
    prisma.user.findUnique({ where: { id: adminUserId }, select: { id: true, email: true, role: true } }),
    getAdminWeeklyDigest(window),
  ]);

  if (!adminUser || adminUser.role !== UserRole.ADMIN) {
    throw new Error('Admin recipient not found');
  }

  const recipientEmail = options?.recipientEmail ?? adminUser.email;

  if (!recipientEmail) {
    return {
      recipientEmail: '',
      digestType: WeeklyDigestType.ADMIN_WEEKLY,
      status: 'skipped',
      errorMessage: 'Missing recipient email',
    } satisfies DigestSendResult;
  }

  return sendRenderedDigestWithLog({
    digestType: WeeklyDigestType.ADMIN_WEEKLY,
    recipientUserId: adminUser.id,
    recipientEmail,
    window,
    rendered: renderAdminWeeklyDigestEmail(digest, options?.appBaseUrl),
    emailSender: options?.emailSender,
  });
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

export async function sendWeeklyDigestForAllUsers(
  options?: {
    window?: WeeklyDigestWindow;
    emailSender?: SendEmailFn;
    appBaseUrl?: string;
  },
): Promise<DigestRunResult> {
  const window = options?.window ?? getWeeklyDigestWindow();
  const recipients = await getActiveDigestRecipients();
  const usersWithEmail = recipients.filter((user) => user.email);
  const results: DigestSendResult[] = [];

  for (const recipient of usersWithEmail) {
    if (recipient.role === UserRole.ADMIN) {
      results.push(
        await sendAdminWeeklyDigestToUser(recipient.id, {
          window,
          emailSender: options?.emailSender,
          appBaseUrl: options?.appBaseUrl,
        }),
      );
    } else {
      results.push(
        await sendWeeklyDigestForUser(recipient.id, {
          window,
          emailSender: options?.emailSender,
          appBaseUrl: options?.appBaseUrl,
        }),
      );
    }
  }

  return {
    attempted: results.length,
    sent: results.filter((result) => result.status === 'sent').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    failed: results.filter((result) => result.status === 'failed').length,
    missingEmailSkipped: recipients.length - usersWithEmail.length,
    results,
  };
}
