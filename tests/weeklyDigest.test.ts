import assert from 'node:assert/strict';
import test from 'node:test';
import { UserRole, WeeklyDigestStatus, WorklistCategory, WorklistSource, WorklistStatus } from '@prisma/client';
import { GET as weeklyDigestCronGET } from '../app/api/cron/weekly-digest/route';
import {
  bucketWorklistItems,
  canPreviewWeeklyDigest,
  getWeeklyDigestWindow,
  isCompletedInPastWindow,
  isWeeklyDigestCronSendWindow,
  renderAdminWeeklyDigestEmail,
  renderUserWeeklyDigestEmail,
  shouldSkipExistingDigestLog,
  type AdminWeeklyDigest,
  type DigestWorklistItem,
  type UserWeeklyDigest,
} from '../lib/weeklyDigest';

const digestWindow = getWeeklyDigestWindow(new Date('2026-05-08T12:00:00.000Z'));

const makeWorkItem = (overrides: Partial<DigestWorklistItem>): DigestWorklistItem => ({
  id: overrides.id ?? 'work-1',
  title: overrides.title ?? 'Follow up',
  detail: overrides.detail ?? null,
  status: overrides.status ?? WorklistStatus.OPEN,
  source: overrides.source ?? WorklistSource.MANUAL,
  category: overrides.category ?? WorklistCategory.GENERAL,
  dueDate: overrides.dueDate ?? null,
  completedAt: overrides.completedAt ?? null,
  location: overrides.location ?? { name: 'General', href: null },
  assignedToName: overrides.assignedToName ?? 'Rep One',
  completedByName: overrides.completedByName ?? null,
  createdByName: overrides.createdByName ?? 'Admin',
});

const baseUser = {
  id: 'user-1',
  email: 'rep@example.com',
  firstName: 'Rep',
  lastName: 'One',
  name: 'Rep One',
  role: UserRole.USER,
  isActive: true,
};

const makeUserDigest = (): UserWeeklyDigest => {
  const overdue = makeWorkItem({
    id: 'overdue',
    dueDate: new Date(digestWindow.now.getTime() - 60_000),
  });
  const upcoming = makeWorkItem({
    id: 'upcoming',
    dueDate: new Date(digestWindow.now.getTime() + 2 * 24 * 60 * 60 * 1000),
  });

  return {
    kind: 'user',
    user: baseUser,
    userName: 'Rep One',
    window: digestWindow,
    visits: [],
    completedWork: [],
    upcomingWork: [upcoming],
    noDueDateWork: [],
    workBuckets: {
      overdue: [overdue],
      dueToday: [],
      dueThisWeekend: [upcoming],
      dueNextWeek: [],
      noDueDate: [],
    },
    metrics: {
      visitsLogged: 0,
      photosUploaded: 0,
      completedWork: 0,
      upcomingAssigned: 1,
      overdue: 1,
    },
    focusSentence: 'You have 1 overdue item and 1 upcoming follow-up.',
  };
};

test('weekly digest window uses a 7 day past and future range', () => {
  const now = new Date('2026-01-02T13:00:00.000Z');
  const window = getWeeklyDigestWindow(now);

  assert.equal(window.now, now);
  assert.equal(window.pastStart.toISOString(), '2025-12-26T13:00:00.000Z');
  assert.equal(window.pastEnd.toISOString(), '2026-01-02T13:00:00.000Z');
  assert.equal(window.upcomingStart.toISOString(), '2026-01-02T13:00:00.000Z');
  assert.equal(window.upcomingEnd.toISOString(), '2026-01-09T13:00:00.000Z');
});

test('cron send window matches Friday 8 AM America/New_York across DST', () => {
  assert.equal(isWeeklyDigestCronSendWindow(new Date('2026-01-02T13:00:00.000Z')), true);
  assert.equal(isWeeklyDigestCronSendWindow(new Date('2026-07-03T12:00:00.000Z')), true);
  assert.equal(isWeeklyDigestCronSendWindow(new Date('2026-07-03T13:00:00.000Z')), false);
});

test('worklist buckets exclude completed and cancelled items from open sections', () => {
  const buckets = bucketWorklistItems(
    [
      makeWorkItem({ id: 'open', dueDate: new Date(digestWindow.now.getTime() + 60_000) }),
      makeWorkItem({ id: 'done', status: WorklistStatus.COMPLETED, dueDate: new Date(digestWindow.now.getTime() + 60_000) }),
      makeWorkItem({ id: 'cancelled', status: WorklistStatus.CANCELLED, dueDate: new Date(digestWindow.now.getTime() - 60_000) }),
    ],
    digestWindow,
  );

  assert.equal(buckets.dueToday.length, 1);
  assert.equal(buckets.overdue.length, 0);
});

test('completed work is included only when completedAt falls in the past window', () => {
  assert.equal(
    isCompletedInPastWindow(
      makeWorkItem({ status: WorklistStatus.COMPLETED, completedAt: new Date(digestWindow.now.getTime() - 60_000) }),
      digestWindow,
    ),
    true,
  );
  assert.equal(
    isCompletedInPastWindow(
      makeWorkItem({
        status: WorklistStatus.COMPLETED,
        completedAt: new Date(digestWindow.pastStart.getTime() - 60_000),
      }),
      digestWindow,
    ),
    false,
  );
});

test('successful digest logs are skipped on duplicate triggers', () => {
  assert.equal(shouldSkipExistingDigestLog({ status: WeeklyDigestStatus.SENT }), true);
  assert.equal(shouldSkipExistingDigestLog({ status: WeeklyDigestStatus.FAILED }), false);
  assert.equal(shouldSkipExistingDigestLog(null), false);
});

test('preview authorization allows admins and blocks cross-user standard preview', () => {
  assert.equal(canPreviewWeeklyDigest({ id: 'admin', role: UserRole.ADMIN }, 'other'), true);
  assert.equal(canPreviewWeeklyDigest({ id: 'rep', role: UserRole.USER }, 'rep'), true);
  assert.equal(canPreviewWeeklyDigest({ id: 'rep', role: UserRole.USER }, 'other'), false);
});

test('user and admin digest renderers produce distinct email shapes', () => {
  const userDigest = makeUserDigest();
  const adminDigest: AdminWeeklyDigest = {
    kind: 'admin',
    window: digestWindow,
    users: [userDigest],
    unassigned: { overdue: [], upcoming: [], noDueDate: [] },
    totals: {
      activeUsers: 1,
      visitsLogged: 0,
      photosUploaded: 0,
      completedWork: 0,
      upcomingAssigned: 1,
      overdue: 1,
      unassignedUpcoming: 0,
      unassignedOverdue: 0,
    },
    noActivityUsers: [baseUser],
  };

  const userEmail = renderUserWeeklyDigestEmail(userDigest, 'https://crm.example.com');
  const adminEmail = renderAdminWeeklyDigestEmail(adminDigest, 'https://crm.example.com');

  assert.match(userEmail.subject, /^Your Echo CRM weekly summary:/);
  assert.match(adminEmail.subject, /^Echo CRM team weekly summary:/);
  assert.match(userEmail.html, /Visit activity/);
  assert.match(adminEmail.html, /Per-user scoreboard/);
});

test('weekly digest cron rejects unauthorized calls', async () => {
  const previousSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-secret';

  try {
    const response = await weeklyDigestCronGET(
      new Request('http://localhost/api/cron/weekly-digest', {
        headers: { authorization: 'Bearer wrong-secret' },
      }),
    );

    assert.equal(response.status, 401);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = previousSecret;
    }
  }
});
