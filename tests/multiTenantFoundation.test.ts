import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DEFAULT_FEATURE_KEYS, ECHO_FEATURE_KEYS, FEATURE_KEYS, FEATURE_REGISTRY, validateFeatureSelection } from '../lib/featureRegistry';
import { navigationItems } from '../app/components/navigationConfig';

test('feature registry has stable unique keys and explicit dependency metadata', () => {
  assert.equal(new Set(FEATURE_KEYS).size, FEATURE_KEYS.length);
  assert.equal(Object.keys(FEATURE_REGISTRY).length, FEATURE_KEYS.length);
  assert.equal(DEFAULT_FEATURE_KEYS.includes('WHOLESALE_OPPORTUNITIES'), false);
  assert.equal(ECHO_FEATURE_KEYS.includes('WHOLESALE_OPPORTUNITIES'), true);
  assert.deepEqual(FEATURE_REGISTRY.WHOLESALE_OPPORTUNITIES.dependencies, ['WHOLESALE_ACCOUNTS', 'OHLQ_SALES_DATA']);
});

test('invalid entitlement combinations report every missing dependency', () => {
  const result = validateFeatureSelection(['WHOLESALE_OPPORTUNITIES']);
  assert.deepEqual(result.missing, [
    { feature: 'WHOLESALE_OPPORTUNITIES', dependency: 'WHOLESALE_ACCOUNTS' },
    { feature: 'WHOLESALE_OPPORTUNITIES', dependency: 'OHLQ_SALES_DATA' },
  ]);
});

test('Wholesale Opportunities uses one entitlement in navigation and server access', () => {
  assert.equal(navigationItems.find((item) => item.href === '/opportunities')?.featureKey, 'WHOLESALE_OPPORTUNITIES');
  const page = readFileSync('app/opportunities/page.tsx', 'utf8');
  const actions = readFileSync('app/opportunities/actions.ts', 'utf8');
  assert.match(page, /requireFeatureForUser\(currentUser, 'WHOLESALE_OPPORTUNITIES'\)/);
  assert.match(actions, /requireFeatureForUser\(user, 'WHOLESALE_OPPORTUNITIES'\)/);
});

test('private visit and worklist entry points include organization scoping', () => {
  for (const path of ['app/visits/page.tsx', 'app/visits/[id]/edit/page.tsx', 'app/alerts/page.tsx']) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /requireOrganizationContext/);
    assert.match(source, /organizationId/);
  }
});

test('platform support view is explicit, short-lived, and audited', () => {
  const enter = readFileSync('app/platform/support-view/[id]/route.ts', 'utf8');
  const layout = readFileSync('app/layout.tsx', 'utf8');
  assert.match(enter, /requirePlatformAdmin/);
  assert.match(enter, /SUPPORT_VIEW_STARTED/);
  assert.match(enter, /maxAge: 60 \* 60 \* 8/);
  assert.match(layout, /Viewing Neat as/);
  assert.match(layout, /Exit Support View/);
});
