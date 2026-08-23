import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APP_COMPANY,
  APP_DESCRIPTION,
  APP_NAME,
  buildPageMetadata,
  buildPageTitle,
} from '../lib/appBrand';

test('Neat brand constants and page titles stay centralized', () => {
  assert.equal(APP_NAME, 'Neat');
  assert.equal(APP_COMPANY, 'Echo Spirits');
  assert.match(APP_DESCRIPTION, /field CRM for Echo Spirits/);
  assert.equal(buildPageTitle(), 'Neat');
  assert.equal(buildPageTitle('Worklist'), 'Worklist | Neat');
  assert.deepEqual(buildPageMetadata('Dashboard').title, { absolute: 'Dashboard | Neat' });
});
