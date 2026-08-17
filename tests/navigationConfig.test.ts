import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getMobileNavigationItems,
  getMoreNavigationItems,
  getNavigationItems,
} from '../app/components/navigationConfig';

test('desktop navigation keeps work and account areas intentionally grouped', () => {
  assert.deepEqual(
    getNavigationItems('work').map((item) => item.key),
    ['home', 'worklist', 'opportunities', 'my-week', 'visits'],
  );
  assert.deepEqual(
    getNavigationItems('accounts').map((item) => item.key),
    ['accounts', 'agencies', 'wholesale'],
  );
});

test('mobile navigation stays limited to four primary destinations', () => {
  assert.deepEqual(
    getMobileNavigationItems().map((item) => item.key),
    ['home', 'worklist', 'accounts', 'visits'],
  );
});

test('administration stays out of the standard More menu', () => {
  assert.equal(getMoreNavigationItems(false).some((item) => item.adminOnly), false);
  assert.equal(getMoreNavigationItems(true).some((item) => item.key === 'users'), true);
});
