import assert from 'node:assert/strict';
import test from 'node:test';
import { getContextualVisitHref, getDirectionsHref, getSuggestedFollowUpTitle, normalizeCRMActionContext } from '../lib/crmActionContext';

test('contextual visit links preserve wholesale opportunity and product context', () => {
  const href = getContextualVisitHref({
    wholesaleAccountId: 'wholesale-1',
    opportunityId: 'opportunity-1',
    productItemCode: '2804B',
    productName: 'Echo Bourbon',
    sourceType: 'STOCKOUT',
    returnTo: '/opportunities',
  });
  const url = new URL(href, 'https://crm.example');
  assert.equal(url.pathname, '/visits/new');
  assert.equal(url.searchParams.get('type'), 'wholesale');
  assert.equal(url.searchParams.get('wholesaleAccountId'), 'wholesale-1');
  assert.equal(url.searchParams.get('opportunityId'), 'opportunity-1');
  assert.equal(url.searchParams.get('productItemCode'), '2804B');
  assert.equal(url.searchParams.get('returnTo'), '/opportunities');
});

test('context normalization rejects unsafe return targets and trims known values', () => {
  assert.deepEqual(normalizeCRMActionContext({ agencyId: ' agency-1 ', returnTo: '//outside.example' }), {
    agencyId: 'agency-1',
    wholesaleAccountId: undefined,
    opportunityId: undefined,
    agencyProductIntelligenceId: undefined,
    worklistItemId: undefined,
    visitId: undefined,
    productItemCode: undefined,
    productName: undefined,
    sourceType: undefined,
    sourceLabel: undefined,
    accountName: undefined,
    reason: undefined,
    returnTo: undefined,
  });
});

test('follow-up titles and directions use context without requiring re-entry', () => {
  assert.equal(getSuggestedFollowUpTitle({ sourceLabel: 'Echo Bourbon stockout' }), 'Follow up on Echo Bourbon stockout');
  assert.equal(getSuggestedFollowUpTitle({ accountName: 'Grandview Cafe' }), 'Follow up with Grandview Cafe');
  assert.match(getDirectionsHref('123 High St, Columbus, OH') ?? '', /destination=123%20High%20St%2C%20Columbus%2C%20OH/);
});
