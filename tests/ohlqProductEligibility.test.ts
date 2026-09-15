import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getDistilleryOnlyItemCodes,
  isOpportunityEligibleOhlqProduct,
} from '../lib/ohlqProductEligibility';

describe('opportunity product eligibility', () => {
  it('admits active wholesale products', () => {
    assert.equal(isOpportunityEligibleOhlqProduct(
      { itemCode: '3135B', solItemStatusCode: '70' },
      new Set(),
    ), true);
  });

  it('rejects delisted and distillery-only products', () => {
    const restrictions = getDistilleryOnlyItemCodes({ distilleryOnlyItemCodes: ['4429B'] });
    assert.equal(isOpportunityEligibleOhlqProduct(
      { itemCode: '2799B', solItemStatusCode: '30' },
      restrictions,
    ), false);
    assert.equal(isOpportunityEligibleOhlqProduct(
      { itemCode: '4429B', solItemStatusCode: '70' },
      restrictions,
    ), false);
  });

  it('fails closed for missing or unknown OHLQ status values', () => {
    assert.equal(isOpportunityEligibleOhlqProduct(
      { itemCode: 'UNKNOWN', solItemStatusCode: null },
      new Set(),
    ), false);
    assert.deepEqual([...getDistilleryOnlyItemCodes({ distilleryOnlyItemCodes: 'invalid' })], []);
  });
});
