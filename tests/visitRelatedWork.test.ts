import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as enums from '@prisma/client';
import { z } from 'zod';
import { getVisitRelatedWorkWhere, getVisitWorkAccountWhere, type RelatedWorkVisit } from '../lib/visitRelatedWork';

const visit: RelatedWorkVisit & { organizationId: string; createdByUserId: string } = {
  id: 'visit', organizationId: 'tenant', createdByUserId: 'rep', locationType: 'wholesale',
  agencyId: null, wholesaleAccountId: 'account', originatingWorklistItemId: 'origin',
};
const task = (id: string, overrides = {}): Row => ({
  id, title: `Task ${id}`, organizationId: 'tenant', assignedToUserId: 'rep', assignedTo: 'Rep',
  agencyId: null, wholesaleAccountId: 'account', status: 'OPEN', source: 'MANUAL', loggedVisitId: null,
  salesOpportunityId: null, detail: null, dueDate: null, ...overrides,
});
type Row = Record<string, any>;
// Preserve SQL's three-valued null comparisons so nullable relation regressions
// cannot be hidden by ordinary JavaScript inequality in the test database.
function sqlMatch(row: Row, where: Row): boolean | null {
  const and = (values: Array<boolean | null>) => values.includes(false) ? false : values.includes(null) ? null : true;
  const or = (values: Array<boolean | null>) => values.includes(true) ? true : values.includes(null) ? null : false;
  return and(Object.entries(where).map(([key, condition]) => {
    if (key === 'AND') return and((Array.isArray(condition) ? condition : [condition]).map((entry) => sqlMatch(row, entry)));
    if (key === 'OR') return or(condition.map((entry: Row) => sqlMatch(row, entry)));
    if (key === 'NOT') { const result = sqlMatch(row, condition); return result === null ? null : !result; }
    if (condition === null) return row[key] == null;
    if (row[key] == null) return null;
    if (typeof condition === 'object' && 'in' in condition) return condition.in.includes(row[key]);
    if (typeof condition === 'object' && 'not' in condition) return row[key] !== condition.not;
    return row[key] === condition;
  }));
}
const matches = (row: Row, where: Row) => sqlMatch(row, where) === true;

