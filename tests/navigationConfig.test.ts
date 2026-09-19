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
    ['home', 'worklist', 'my-week', 'visits', 'analytics'],
  );
  assert.deepEqual(
    getNavigationItems('accounts').map((item) => item.key),
    ['accounts', 'agencies', 'wholesale', 'wholesale-orders'],
  );
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
  assert.deepEqual(groups.map((group) => group.label), ['Organization', 'Data & insights', 'Platform']);
  assert.deepEqual(groups[0].items.map((item) => item.key), ['users', 'organization-setup', 'weekly-digest']);
  assert.deepEqual(groups[1].items.map((item) => item.key), ['data-health']);
  assert.deepEqual(groups[2].items.map((item) => item.key), ['environment', 'platform-administration']);
});

test('Intelligence is feature gated and separates rep and administrative tools', () => {
  const features = ['AGENCY_INTELLIGENCE', 'WHOLESALE_OPPORTUNITIES', 'ADVANCED_INTELLIGENCE'];
  assert.deepEqual(getIntelligenceNavigationItems([], true, true), []);
  assert.deepEqual(getIntelligenceNavigationItems(features, false, false).map((item) => [item.href, item.label]), [
    ['/opportunities', 'Wholesale Opportunities'], ['/agency-focus', 'Agency Intelligence'],
  ]);
  assert.deepEqual(getIntelligenceNavigationItems(features, false, true).map((item) => item.key), [
    'opportunities', 'agency-intelligence', 'account-research', 'opportunity-performance',
  ]);
  assert.deepEqual(getIntelligenceNavigationItems(features, true, false).map((item) => item.key), [
    'opportunities', 'agency-intelligence', 'opportunity-performance',
  ]);
  assert.deepEqual(getIntelligenceNavigationItems(['AGENCY_INTELLIGENCE'], false, false).map((item) => item.key), ['agency-intelligence']);
  assert.equal(getMoreNavigationItems(true, features, true).some((item) => item.section === 'intelligence'), false);
  assert.equal(getAdministrationNavigationGroups(features, true).flatMap((group) => group.items).some((item) => item.section === 'intelligence'), false);
});

test('organization admins do not see platform administration', () => {
  const groups = getAdministrationNavigationGroups([], false);
  assert.equal(groups.flatMap((group) => group.items).some((item) => item.key === 'platform-administration'), false);
});

test('platform admins outside a support view retain global administration access', () => {
  const groups = getAdministrationNavigationGroups([], true, false);
  assert.deepEqual(groups.flatMap((group) => group.items).map((item) => item.key), [
    'data-health',
    'environment',
    'platform-administration',
  ]);
});
