import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isDismissedOpportunityMatch } from '../lib/opportunityWorkflow';

const current = {
  type: 'CATEGORY_CONQUEST',
  targetCategory: 'VODKA',
  targetProduct: { itemCode: '3135B' },
};

describe('tenant opportunity workflow state', () => {
  it('keeps a dismissed opportunity suppressed when only its generated cycle changes', () => {
    assert.equal(isDismissedOpportunityMatch(current, [{
      type: 'CATEGORY_CONQUEST',
      targetCategory: 'VODKA',
      events: [{ metadata: { hypothesis: current } }],
    }]), true);
  });

  it('does not suppress a different product or category for the same account', () => {
    assert.equal(isDismissedOpportunityMatch({ ...current, targetProduct: { itemCode: '5656L' } }, [{
      type: 'CATEGORY_CONQUEST',
      targetCategory: 'VODKA',
      events: [{ metadata: { hypothesis: current } }],
    }]), false);
    assert.equal(isDismissedOpportunityMatch({ ...current, targetCategory: 'RUM' }, [{
      type: 'CATEGORY_CONQUEST',
      targetCategory: 'VODKA',
      events: [{ metadata: { hypothesis: current } }],
    }]), false);
  });

  it('fails closed to type and category for legacy dismissals without detection metadata', () => {
    assert.equal(isDismissedOpportunityMatch(current, [{
      type: 'CATEGORY_CONQUEST',
      targetCategory: 'VODKA',
      events: [],
    }]), true);
  });
});
