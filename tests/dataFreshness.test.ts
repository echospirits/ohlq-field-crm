import assert from 'node:assert/strict';
import test from 'node:test';
import { formatFreshnessDate, getDataFreshness } from '../lib/dataFreshness';

const now = new Date('2026-09-13T16:00:00.000Z');

test('freshness states use consistent current, delayed, stale, and unavailable thresholds', () => {
  assert.deepEqual(getDataFreshness({ sourceDate: '2026-09-12', now }), { ageDays: 1, state: 'current' });
  assert.deepEqual(getDataFreshness({ sourceDate: '2026-09-09', now }), { ageDays: 4, state: 'delayed' });
  assert.deepEqual(getDataFreshness({ sourceDate: '2026-09-01', now }), { ageDays: 12, state: 'stale' });
  assert.deepEqual(getDataFreshness({ sourceDate: null, now }), { ageDays: null, state: 'unavailable' });
});

test('freshness dates preserve report calendar days', () => {
  assert.equal(formatFreshnessDate('2026-09-12'), 'Sep 12, 2026');
  assert.equal(formatFreshnessDate(new Date('2026-09-12T00:00:00.000Z')), 'Sep 12, 2026');
});
