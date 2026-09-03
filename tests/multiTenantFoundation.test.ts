import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CORE_PACKAGE_FEATURE_KEYS, DEFAULT_FEATURE_KEYS, ECHO_FEATURE_KEYS, FEATURE_KEYS, FEATURE_REGISTRY, getPackageFeatureKeys, hasIntelligencePackage, INTELLIGENCE_PACKAGE_FEATURE_KEYS, validateFeatureSelection } from '../lib/featureRegistry';
import { getNavigationItems, navigationItems } from '../app/components/navigationConfig';
import { normalizeOrganizationIdentifierList } from '../lib/organizationConfiguration';

test('feature registry has stable unique keys and explicit dependency metadata', () => {
  assert.equal(new Set(FEATURE_KEYS).size, FEATURE_KEYS.length);
  assert.equal(Object.keys(FEATURE_REGISTRY).length, FEATURE_KEYS.length);
  assert.equal(DEFAULT_FEATURE_KEYS.includes('WHOLESALE_OPPORTUNITIES'), false);
  assert.equal(ECHO_FEATURE_KEYS.includes('WHOLESALE_OPPORTUNITIES'), true);
  assert.deepEqual(FEATURE_REGISTRY.WHOLESALE_OPPORTUNITIES.dependencies, ['WHOLESALE_ACCOUNTS', 'OHLQ_SALES_DATA']);
});

test('feature packages keep Core mandatory and group every intelligence capability', () => {
  assert.deepEqual(DEFAULT_FEATURE_KEYS, CORE_PACKAGE_FEATURE_KEYS);
  assert.deepEqual(INTELLIGENCE_PACKAGE_FEATURE_KEYS, ['AGENCY_INTELLIGENCE', 'WHOLESALE_OPPORTUNITIES', 'ADVANCED_INTELLIGENCE']);
  assert.deepEqual(getPackageFeatureKeys(false), CORE_PACKAGE_FEATURE_KEYS);
  assert.deepEqual(getPackageFeatureKeys(true), FEATURE_KEYS);
  assert.equal(hasIntelligencePackage(['AGENCY_INTELLIGENCE']), true);
  assert.equal(hasIntelligencePackage(CORE_PACKAGE_FEATURE_KEYS), false);
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
  assert.equal(navigationItems.find((item) => item.href === '/admin/opportunity-performance')?.featureKey, 'WHOLESALE_OPPORTUNITIES');
  assert.equal(navigationItems.find((item) => item.href === '/admin/account-research')?.featureKey, 'ADVANCED_INTELLIGENCE');
  const page = readFileSync('app/opportunities/page.tsx', 'utf8');
  const actions = readFileSync('app/opportunities/actions.ts', 'utf8');
  assert.match(page, /requireFeatureForUser\(currentUser, 'WHOLESALE_OPPORTUNITIES'\)/);
  assert.match(actions, /requireFeatureForUser\(user, 'WHOLESALE_OPPORTUNITIES'\)/);
});

test('organization setup access separates tenant configuration from platform data controls', () => {
  const tenantAdminItems = getNavigationItems('admin', [], false);
  assert.equal(tenantAdminItems.some((item) => item.href === '/admin/organization'), true);
  assert.equal(tenantAdminItems.some((item) => item.href === '/admin/data-status'), false);
  assert.equal(tenantAdminItems.some((item) => item.href === '/admin/opportunity-performance'), false);
  assert.equal(getNavigationItems('admin', ['WHOLESALE_OPPORTUNITIES'], false).some((item) => item.href === '/admin/opportunity-performance'), true);
  assert.equal(getNavigationItems('admin', [], true).some((item) => item.href === '/admin/data-status'), true);

  const organizationPage = readFileSync('app/admin/organization/page.tsx', 'utf8');
  assert.match(organizationPage, /requireOrganizationContext/);
  assert.match(organizationPage, /A3A Store IDs/);
  assert.match(organizationPage, /ProductSelectionEditor/);
  assert.doesNotMatch(organizationPage, /name="vendorId"/);
});

test('A3A store IDs are normalized and stored as organization-owned records', () => {
  assert.deepEqual(normalizeOrganizationIdentifierList(' 10509, a-12\n10509; B7 '), ['10509', 'A-12', 'B7']);
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  assert.match(schema, /model OrganizationA3aStoreIdentifier/);
  assert.match(schema, /@@unique\(\[organizationId, market, storeId\]\)/);
});

test('manual shared OHLQ data loads require Platform Admin', () => {
  const dataStatus = readFileSync('app/admin/data-status/page.tsx', 'utf8');
  const manualImport = readFileSync('app/api/admin/ohlq-manual-import/route.ts', 'utf8');
  assert.match(dataStatus, /requirePlatformAdminSession/);
  assert.doesNotMatch(dataStatus, /requireAdminSession/);
  assert.match(manualImport, /session\.user\.role !== UserRole\.PLATFORM_ADMIN/);
});

test('intelligence sections are omitted from core-only dashboards and account pages', () => {
  for (const path of ['app/page.tsx', 'app/accounts/page.tsx', 'app/agencies/[id]/page.tsx', 'app/wholesale/page.tsx', 'app/wholesale/[id]/page.tsx']) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /getOrganizationFeatures/);
    assert.match(source, /WHOLESALE_OPPORTUNITIES/);
  }
  assert.match(readFileSync('app/page.tsx', 'utf8'), /AGENCY_INTELLIGENCE/);
  assert.match(readFileSync('app/alerts/page.tsx', 'utf8'), /excludedIntelligenceSources/);
  assert.match(readFileSync('app/my-week/page.tsx', 'utf8'), /excludedIntelligenceSources/);
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
