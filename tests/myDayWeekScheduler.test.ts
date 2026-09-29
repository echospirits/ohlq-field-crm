import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { isValidZonedDateTime, parseTimeInputToMinutes } from '../lib/dateTime';
import {
  getSchedulerDayItems,
  getSchedulerPlanningTray,
  getSchedulerTimedPlacements,
  getSchedulerWeekDates,
} from '../lib/myDayWeekScheduler';

const item = (id: string, dueDate: string | null, dueTimeMinutes: number | null, status = 'OPEN') => ({ id, dueDate, dueTimeMinutes, status });

test('date-only work is Anytime while exact-time work is ordered into its time slot', () => {
  const items = [
    item('late', '2026-09-23', 14 * 60 + 30),
    item('anytime', '2026-09-23', null),
    item('early', '2026-09-23', 9 * 60),
    item('finished', '2026-09-23', 10 * 60, 'COMPLETED'),
  ];
  const day = getSchedulerDayItems(items, '2026-09-23');
  assert.deepEqual(day.timed.map(({ id }) => id), ['early', 'late']);
  assert.deepEqual(day.anytime.map(({ id }) => id), ['anytime']);
});

test('My Week uses Monday through Sunday and the same Worklist records as My Day', () => {
  const days = getSchedulerWeekDates('2026-09-23');
  assert.deepEqual(days, ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']);
  const task = item('shared-task', '2026-09-23', 10 * 60);
  assert.deepEqual(getSchedulerDayItems([task], '2026-09-23').timed, getSchedulerDayItems([task], days[2]).timed);
});

test('planning tray includes overdue and undated active work, not completed work or the current week', () => {
  const tray = getSchedulerPlanningTray([
    item('old', '2026-09-01', null),
    item('undated', null, null),
    item('this-week', '2026-09-23', null),
    item('done', '2026-09-01', null, 'COMPLETED'),
  ], '2026-09-21');
  assert.deepEqual(tray.map(({ id }) => id), ['old', 'undated']);
});

test('overlapping starts remain allowed and receive separate visual lanes', () => {
  const placements = getSchedulerTimedPlacements([
    item('first', '2026-09-23', 9 * 60),
    item('second', '2026-09-23', 9 * 60 + 15),
    item('adjacent', '2026-09-23', 9 * 60 + 45),
  ], '2026-09-23');
  assert.deepEqual(placements.map(({ item: task, lane, laneCount, overlapCount }) => ({ id: task.id, lane, laneCount, overlapCount })), [
    { id: 'first', lane: 0, laneCount: 2, overlapCount: 2 },
    { id: 'second', lane: 1, laneCount: 2, overlapCount: 2 },
    { id: 'adjacent', lane: 0, laneCount: 1, overlapCount: 1 },
  ]);
});

test('chained overlaps use lanes without claiming non-overlapping neighbors collide', () => {
  const placements = getSchedulerTimedPlacements([
    item('first', '2026-09-23', 9 * 60),
    item('middle', '2026-09-23', 9 * 60 + 20),
    item('last', '2026-09-23', 9 * 60 + 40),
  ], '2026-09-23');
  assert.deepEqual(placements.map(({ item: task, lane, laneCount, overlapCount }) => ({ id: task.id, lane, laneCount, overlapCount })), [
    { id: 'first', lane: 0, laneCount: 2, overlapCount: 2 },
    { id: 'middle', lane: 1, laneCount: 2, overlapCount: 3 },
    { id: 'last', lane: 0, laneCount: 2, overlapCount: 2 },
  ]);
});

const schedulerUpdatedAt = '2026-09-23T12:00:00.000Z';

function loadSchedulerActions({ owned = true, writeCount = 1, accountAvailable = true, opportunityTask = false, existingSubmissionKeys = [] as string[] } = {}) {
  const calls: Array<{ name: string; args?: any }> = [];
  const submissionKeys = new Set(existingSubmissionKeys);
  const assignees = new Map([
    ['rep', { id: 'rep', email: 'rep@example.test', firstName: 'Rep', lastName: 'User', name: null }],
    ['teammate', { id: 'teammate', email: 'mate@example.test', firstName: 'Team', lastName: 'Mate', name: null }],
  ]);
  const enumValues = {
    OpportunityEventType: { TASK_REASSIGNED: 'TASK_REASSIGNED' },
    WorklistCategory: { AGENCY: 'AGENCY', WHOLESALE: 'WHOLESALE', GENERAL: 'GENERAL' },
    WorklistSource: { MANUAL: 'MANUAL' },
    WorklistStatus: { OPEN: 'OPEN', IN_PROGRESS: 'IN_PROGRESS', COMPLETED: 'COMPLETED' },
  };
  const module = { exports: {} as Record<string, unknown> };
  const context = {
    exports: module.exports,
    module,
    require: (name: string) => {
      if (name === '@prisma/client') return enumValues;
      if (name === 'next/cache') return { revalidatePath: (path: string) => calls.push({ name: 'revalidate', args: path }) };
      if (name.includes('/lib/auth')) return {
        getUserDisplayName: (user: any) => `${user.firstName} ${user.lastName}`,
        requireUser: async () => assignees.get('rep'),
      };
      if (name.includes('/lib/dateTime')) return {
        parseTimeInputToMinutes,
        isValidZonedDateTime,
      };
      if (name.includes('/lib/calendar/scheduleWorklistSync')) return { scheduleWorklistSync: (id: string) => calls.push({ name: 'calendar', args: id }) };
      if (name.includes('/lib/organizations')) return { requireOrganizationContext: async () => ({ organizationId: 'tenant' }) };
      if (name.includes('/lib/prisma')) return { prisma };
      if (name.includes('/lib/worklistLocations')) return { getWorklistCategoryForLocationSelection: (category: string) => category };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    FormData,
    Date,
  };
  const prisma: any = {
    worklistItem: {
      findFirst: async ({ where }: any) => {
        calls.push({ name: 'find', args: where });
        assert.equal(where.organizationId, 'tenant');
        if (!owned || (where.updatedAt && where.updatedAt.toISOString() !== schedulerUpdatedAt)) return null;
        return {
          id: where.id,
          assignedToUserId: 'rep',
          salesOpportunityId: opportunityTask ? 'opportunity-1' : null,
          wholesaleAccountId: opportunityTask ? 'wholesale-1' : null,
        };
      },
      updateMany: async (args: any) => { calls.push({ name: 'updateMany', args }); return { count: owned ? writeCount : 0 }; },
      findUnique: async ({ where }: any) => {
        calls.push({ name: 'find-submission', args: where });
        const key = where.organizationId_submissionKey.submissionKey;
        return submissionKeys.has(key) ? { id: 'existing-task' } : null;
      },
      create: async (args: any) => {
        const key = args.data.submissionKey;
        if (submissionKeys.has(key)) throw { code: 'P2002' };
        calls.push({ name: 'create', args });
        submissionKeys.add(key);
        return { id: 'new-task' };
      },
    },
    user: {
      findFirst: async ({ where }: any) => {
        calls.push({ name: 'find-assignee', args: where });
        return where.organizationId === 'tenant' ? assignees.get(where.id) ?? null : null;
      },
    },
    agency: { findUnique: async ({ where }: any) => accountAvailable ? { id: where.id } : null },
    wholesaleAccount: { findFirst: async ({ where }: any) => accountAvailable && where.mergedIntoId === null ? { id: where.id } : null },
    opportunityEvent: { create: async (args: any) => { calls.push({ name: 'opportunity-event', args }); return args; } },
  };
  prisma.$transaction = async (callback: (transaction: any) => unknown) => callback(prisma);
  const source = readFileSync(new URL('../app/my-week/actions.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(compiled, context);
  return { actions: context.module.exports, calls };
}

test('drag/drop scheduling updates the existing tenant task in place and keeps all other context', async () => {
  const { actions, calls } = loadSchedulerActions();
  const form = new FormData();
  form.set('id', 'existing-task');
  form.set('expectedUpdatedAt', schedulerUpdatedAt);
  form.set('dueDate', '2026-09-24');
  form.set('dueTime', '10:30');
  const result = await (actions.updateSchedulerWorklistItem as (data: FormData) => Promise<{ success?: string; error?: string }>)(form);
  assert.equal(result.success, 'Worklist schedule saved.');
  const update = calls.find((call) => call.name === 'updateMany')!.args;
  assert.equal(update.where.id, 'existing-task');
  assert.equal(update.where.updatedAt.toISOString(), schedulerUpdatedAt);
  assert.equal(update.data.dueDate.toISOString(), '2026-09-24T00:00:00.000Z');
  assert.equal(update.data.dueTimeMinutes, 630);
  assert.deepEqual(Object.keys(update.data).sort(), ['dueDate', 'dueTimeMinutes']);
  assert.equal(calls.filter((call) => call.name === 'create').length, 0);
  assert.ok(calls.some((call) => call.name === 'calendar' && call.args === 'existing-task'));
});

test('reassignment updates the same task id with a validated in-tenant assignee', async () => {
  const { actions, calls } = loadSchedulerActions();
  const form = new FormData();
  form.set('id', 'existing-task');
  form.set('expectedUpdatedAt', schedulerUpdatedAt);
  form.set('dueDate', '2026-09-24');
  form.set('dueTime', '');
  form.set('assignedToUserId', 'teammate');
  await (actions.updateSchedulerWorklistItem as (data: FormData) => Promise<unknown>)(form);
  const update = calls.find((call) => call.name === 'updateMany')!.args;
  assert.equal(update.where.id, 'existing-task');
  assert.equal(update.data.assignedToUserId, 'teammate');
  assert.equal(update.data.assignedTo, 'Team Mate');
  assert.equal(calls.filter((call) => call.name === 'create').length, 0);
});

test('reassignment of an opportunity task records the existing reassignment event in the same transaction', async () => {
  const { actions, calls } = loadSchedulerActions({ opportunityTask: true });
  const form = new FormData();
  form.set('id', 'existing-task');
  form.set('expectedUpdatedAt', schedulerUpdatedAt);
  form.set('dueDate', '2026-09-24');
  form.set('dueTime', '');
  form.set('assignedToUserId', 'teammate');
  const result = await (actions.updateSchedulerWorklistItem as (data: FormData) => Promise<{ success?: string }>)(form);
  assert.equal(result.success, 'Worklist schedule saved.');
  const event = calls.find((call) => call.name === 'opportunity-event')!.args.data;
  assert.equal(event.organizationId, 'tenant');
  assert.equal(event.opportunityId, 'opportunity-1');
  assert.equal(event.wholesaleAccountId, 'wholesale-1');
  assert.equal(event.eventType, 'TASK_REASSIGNED');
  assert.equal(event.metadata.assignedToUserId, 'teammate');
});

test('tenant-inaccessible tasks are rejected before schedule writes', async () => {
  const { actions, calls } = loadSchedulerActions({ owned: false });
  const form = new FormData();
  form.set('id', 'other-tenant-task');
  form.set('expectedUpdatedAt', schedulerUpdatedAt);
  form.set('dueDate', '2026-09-24');
  form.set('dueTime', '10:00');
  const result = await (actions.updateSchedulerWorklistItem as (data: FormData) => Promise<{ success?: string; error?: string }>)(form);
  assert.match(result.error ?? '', /no longer active/);
  assert.equal(calls.filter((call) => call.name === 'update' || call.name === 'create' || call.name === 'calendar').length, 0);
});

test('stale schedule saves do not overwrite a newer Worklist row or start a calendar sync', async () => {
  const { actions, calls } = loadSchedulerActions({ writeCount: 0 });
  const form = new FormData();
  form.set('id', 'existing-task');
  form.set('expectedUpdatedAt', schedulerUpdatedAt);
  form.set('dueDate', '2026-09-24');
  form.set('dueTime', '10:00');
  const result = await (actions.updateSchedulerWorklistItem as (data: FormData) => Promise<{ error?: string; refresh?: boolean }>)(form);
  assert.match(result.error ?? '', /changed or is no longer active/);
  assert.equal(result.refresh, true);
  assert.equal(calls.filter((call) => call.name === 'calendar').length, 0);
  assert.equal(calls.filter((call) => call.name === 'opportunity-event').length, 0);
});

test('calendar creation creates one normal Worklist row with selected account and schedule', async () => {
  const { actions, calls } = loadSchedulerActions();
  const form = new FormData();
  form.set('title', 'Visit Arena Wine & Spirits');
  form.set('submissionKey', '00000000-0000-4000-8000-000000000001');
  form.set('category', 'WHOLESALE');
  form.set('wholesaleAccountId', 'account-1');
  form.set('dueDate', '2026-09-25');
  form.set('dueTime', '09:00');
  form.set('assignedToUserId', 'rep');
  form.set('detail', 'Review the new menu');
  const result = await (actions.createSchedulerWorklistItem as (data: FormData) => Promise<{ success?: string; error?: string }>)(form);
  assert.equal(result.success, 'Worklist task created.');
  const created = calls.find((call) => call.name === 'create')!.args.data;
  assert.equal(created.organizationId, 'tenant');
  assert.equal(created.source, 'MANUAL');
  assert.equal(created.wholesaleAccountId, 'account-1');
  assert.equal(created.assignedToUserId, 'rep');
  assert.equal(created.dueDate.toISOString(), '2026-09-25T00:00:00.000Z');
  assert.equal(created.dueTimeMinutes, 540);
  assert.equal(created.submissionKey, '00000000-0000-4000-8000-000000000001');
  assert.equal(calls.filter((call) => call.name === 'create').length, 1);
  assert.ok(calls.some((call) => call.name === 'calendar' && call.args === 'new-task'));
});

test('replaying a scheduler create request with the same key returns success without a duplicate task', async () => {
  const { actions, calls } = loadSchedulerActions();
  const form = new FormData();
  form.set('submissionKey', '00000000-0000-4000-8000-000000000002');
  form.set('title', 'Prepare tasting follow-up');
  form.set('category', 'GENERAL');
  form.set('dueDate', '2026-09-24');
  form.set('dueTime', '');
  const create = actions.createSchedulerWorklistItem as (data: FormData) => Promise<{ success?: string }>;
  assert.equal((await create(form)).success, 'Worklist task created.');
  assert.equal((await create(form)).success, 'Worklist task already created.');
  assert.equal(calls.filter((call) => call.name === 'create').length, 1);
  assert.equal(calls.filter((call) => call.name === 'calendar').length, 1);
});

test('concurrent retries with the same create key rely on the unique key to create only one task', async () => {
  const { actions, calls } = loadSchedulerActions();
  const form = new FormData();
  form.set('submissionKey', '00000000-0000-4000-8000-000000000006');
  form.set('title', 'Prepare tasting follow-up');
  form.set('category', 'GENERAL');
  form.set('dueDate', '2026-09-24');
  form.set('dueTime', '');
  const create = actions.createSchedulerWorklistItem as (data: FormData) => Promise<{ success?: string }>;
  const results = await Promise.all([create(form), create(form)]);
  assert.deepEqual(results.map((result) => result.success).sort(), ['Worklist task already created.', 'Worklist task created.'].sort());
  assert.equal(calls.filter((call) => call.name === 'create').length, 1);
  assert.equal(calls.filter((call) => call.name === 'calendar').length, 1);
});

test('category-specific task creation rejects a missing or unavailable account', async () => {
  for (const category of ['AGENCY', 'WHOLESALE']) {
    const { actions, calls } = loadSchedulerActions();
    const form = new FormData();
    form.set('submissionKey', `00000000-0000-4000-8000-00000000000${category === 'AGENCY' ? '3' : '4'}`);
    form.set('title', 'Visit account');
    form.set('category', category);
    const result = await (actions.createSchedulerWorklistItem as (data: FormData) => Promise<{ error?: string }>)(form);
    assert.match(result.error ?? '', /Choose (an agency|a wholesale account)/);
    assert.equal(calls.filter((call) => call.name === 'create').length, 0);
  }

  const { actions, calls } = loadSchedulerActions({ accountAvailable: false });
  const form = new FormData();
  form.set('submissionKey', '00000000-0000-4000-8000-000000000005');
  form.set('title', 'Visit account');
  form.set('category', 'WHOLESALE');
  form.set('wholesaleAccountId', 'inactive-account');
  assert.match((await (actions.createSchedulerWorklistItem as (data: FormData) => Promise<{ error?: string }>)(form)).error ?? '', /no longer available/);
  assert.equal(calls.filter((call) => call.name === 'create').length, 0);
});

test('scheduler actions reject orphaned times and nonexistent spring-forward times', async () => {
  const { actions, calls } = loadSchedulerActions();
  const form = new FormData();
  form.set('id', 'existing-task');
  form.set('expectedUpdatedAt', schedulerUpdatedAt);
  form.set('dueDate', '');
  form.set('dueTime', '09:00');
  assert.match((await (actions.updateSchedulerWorklistItem as (data: FormData) => Promise<{ error?: string }>)(form)).error ?? '', /Choose a date/);
  form.set('dueDate', '2026-03-08');
  form.set('dueTime', '02:30');
  assert.match((await (actions.updateSchedulerWorklistItem as (data: FormData) => Promise<{ error?: string }>)(form)).error ?? '', /does not exist/);
  assert.equal(calls.filter((call) => call.name === 'updateMany').length, 0);
});

test('completion uses the displayed updatedAt and refuses a stale task', async () => {
  const { actions, calls } = loadSchedulerActions({ writeCount: 0 });
  const form = new FormData();
  form.set('id', 'existing-task');
  form.set('expectedUpdatedAt', schedulerUpdatedAt);
  const result = await (actions.completeSchedulerWorklistItem as (data: FormData) => Promise<{ error?: string; refresh?: boolean }>)(form);
  assert.equal(result.refresh, true);
  assert.match(result.error ?? '', /changed or is no longer active/);
  assert.equal(calls.filter((call) => call.name === 'calendar').length, 0);
});

test('My Schedule loads one tenant-scoped dataset for both day and week views', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /getSchedulerWeekDates\(anchorDate\)/);
  assert.match(page, /view === 'week' \? weekDates\[0\] : anchorDate/);
  assert.match(page, /view === 'week' \? weekDates\[6\] : anchorDate/);
  assert.match(page, /organizationId,/);
  assert.match(page, /assignedToUserId: user\.id/);
  assert.match(page, /status: \{ in: \[WorklistStatus\.OPEN, WorklistStatus\.IN_PROGRESS\] \}/);
  assert.match(page, /take: 300/);
  assert.match(page, /view=\{view\}/);

  const legacyRoute = readFileSync(new URL('../app/my-week/page.tsx', import.meta.url), 'utf8');
  assert.match(legacyRoute, /redirect\(`\/\?view=week/);
});

test('schedule tabs and date controls stay on the combined route and preserve the active view', () => {
  const scheduler = readFileSync(new URL('../app/my-week/WorklistScheduler.tsx', import.meta.url), 'utf8');
  assert.match(scheduler, /aria-label="Schedule view"/);
  assert.match(scheduler, /scheduleHref\('day', view === 'week' \? mobileDate : anchorDate\)/);
  assert.match(scheduler, /scheduleHref\('week', anchorDate\)/);
  assert.match(scheduler, /scheduleHref\(view, previousDate\)/);
  assert.match(scheduler, /scheduleHref\(view, nextDate\)/);
  assert.match(scheduler, /name="expectedUpdatedAt"/);
  assert.match(scheduler, /name="submissionKey"/);
  assert.match(scheduler, /scheduleInFlightRef\.current/);
});
