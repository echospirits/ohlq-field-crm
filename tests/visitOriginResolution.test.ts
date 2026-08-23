import assert from 'node:assert/strict';
import test from 'node:test';
import { getVisitOriginResolution } from '../lib/visitOriginResolution';

test('post-visit resolution prioritizes an originating open task', () => {
  assert.equal(getVisitOriginResolution({ originatingTaskStatus: 'OPEN', salesOpportunityStatus: 'OPEN' }), 'task');
  assert.equal(getVisitOriginResolution({ originatingTaskStatus: 'IN_PROGRESS' }), 'task');
});

test('post-visit resolution offers opportunity actioning only while it is open', () => {
  assert.equal(getVisitOriginResolution({ originatingTaskStatus: 'COMPLETED', agencyOpportunityStatus: 'OPEN' }), 'opportunity');
  assert.equal(getVisitOriginResolution({ salesOpportunityStatus: 'OPEN' }), 'opportunity');
  assert.equal(getVisitOriginResolution({ originatingTaskStatus: 'COMPLETED', salesOpportunityStatus: 'ACTIONED' }), null);
});
