import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextSourceIsStale, emptyStoreContext, readCategoryMix, readStoreContext, storeContextSchema } from '../lib/agencyStoreContext';

test('unknown store context stays unknown and permits an empty profile', () => {
  const value = storeContextSchema.parse(emptyStoreContext());
  assert.equal(value.demographics.medianHouseholdIncome, null);
  assert.equal(value.store.ownership, 'Unknown');
  assert.equal(readStoreContext(null), null);
  assert.equal(readStoreContext({ notes: 'legacy overlay' }), null);
});
test('store and area claims require provenance and chain identity', () => {
  const value = emptyStoreContext(); value.store.ownership = 'Chain';
  assert.equal(storeContextSchema.safeParse(value).success, false);
  value.store.chainName = 'Example'; value.store.source = { name: 'Buyer conversation', url: '', observedOn: '2026-09-01' };
  assert.equal(storeContextSchema.safeParse(value).success, true);
  value.area.nearby = ['Restaurants / bars'];
  assert.equal(storeContextSchema.safeParse(value).success, false);
});
test('demographics require geography, data vintage and a public source; zero is preserved', () => {
  const value = emptyStoreContext(); value.demographics.adultPopulation = 0;
  assert.equal(storeContextSchema.safeParse(value).success, false);
  Object.assign(value.demographics, { geography: 'Census tract example', year: 2024, source: { name: 'Census', url: 'https://data.census.gov/', observedOn: '2026-09-01' } });
  assert.equal(storeContextSchema.parse(value).demographics.adultPopulation, 0);
  value.demographics.adultPopulation = -1;
  assert.equal(storeContextSchema.safeParse(value).success, false);
});
test('sources reject unsafe links, invalid dates and unbounded text', () => {
  const value = emptyStoreContext(); value.store.source.url = 'javascript:alert(1)';
  assert.equal(storeContextSchema.safeParse(value).success, false);
  value.store.source.url = ''; value.store.source.observedOn = '2026-02-30';
  assert.equal(storeContextSchema.safeParse(value).success, false);
  value.store.source.observedOn = '2099-01-01';
  assert.equal(storeContextSchema.safeParse(value).success, false);
  value.store.source.observedOn = ''; value.store.notes = 'x'.repeat(1001);
  assert.equal(storeContextSchema.safeParse(value).success, false);
});
test('stored evidence is versioned and aging evidence is flagged', () => {
  const value = { ...emptyStoreContext(), version: 1, savedAt: '2026-09-17T12:00:00Z', savedBy: 'user-1' };
  assert.equal(readStoreContext(value)?.savedBy, 'user-1');
  assert.equal(contextSourceIsStale('2025-01-01', new Date('2026-09-17')), true);
  assert.equal(contextSourceIsStale('2026-09-01', new Date('2026-09-17')), false);
  assert.deepEqual(readCategoryMix({ RUM: 10, VODKA: 20, BAD: -1, OTHER: '100' }), [['VODKA', 20], ['RUM', 10]]);
});
