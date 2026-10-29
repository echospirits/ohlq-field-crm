import assert from 'node:assert/strict';
import test from 'node:test';
import { opportunityInboxHref, opportunityInboxPageNumber } from '../lib/opportunityInboxView';

test('opportunity pagination keeps the full filter context and returns to the browsed page', () => {
  const query = { q: 'Rum & rye', territory: 'central', mode: 'RESEARCH_ONLY', rating: 'all', state: 'OH', sort: 'lowest', page: '3' };
  const next = new URL(opportunityInboxHref(query, { page: '4' }), 'https://example.test');
  assert.equal(next.searchParams.get('page'), '4');
  for (const [key, value] of Object.entries(query)) {
    if (key !== 'page') assert.equal(next.searchParams.get(key), value);
  }
  assert.equal(new URL(opportunityInboxHref(query), 'https://example.test').searchParams.get('page'), '3');
  const filtered = new URL(opportunityInboxHref(query, { mode: undefined, rating: 'high' }), 'https://example.test');
  assert.equal(filtered.searchParams.get('page'), null);
  assert.equal(filtered.searchParams.get('mode'), null);
  assert.equal(filtered.searchParams.get('rating'), 'high');
  assert.equal(filtered.searchParams.get('q'), query.q);
});

test('opportunity page input rejects invalid offsets and caps extreme values', () => {
  for (const value of [undefined, '', 'bad', '-5', '0', '2.5', 'Infinity']) assert.equal(opportunityInboxPageNumber(value), 1);
  assert.equal(opportunityInboxPageNumber('2'), 2);
  assert.equal(opportunityInboxPageNumber('20000'), 10000);
  assert.equal(opportunityInboxHref({ page: '1', q: ' ' }), '/opportunities');
});
