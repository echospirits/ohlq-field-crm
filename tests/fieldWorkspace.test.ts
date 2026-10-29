import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountBriefingView } from '../app/components/AccountBriefingView';
import { AccountWorkspace } from '../app/components/AccountWorkspace';
import { getWorklistOverdueLabel } from '../lib/worklistPresentation';

test('overdue urgency respects Eastern today, UTC date-only due dates, and completed work', () => {
  const due = new Date('2026-10-28T00:00:00Z');
  assert.equal(getWorklistOverdueLabel(due, 'OPEN', new Date('2026-10-29T02:00:00Z')), null);
  assert.equal(getWorklistOverdueLabel(due, 'OPEN', new Date('2026-10-29T12:00:00Z')), '1 day overdue');
  assert.equal(getWorklistOverdueLabel(new Date('2026-09-10'), 'IN_PROGRESS', new Date('2026-10-28T12:00:00Z')), '48 days overdue');
  assert.equal(getWorklistOverdueLabel(due, 'COMPLETED', new Date('2026-10-30T12:00:00Z')), null);
  assert.equal(getWorklistOverdueLabel(null, 'OPEN'), null);
});

const briefing = {
  lastContact: null, lastMeaningful: null, lastVisit: null, lastFollowUp: null,
  health: { score: null, reasons: [{ label: 'No active relationship contact recorded', penalty: 20 }], missing: ['Meaningful contact history', 'Purchase evidence'], contactDays: 30 },
  indicators: { status: 'Needs attention', reasons: ['No active contact recorded.'], nextAction: 'Identify a buyer or decision-maker', days: null },
  tasks: [], pipeline: null,
};

test('sparse briefing uses one empty summary and keeps uncertainty and score evidence available', () => {
  const html = renderToStaticMarkup(createElement(AccountBriefingView, { briefing }));
  assert.ok(!html.includes('Not recorded'));
  assert.ok(!html.includes('No active contact recorded.'));
  assert.ok(html.includes('No recorded relationship history available for this briefing.'));
  assert.ok(html.includes('Identify a buyer or decision-maker'));
  assert.ok(html.includes('Relationship evidence'));
  assert.ok(html.includes('Missing data is not zero performance.'));
  assert.ok(!html.includes('Relationship health: 0/100'));
});

test('populated briefing shows only known facts and retains an available score', () => {
  const html = renderToStaticMarkup(createElement(AccountBriefingView, { briefing: { ...briefing, lastContact: new Date('2026-10-27T15:00:00Z'), health: { ...briefing.health, score: 80, missing: [] } } }));
  assert.ok(html.includes('Last contact'));
  assert.ok(!html.includes('<dt>Physical visit</dt>'));
  assert.ok(!html.includes('No recorded relationship history'));
  assert.ok(html.includes('Relationship health: 80/100'));
});

test('account tabs keep panels mounted, expose their names, and preserve the requested return section', () => {
  const html = renderToStaticMarkup(createElement(AccountWorkspace, { initialSection: 'purchases', panels: [
    { id: 'overview', label: 'Overview', content: createElement('input', { defaultValue: 'Unsaved note', name: 'note' }) },
    { id: 'purchases', label: 'Purchases', content: 'Actual purchase rows' },
  ] }));
  assert.ok(html.includes('role="tablist"'));
  assert.ok(html.includes('aria-controls="purchases" aria-selected="true"'));
  assert.ok(html.includes('value="Unsaved note"'));
  assert.ok(html.includes('Actual purchase rows'));
  assert.ok(html.includes('hidden="" id="overview"'));
});
