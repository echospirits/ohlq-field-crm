import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { accountAddressSearchClauses } from '../lib/accountAddressSearch';

describe('account address search', () => {
  it('matches city, street, ZIP and county independently, ignoring case', () => {
    for (const [field, term] of [
      ['city', 'Columbus'],
      ['address', 'High St'],
      ['zip', '43212'],
      ['county', 'Franklin'],
    ] as const) {
      assert.ok(accountAddressSearchClauses(term).some((clause) =>
        clause[field]?.contains === term && clause[field]?.mode === 'insensitive'));
    }
  });

  it('matches a pasted address across multiple fields with every term required', () => {
    const clauses = accountAddressSearchClauses('123 High St, Columbus, OH 43212');
    const combined = clauses.find((clause) => clause.AND)?.AND;

    assert.ok(combined);
    assert.deepEqual(combined.slice(0, -1).map(({ OR }) => OR[0].address?.contains), [
      '123', 'High', 'St', 'Columbus', 'OH',
    ]);
    assert.ok(combined[3].OR.some((clause) => clause.city?.contains === 'Columbus'));
    assert.ok(combined[4].OR.some(({ state }) =>
      typeof state === 'object' && Array.isArray(state?.in) && state.in.includes('OH')));
    assert.deepEqual(combined[5].OR, [{ zip: { startsWith: '43212' } }]);
  });

  it('normalizes state names and preserves a whole city phrase', () => {
    assert.deepEqual(accountAddressSearchClauses(' ohio ').map(({ state }) => state).filter((state) => state !== undefined), [
      { in: ['OH', 'Ohio'], mode: 'insensitive' }, null, '',
    ]);
    assert.ok(accountAddressSearchClauses('New Albany').some((clause) =>
      clause.city?.contains === 'New Albany'));
    assert.ok(accountAddressSearchClauses('Albany, New York 12207').some((clause) =>
      clause.AND?.[1].OR.some(({ state }) =>
        typeof state === 'object' && Array.isArray(state?.in) && state.in.includes('NY'))));
    assert.deepEqual(accountAddressSearchClauses(' '), []);
  });
});
