import assert from 'node:assert/strict';
import test from 'node:test';
import { supplyEmailCoverage } from '../lib/productionSupplies/mailFreshness';

const now = new Date('2026-11-21T20:00:00.000Z');
const checked = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000);
const connected = (hoursAgo: number, cursor: unknown = undefined) => ({
  status: 'PROCESSING', connectionId: 'connected', lastSuccessfulSyncAt: checked(hoursAgo), cursor,
});

test('a stalled connected mailbox makes the shared Supplies coverage stale', () => {
  const result = supplyEmailCoverage([connected(96), connected(2), connected(12)], 360, now);
  assert.equal(result.stale, true);
  assert.deepEqual(result.oldestCheckAt, checked(96));
  assert.equal(result.connectionRequired, false);
  assert.equal(supplyEmailCoverage([connected(13), connected(2), connected(12)], 360, now).stale, false);
});

test('a recent watched-reply check keeps coverage current while catch-up continues', () => {
  const result = supplyEmailCoverage([connected(96, { lastRecentCheckAt: checked(5).toISOString() })], 360, now);
  assert.equal(result.stale, false);
  assert.equal(result.awaitingCheck, false);
  assert.deepEqual(result.oldestCheckAt, checked(5));
});

test('a failed or invalid first recent check cannot inherit a successful catch-up timestamp', () => {
  for (const lastRecentCheckAt of [null, 'invalid', checked(-1).toISOString()]) {
    const result = supplyEmailCoverage([connected(1, { lastRecentCheckAt })], 360, now);
    assert.equal(result.awaitingCheck, true);
    assert.equal(result.oldestCheckAt, null);
  }
});

test('connection, paused monitoring and wider polling intervals retain their meaning', () => {
  const result = supplyEmailCoverage([
    connected(22),
    { ...connected(100), status: 'PAUSED' },
    { ...connected(100), status: 'CONNECTION_REQUIRED', connectionId: null },
  ], 1440, now);
  assert.equal(result.connectionRequired, true);
  assert.equal(result.stale, false);
  assert.deepEqual(result.oldestCheckAt, checked(22));
});