function loadActions(rows: Row[], visits: Row[] = [visit]) {
  const writes: Row[] = [], history: Row[] = [], calendar: string[] = [];
  const db = {
    loggedVisit: { findFirst: async ({ where }: Row) => visits.find((row) => matches(row, where)) ?? null },
    worklistItem: {
      findFirst: async ({ where }: Row) => rows.find((row) => matches(row, where)) ?? null,
      updateMany: async ({ where, data }: Row) => {
        const matching = rows.filter((row) => matches(row, where));
        matching.forEach((row) => { Object.assign(row, data); writes.push({ id: row.id, data }); });
        return { count: matching.length };
      },
    },
    opportunityEvent: { create: async ({ data }: Row) => { history.push(data); } },
    $transaction: async (callback: (tx: unknown) => unknown) => callback(db),
  };
  const load = (file: string, dependencies: Row) => {
    const module = { exports: {} as Row };
    const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    runInNewContext(source, { module, exports: module.exports, FormData, Date, require: (name: string) => {
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency ${name}`);
    } });
    return module.exports;
  };
  const normal = load('app/alerts/actions.ts', {
    '@prisma/client': enums, 'next/cache': { revalidatePath() {} },
    '../../lib/auth': { requireUser: async () => ({ id: 'rep' }), getUserDisplayName: () => 'Rep' },
    '../../lib/organizations': { requireOrganizationContext: async () => ({ organizationId: 'tenant' }) },
    '../../lib/prisma': { prisma: db }, '../../lib/dateTime': {},
    '../../lib/calendar/scheduleWorklistSync': { scheduleWorklistSync: (id: string) => calendar.push(id) },
    '../../lib/visitRelatedWork': { getVisitRelatedWorkWhere, getVisitWorkAccountWhere },
  });
  const actions = load('app/visits/confirmed/actions.ts', { '../../alerts/actions': normal, zod: { z } });
  const complete = async (ids: string[], visitId = 'visit') => {
    const data = new FormData(); data.set('visitId', visitId);
    ids.forEach((id) => data.append('worklistItemId', id));
    return actions.completeVisitRelatedWork(data) as Promise<{ completedIds: string[]; error?: string }>;
  };
  return { complete, writes, history, calendar };
}

test('related-work qualification includes only active tenant/account/assignment matches and excludes new visit follow-ups', () => {
  const rows = [task('open'), task('progress', { status: 'IN_PROGRESS' }), task('done', { status: 'COMPLETED' }),
    task('cancelled', { status: 'CANCELLED' }), task('tenant-other', { organizationId: 'another' }),
    task('account-other', { wholesaleAccountId: 'another' }), task('teammate', { assignedToUserId: 'someone' }),
    task('unassigned', { assignedToUserId: null }), task('origin', { assignedToUserId: 'someone', source: 'VISIT_FOLLOW_UP', loggedVisitId: 'visit' }),
    task('new-next-step', { source: 'VISIT_FOLLOW_UP', loggedVisitId: 'visit' }),
    task('older-follow-up', { source: 'VISIT_FOLLOW_UP', loggedVisitId: 'previous-visit' }),
    task('unlinked-follow-up', { source: 'VISIT_FOLLOW_UP', loggedVisitId: null })];
  const where = getVisitRelatedWorkWhere('tenant', 'rep', visit);
  assert.deepEqual(rows.filter((row) => matches(row, where)).map((row) => row.id), ['open', 'progress', 'origin', 'older-follow-up', 'unlinked-follow-up']);
  assert.deepEqual((where.AND as Row[])[1].OR[1], { loggedVisitId: null });
  const invalid = getVisitRelatedWorkWhere('tenant', 'rep', { ...visit, wholesaleAccountId: null });
  assert.equal(rows.some((row) => matches(row, { ...invalid, id: row.id })), false);
});

test('one explicit completion uses normal Worklist calendar/history and leaves the others open', async () => {
  const rows = [task('one', { salesOpportunityId: 'opportunity' }), task('two')];
  const h = loadActions(rows);
  const result = await h.complete(['one']);
  assert.equal(result.error, undefined);
  assert.deepEqual(Array.from(result.completedIds), ['one']);
  assert.equal(rows[0].status, 'COMPLETED'); assert.equal(rows[1].status, 'OPEN');
  assert.equal(rows[0].loggedVisitId, 'visit'); assert.equal(rows[0].completedByUserId, 'rep');
  assert.deepEqual(h.calendar, ['one']);
  assert.equal(h.history.length, 1); assert.equal(h.history[0].eventType, 'TASK_COMPLETED');
  assert.equal(h.history[0].worklistItemId, 'one');
});

test('complete all displayed applicable items is explicit and duplicate requests do not repeat history', async () => {
  const rows = [task('one', { salesOpportunityId: 'opportunity' }), task('two')];
  const h = loadActions(rows);
  const result = await h.complete(['one', 'two', 'one']);
  assert.equal(result.completedIds.length, 2);
  assert.ok(rows.every((row) => row.status === 'COMPLETED'));
  assert.equal(h.writes.length, 2); assert.equal(h.calendar.length, 2);
  assert.equal((await h.complete(['one'])).error, undefined);
  assert.equal(h.writes.length, 2); assert.equal(h.history.length, 1);
});

test('lost completion response can replay earlier successes and finish the remaining items once', async () => {
  const rows = [task('one', { source: 'VISIT_FOLLOW_UP', loggedVisitId: 'older-visit', salesOpportunityId: 'opportunity' }), task('two')];
  const h = loadActions(rows);
  assert.equal((await h.complete(['one'])).error, undefined);
  const result = await h.complete(['one', 'two']);
  assert.equal(result.error, undefined);
  assert.deepEqual(Array.from(result.completedIds), ['one', 'two']);
  assert.equal(h.writes.length, 2); assert.equal(h.calendar.length, 2); assert.equal(h.history.length, 1);
});

test('completion retries acknowledge only the same tenant/account/actor/Visit and never alter historical completions', async () => {
  for (const overrides of [
    { organizationId: 'other' }, { wholesaleAccountId: 'other' }, { agencyId: 'unexpected-retail' },
    { completedByUserId: 'someone-else' }, { loggedVisitId: 'another-visit' },
  ]) {
    const row = task('one', { status: 'COMPLETED', completedByUserId: 'rep', loggedVisitId: 'visit', ...overrides });
    const before = structuredClone(row), h = loadActions([row]);
    assert.ok((await h.complete(['one'])).error);
    assert.deepEqual(row, before); assert.equal(h.writes.length, 0); assert.equal(h.history.length, 0); assert.equal(h.calendar.length, 0);
  }
});

test('forged cross-tenant/account/assignment, closed, or newly-created next steps cannot be completed by the prompt', async () => {
  for (const overrides of [
    { organizationId: 'other' }, { wholesaleAccountId: 'other' }, { assignedToUserId: 'other' },
    { status: 'COMPLETED' }, { status: 'CANCELLED' }, { source: 'VISIT_FOLLOW_UP', loggedVisitId: 'visit' },
  ]) {
    const h = loadActions([task('forged', overrides)]);
    assert.ok((await h.complete(['forged'])).error);
    assert.equal(h.writes.length, 0); assert.equal(h.calendar.length, 0);
  }
  for (const changedVisit of [{ ...visit, organizationId: 'other' }, { ...visit, createdByUserId: 'other' }]) {
    const h = loadActions([task('one')], [changedVisit]);
    assert.ok((await h.complete(['one'])).error); assert.equal(h.writes.length, 0);
  }
});

test('empty choices leave related work open and save no history', async () => {
  const rows = [task('one')], h = loadActions(rows);
  const result = await h.complete([]);
  assert.ok(result.error); assert.equal(rows[0].status, 'OPEN');
  assert.equal(h.writes.length, 0); assert.equal(h.history.length, 0);
});

test('post-save prompt replaces physical-visit pre-save choices and opportunity interruption', () => {
  const page = readFileSync('app/visits/confirmed/page.tsx', 'utf8');
  const form = readFileSync('app/visits/LogVisitForm.tsx', 'utf8');
  const action = readFileSync('app/visits/actions.ts', 'utf8');
  assert.match(page, /relatedWork\.length > 0 \? <RelatedWorkPrompt/);
  assert.match(page, /getVisitRelatedWorkWhere\(organizationId, user\.id, visit\)/);
  assert.match(form, /!physicalVisit && matchingWorklistItems\.length > 0/);
  assert.match(action, /requestedWorklistCompletionIds = isTaster \|\| physicalVisit\s*\? \[\]/);
  assert.doesNotMatch(page, /getVisitOriginResolution|action-opportunity|Keep open|address the opportunity/);
  assert.doesNotMatch(readFileSync('app/visits/confirmed/actions.ts', 'utf8'), /salesOpportunity\.update|agencyProductIntelligence\.update|ACTIONED/);
});

function loadPrompt(initialItems: Row[], completeAction: (data: FormData) => Promise<Row>) {
  const slots: any[] = []; let cursor = 0;
  const hooks = {
    useState(initial: any) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value: any) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef(initial: any) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(callback: any) { return callback; },
  };
  const module = { exports: {} as Row };
  const source = ts.transpileModule(readFileSync('app/visits/confirmed/RelatedWorkPrompt.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  // Use ordinary element objects so event handlers can be exercised without a DOM.
  const jsx = (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } });
  runInNewContext(source, {
    module, exports: module.exports, FormData, Set, React: { createElement: jsx },
    CustomEvent: class { constructor(public type: string, public detail: unknown) {} },
    window: { dispatchEvent() {} },
    require: (name: string) => {
      if (name === 'react') return hooks;
      if (name === 'next/navigation') return { unstable_rethrow() {} };
      if (name.includes('useDialogFocus')) return { useDialogFocus() {} };
      if (name.endsWith('.module.css')) return { default: {} };
      throw new Error(`Unexpected prompt dependency ${name}`);
    },
  });
  const render = () => { cursor = 0; return module.exports.RelatedWorkPrompt({ visitId: 'visit', initialItems, completeAction }); };
  const elements = (node: any): any[] => !node || typeof node !== 'object' ? [] : Array.isArray(node)
    ? node.flatMap(elements) : [node, ...elements(node.props?.children)];
  const label = (node: any): string => Array.isArray(node) ? node.map(label).join('') : node && typeof node === 'object' ? label(node.props?.children) : String(node ?? '');
  const button = (tree: any, text: string) => elements(tree).find((node) => node.type === 'button' && label(node.props.children) === text);
  return { render, elements, button };
}

test('prompt is absent for no qualifying items; dismissing leaves all work open without calling completion', () => {
  let calls = 0;
  const action = async () => { calls++; return { completedIds: [] }; };
  assert.equal(loadPrompt([], action).render(), null);
  const h = loadPrompt([task('one')], action);
  const tree = h.render();
  assert.ok(h.elements(tree).some((node) => node.props?.role === 'dialog'));
  h.button(tree, 'Leave open').props.onClick();
  assert.equal(h.render(), null); assert.equal(calls, 0);
});

test('prompt individual and all controls submit only displayed items and block repeat submission while saving', async () => {
  const rows = [task('one'), task('two')], actions = loadActions(rows);
  const h = loadPrompt(rows.map((row) => ({ ...row })), async (data) => actions.complete(data.getAll('worklistItemId').map(String)));
  h.button(h.render(), 'Complete').props.onClick();
  assert.equal(h.button(h.render(), 'Completing…').props.disabled, true);
  await new Promise(setImmediate);
  assert.equal(rows[0].status, 'COMPLETED'); assert.equal(rows[1].status, 'OPEN');
  h.button(h.render(), 'Complete all (1)').props.onClick();
  await new Promise(setImmediate);
  assert.equal(rows[1].status, 'COMPLETED'); assert.equal(h.render(), null);
  assert.equal(actions.writes.length, 2);
});

test('prompt preserves open work and shows an actionable failure when completion is refused', async () => {
  const h = loadPrompt([task('one')], async () => ({ completedIds: [], error: 'This task changed. Refresh the worklist.' }));
  h.button(h.render(), 'Complete').props.onClick();
  await new Promise(setImmediate);
  const tree = h.render();
  assert.ok(h.elements(tree).some((node) => node.props?.role === 'alert'));
  assert.ok(h.button(tree, 'Complete')); assert.ok(h.button(tree, 'Leave open'));
});
