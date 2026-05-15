import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  agencyVisitOutcomePrompts,
  getVisitOutcomePrompts,
  wholesaleVisitOutcomePrompts,
} from '../app/visits/visitPrompts';

describe('visit outcome prompts', () => {
  it('exposes separate editable prompt configs by visit type', () => {
    assert.ok(wholesaleVisitOutcomePrompts.length > 0);
    assert.ok(agencyVisitOutcomePrompts.length > 0);
    assert.notEqual(wholesaleVisitOutcomePrompts, agencyVisitOutcomePrompts);
  });

  it('returns ordered prompts for wholesale and agency visits', () => {
    const wholesalePrompts = getVisitOutcomePrompts('wholesale');
    const agencyPrompts = getVisitOutcomePrompts('agency');

    assert.deepEqual(
      wholesalePrompts.map((prompt) => prompt.label),
      agencyPrompts.map((prompt) => prompt.label),
    );
    assert.equal(wholesalePrompts[0].label, 'Display checked');
    assert.equal(agencyPrompts[0].label, 'Display checked');
  });
});
