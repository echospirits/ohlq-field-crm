import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAdministrationNavigationGroups,
  getIntelligenceNavigationItems,
  getMobileNavigationItems,
  getMoreNavigationItems,
  getNavigationItems,
} from '../app/components/navigationConfig';

test('desktop navigation keeps work and account areas intentionally grouped', () => {
  assert.deepEqual(
    getNavigationItems('work').map((item) => item.key),
    ['home', 'worklist', 'visits', 'analytics'],
  );
  assert.deepEqual(
    getNavigationItems('work').find((item) => item.key === 'home'),
    { key: 'home', href: '/', label: 'My Schedule', mobileLabel: 'Schedule', section: 'work', mobileOrder: 1 },
  );
  assert.deepEqual(
    getNavigationItems('accounts').map((item) => item.key),
    ['accounts', 'agencies', 'wholesale', 'wholesale-orders', 'pipeline'],
  );
  assert.deepEqual(getNavigationItems('production').map(item => [item.label, item.href]), [
    ['Supplies', '/production-supplies'],
    ['Forecasting', '/analytics/production'],
  ]);
});

test('pipeline navigation is feature gated', () => {
  assert.equal(getNavigationItems('accounts', []).some((item) => item.key === 'pipeline'), false);
  assert.equal(getNavigationItems('accounts', ['ACCOUNT_SALES_STATUS']).some((item) => item.key === 'pipeline'), true);
});

test('Production Supplies requires its own entitlement in desktop and mobile More navigation', () => {
  assert.equal(getNavigationItems('production', []).some(item => item.key === 'production-supplies'), false);
  assert.equal(getMoreNavigationItems(false, ['PRODUCTION_FORECASTING']).some(item => item.key === 'production-supplies'), false);
  assert.deepEqual(getNavigationItems('production', ['PRODUCTION_SUPPLIES']).map(item => item.href), ['/production-supplies']);
  assert.equal(getMoreNavigationItems(false, ['PRODUCTION_SUPPLIES']).some(item => item.href === '/production-supplies'), true);
});

test('wholesale orders navigation is feature gated', () => {
  assert.equal(getNavigationItems('accounts', []).some((item) => item.key === 'wholesale-orders'), false);
  assert.equal(getNavigationItems('accounts', ['OHIO_DIRECT_WHOLESALE_ORDERS']).some((item) => item.key === 'wholesale-orders'), true);
});

test('mobile navigation stays limited to four primary destinations', () => {
  const items = getMobileNavigationItems();
  assert.deepEqual(
    items.map((item) => item.key),
    ['home', 'worklist', 'accounts', 'visits'],
  );
  assert.equal(items.find((item) => item.key === 'accounts')?.href, '/search');
});

test('administration stays out of the standard More menu', () => {
  assert.equal(getMoreNavigationItems(false).some((item) => item.adminOnly), false);
  assert.equal(getMoreNavigationItems(true).some((item) => item.key === 'users'), true);
});

test('desktop administration consolidates organization, data, and platform destinations', () => {
  const groups = getAdministrationNavigationGroups(['WHOLESALE_OPPORTUNITIES', 'ADVANCED_INTELLIGENCE'], true);
  assert.deepEqual(groups.map((group) => group.label), ['Echo', 'Data & insights', 'System']);
  assert.deepEqual(groups[0].items.map((item) => item.key), ['users', 'user-activity', 'organization-setup', 'weekly-digest']);
  assert.deepEqual(groups[1].items.map((item) => item.key), ['data-health']);
  assert.deepEqual(groups[2].items.map((item) => item.key), ['environment']);
});

test('Intelligence is feature gated and separates rep and administrative tools', () => {
  const features = ['AGENCY_INTELLIGENCE', 'WHOLESALE_OPPORTUNITIES', 'ADVANCED_INTELLIGENCE'];
  assert.deepEqual(getIntelligenceNavigationItems([], true, true), []);
  assert.deepEqual(getIntelligenceNavigationItems(features, false, false).map((item) => [item.href, item.label]), [
    ['/opportunities', 'Restaurant Opportunities'], ['/agency-focus', 'Retail Intelligence'],
  ]);
  assert.deepEqual(getIntelligenceNavigationItems(features, false, true).map((item) => item.key), [
    'opportunities', 'agency-intelligence',
  ]);
  assert.deepEqual(getIntelligenceNavigationItems(features, true, false).map((item) => item.key), [
    'opportunities', 'agency-intelligence', 'account-research', 'opportunity-performance',
  ]);
  assert.deepEqual(getIntelligenceNavigationItems(['AGENCY_INTELLIGENCE'], false, false).map((item) => item.key), ['agency-intelligence']);
  assert.equal(getMoreNavigationItems(true, features, true).some((item) => item.section === 'intelligence'), false);
  assert.equal(getAdministrationNavigationGroups(features, true).flatMap((group) => group.items).some((item) => item.section === 'intelligence'), false);
});

test('organization admins do not see platform administration', () => {
  const groups = getAdministrationNavigationGroups([], false);
  assert.equal(groups.flatMap((group) => group.items).some((item) => item.key === 'platform-administration'), false);
});

test('a legacy platform flag cannot grant administration without Echo admin context', () => {
  assert.ok(!getMoreNavigationItems(false, [], true).some((item) => item.key === 'user-activity'));
  const groups = getAdministrationNavigationGroups([], true, false);
  assert.deepEqual(groups, []);
});
