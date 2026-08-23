import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  agencyVisitOutcomes,
  getMatchingVisitWorklistItems,
  getOutcomeLabels,
  getRequestedWorklistCompletionIds,
  getVisitTaskEditPlan,
  getVisitOutcomeDisplay,
  getVisitOutcomes,
  normalizeFollowUpMode,
  sanitizeOutcomeCodes,
  shouldCreateVisitTask,
  wholesaleVisitOutcomes,
} from '../lib/visitWorkflow';

describe('visit outcome configuration', () => {
  it('keeps shared language but supports visit-type-specific outcomes', () => {
    assert.ok(wholesaleVisitOutcomes.some((outcome) => outcome.code === 'menu-opportunity'));
    assert.ok(agencyVisitOutcomes.some((outcome) => outcome.code === 'display-opportunity'));
    assert.equal(wholesaleVisitOutcomes.some((outcome) => outcome.code === 'display-opportunity'), false);
    assert.equal(agencyVisitOutcomes.some((outcome) => outcome.code === 'menu-opportunity'), false);
  });

  it('sanitizes submitted outcome codes against the selected visit type', () => {
    assert.deepEqual(
      sanitizeOutcomeCodes('wholesale', ['met-buyer', 'menu-opportunity', 'menu-opportunity', 'forged-value']),
      ['met-buyer', 'menu-opportunity'],
    );
    assert.deepEqual(getOutcomeLabels('wholesale', ['met-buyer', 'menu-opportunity']), ['Met buyer', 'Menu opportunity']);
  });

  it('preserves readable outcomes for visits created before structured codes', () => {
    assert.deepEqual(
      getVisitOutcomeDisplay({ locationType: 'agency', outcomeCodes: [], legacyOutcomes: 'Quick outcomes: Met buyer, Display checked' }),
      ['Met buyer', 'Display checked'],
    );
    assert.equal(getVisitOutcomes('agency').length > 0, true);
  });
});

describe('visit follow-up behavior', () => {
  it('uses Save next step as the single worklist-creation mode', () => {
    assert.equal(shouldCreateVisitTask(normalizeFollowUpMode('task')), true);
    assert.equal(shouldCreateVisitTask(normalizeFollowUpMode('later')), true);
    assert.equal(shouldCreateVisitTask(normalizeFollowUpMode('unexpected')), false);
  });

  it('updates the linked follow-up on edit instead of creating a duplicate', () => {
    assert.equal(getVisitTaskEditPlan('task', 'OPEN'), 'update');
    assert.equal(getVisitTaskEditPlan('task', null), 'create');
    assert.equal(getVisitTaskEditPlan('none', 'OPEN'), 'cancel');
    assert.equal(getVisitTaskEditPlan(normalizeFollowUpMode('later'), 'COMPLETED'), 'update');
  });

  it('finds only worklist items for the selected visit account', () => {
    const items = [
      { agencyId: null, id: 'wholesale-match', title: 'Follow up', wholesaleAccountId: 'wholesale-1' },
      { agencyId: null, id: 'wholesale-other', title: 'Other account', wholesaleAccountId: 'wholesale-2' },
      { agencyId: 'agency-1', id: 'agency-match', title: 'Check display', wholesaleAccountId: null },
    ];

    assert.deepEqual(
      getMatchingVisitWorklistItems({ agencyId: null, items, locationType: 'wholesale', wholesaleAccountId: 'wholesale-1' })
        .map((item) => item.id),
      ['wholesale-match'],
    );
    assert.deepEqual(
      getMatchingVisitWorklistItems({ agencyId: 'agency-1', items, locationType: 'agency', wholesaleAccountId: null })
        .map((item) => item.id),
      ['agency-match'],
    );
  });

  it('accepts only explicit complete decisions from the form', () => {
    assert.deepEqual(
      getRequestedWorklistCompletionIds([
        ['worklistCompletion:item-1', 'complete'],
        ['worklistCompletion:item-2', 'leave-open'],
        ['worklistCompletion:item-1', 'complete'],
        ['unrelated', 'complete'],
      ]),
      ['item-1'],
    );
  });
});
