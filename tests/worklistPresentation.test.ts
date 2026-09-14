import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getWorklistGroup } from '../lib/worklistPresentation';

test('work grouping treats due dates as calendar dates and retains finished and undated tasks', () => {
  const today = '2026-09-14';
  assert.equal(getWorklistGroup({ dueDate: new Date('2026-09-14T00:00:00Z'), status: 'OPEN' }, today), 'Today');
  assert.equal(getWorklistGroup({ dueDate: new Date('2026-09-13T00:00:00Z'), status: 'OPEN' }, today), 'Overdue');
  assert.equal(getWorklistGroup({ dueDate: new Date('2026-09-15T00:00:00Z'), status: 'IN_PROGRESS' }, today), 'Upcoming');
  assert.equal(getWorklistGroup({ dueDate: null, status: 'OPEN' }, today), 'Unscheduled');
  for (const status of ['COMPLETED', 'CANCELLED']) assert.equal(getWorklistGroup({ dueDate: new Date('2020-01-01'), status }, today), 'Finished');
});
