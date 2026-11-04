import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

function renderCalendar(status: string, message: string | null) {
  const path = resolve('app/alerts/WorklistActions.tsx'), native = createRequire(path), exports: Record<string, any> = {};
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mocks: Record<string, unknown> = {
    '../components/SubmitButton': { SubmitButton: ({ children, pendingLabel: _pending, ...props }: any) => h('button', props, children) },
    '../components/ActionForm': { ActionForm: ({ children }: any) => h('form', null, children) },
    '../components/useDialogFocus': { useDialogFocus: () => undefined },
    '../visits/LogVisitForm': { LogVisitForm: () => null },
  };
  runInNewContext(code, { exports, require: (name: string) => name in mocks ? mocks[name] : native(name) });
  const action = () => { throw Error('Presentation tests must not mutate work'); };
  return renderToStaticMarkup(h(exports.WorklistActions, {
    item: { id: 'task', title: 'Contact buyer', detail: null, editDetail: null, dueDate: '', dueTime: '', assignedToUserId: null, calendarSyncStatus: status, calendarSyncError: message, status: 'OPEN', category: 'GENERAL', agencyId: null, wholesaleAccountId: null, salesOpportunityId: null, agencyProductIntelligenceId: null, productItemCode: null, productName: null, location: null },
    actorName: 'Rep', agencies: [], wholesaleAccounts: [], contacts: [], tags: [], createVisitAction: action, updateStatusAction: action, updateItemAction: action, currentUserId: 'rep', users: [],
  }));
}

test('real calendar errors are visible alerts outside the edit disclosure, including an empty provider message', () => {
  for (const message of ['Provider rejected the update', null]) {
    const html = renderCalendar('ERROR', message);
    assert.match(html, /role="alert">Calendar sync failed/);
    assert.ok(html.indexOf('Calendar sync failed') < html.indexOf('More task actions'));
    assert.ok(html.includes(message ?? 'Review calendar settings and retry.'));
  }
});

for (const status of ['DISABLED', 'REMOVED', 'PENDING']) test(`${status} calendar messages stay visible without being mislabeled as failure`, () => {
  const html = renderCalendar(status, 'Calendar sync is paused or not connected.');
  assert.match(html, new RegExp(`role="status">Calendar ${status.toLowerCase()}: Calendar sync is paused`));
  assert.doesNotMatch(html, /Calendar sync failed|role="alert"/);
  assert.ok(html.indexOf('Calendar sync is paused') < html.indexOf('More task actions'));
});
