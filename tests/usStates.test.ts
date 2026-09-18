import assert from 'node:assert/strict';
import { it } from 'node:test';
import { isOhioAccount, isOutsideOhio, normalizeUsState, stateScopedLicenseeIds } from '../lib/usStates';
import { opportunityTerritoryAccountWhere } from '../lib/opportunityTerritories';

it('normalizes US locations and isolates state-issued permits from Ohio sales imports', () => {
  assert.equal(normalizeUsState(' kentucky '), 'KY');
  assert.equal(normalizeUsState('oh'), 'OH');
  assert.equal(normalizeUsState('Ontario'), null);
  assert.equal(isOhioAccount(null), true);
  assert.equal(isOutsideOhio('Kentucky'), true);
  assert.equal(isOutsideOhio(null), false);
  assert.deepEqual(stateScopedLicenseeIds(['123', 'KY:456', 'MANUAL-test'], 'KY'), ['KY:123', 'KY:456', 'MANUAL-test']);
  assert.deepEqual(stateScopedLicenseeIds(['123'], 'OH'), ['123']);
  for (const territory of ['central-ohio', 'other-ohio'] as const) {
    const filter = opportunityTerritoryAccountWhere(territory);
    assert.deepEqual((filter.AND as object[])[0], { OR: [{ state: { in: ['OH', 'Ohio'], mode: 'insensitive' } }, { state: null }, { state: '' }] });
  }
});
