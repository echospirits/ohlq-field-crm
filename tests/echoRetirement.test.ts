import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { Prisma, UserRole } from '@prisma/client';
import { getAdministrationNavigationGroups, getMoreNavigationItems, navigationItems } from '../app/components/navigationConfig';
import { getUserActivityReport } from '../lib/userActivityReport';

const ECHO = 'org_echo_spirits';
const source = (path: string) => readFileSync(path, 'utf8');

test('retired Support and Recipe routes, actions, consumers and importers cannot be reached', () => {
  for (const path of [
    'app/support/page.tsx', 'app/support/new/page.tsx', 'app/support/[id]/page.tsx',
    'app/api/support/route.ts', 'app/api/support/[id]/route.ts', 'app/api/support/[id]/screenshot/route.ts', 'app/api/support/updates/route.ts',
    'app/components/SupportUpdates.tsx', 'app/components/SupportTrailTracker.tsx', 'lib/support.ts', 'lib/supportHttp.ts', 'lib/supportShared.ts',
    'app/recipes/page.tsx', 'app/recipes/[id]/page.tsx', 'app/recipes/actions.ts', 'app/shared/recipes/[token]/page.tsx',
    'app/components/AccountRecipes.tsx', 'lib/crm/recipes.ts', 'lib/crm/recipeCosting.ts', 'scripts/import-recipes.ts',
  ]) assert.equal(existsSync(path), false, path);
});

test('all navigation variants omit Support and Recipes while retaining Echo administration', () => {
  for (const admin of [false, true]) for (const legacyPlatformFlag of [false, true]) {
    const items = [...navigationItems, ...getMoreNavigationItems(admin, undefined, legacyPlatformFlag),
      ...getAdministrationNavigationGroups(undefined, legacyPlatformFlag, admin).flatMap(group => group.items)];
    assert.ok(items.every(item => !/^\/(support|recipes|shared\/recipes)(\/|$)/.test(item.href)));
    if (admin) assert.ok(items.some(item => item.href === '/admin/organization'));
  }
  assert.deepEqual(getAdministrationNavigationGroups(undefined, true, false), []);
});

test('the application stops Support polling/tracking and account recipe controls', () => {
  assert.doesNotMatch(source('app/layout.tsx'), /SupportUpdates|SupportTrailTracker|\/support|support\.css/);
  assert.doesNotMatch(source('app/components/AppNavigation.tsx'), /\/support|\/recipes/);
  assert.doesNotMatch(source('app/wholesale/[id]/page.tsx'), /AccountRecipes|\/recipes/);
  assert.doesNotMatch(source('lib/blob.ts'), /uploadRecipePhoto|recipe-photos/);
});

test('unsafe former setup commands and unused platform/bootstrap helpers are retired', () => {
  const scripts = JSON.parse(source('package.json')).scripts;
  for (const name of ['seed:admin', 'seed:staging', 'enable:staging-features', 'bootstrap:multitenancy', 'import:recipes', 'import:sample']) assert.equal(scripts[name], undefined);
  for (const path of ['scripts/seed-admin.ts', 'scripts/seed-staging.ts', 'scripts/enable-all-staging-features.ts', 'scripts/bootstrap-multitenancy.ts', 'scripts/import-sample-data.ts']) assert.equal(existsSync(path), false);
  assert.doesNotMatch(source('lib/auth.ts'), /requirePlatformAdmin/);
  assert.doesNotMatch(source('lib/organizations.ts'), /ensureEchoOrganization|organization\.upsert|organizationFeature\.createMany/);
});

test('retirement retains stored Support/Recipe models and legacy merge ownership handling', () => {
  const schema = source('prisma/schema.prisma');
  for (const model of ['SupportTicket', 'SupportMessage', 'SupportScreenshot', 'Recipe', 'RecipeSuggestion', 'RecipeShare']) assert.match(schema, new RegExp(`model ${model} \\{`));
  assert.match(source('lib/wholesaleAccountMerge.ts'), /recipeSuggestion\.updateMany/);
});

function activityPage(authorized = true) {
  let reads = 0, contexts = 0;
  const compiled = ts.transpileModule(source('app/admin/user-activity/page.tsx'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const dependencies: Record<string, unknown> = {
    '../admin-workspace.css': {},
    'react/jsx-runtime': require('react/jsx-runtime'), 'next/link': { default: 'a' },
    '../../../lib/auth': { requireEchoAdmin: async () => { if (!authorized) throw Error('denied'); return { id: 'admin', organizationId: ECHO, role: UserRole.ADMIN }; } },
    '../../../lib/organizations': { requireOrganizationContext: async () => { contexts++; return { organizationId: ECHO }; } },
    '../../../lib/prisma': { prisma: {} }, '../../../lib/appBrand': { buildPageMetadata: () => ({}) },
    '../../../lib/userActivityReport': { getUserActivityReport: async (_db: unknown, user: any) => {
      reads++; assert.equal(user.organizationId, ECHO);
      return { filters: { from: new Date('2026-10-01'), to: new Date('2026-10-28'), q: '', activity: 'all', sort: 'newest', organizationId: ECHO }, rows: [], summaries: [], total: 0, page: 1, pages: 1 };
    } },
    '../../components/PageChrome': {
      PageHeader: ({ title, description, meta }: any) => createElement('header', null, createElement('h1', null, title), meta ? createElement('div', null, meta) : null, createElement('p', null, description)),
      SectionHeading: ({ title }: any) => createElement('h2', null, title), EmptyState: ({ title }: any) => createElement('p', null, title),
    },
    '../../components/LiveFilterForm': { LiveFilterForm: ({ children, ...props }: any) => createElement('form', props, children) },
  };
  const exports: Record<string, any> = {};
  runInNewContext(compiled, { exports, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, URLSearchParams });
  return { page: exports.default, reads: () => reads, contexts: () => contexts };
}

test('the actual activity page requires Echo admin context and offers no company switching', async () => {
  const f = activityPage();
  const html = renderToStaticMarkup(await f.page({ searchParams: Promise.resolve({ organization: 'outside' }) }));
  assert.equal(f.contexts(), 1); assert.equal(f.reads(), 1);
  assert.match(html, /Echo Spirits users/); assert.match(html, /No recorded activity matches/);
  assert.doesNotMatch(html, /Show all organizations|Platform administration|name="organization"|Support View/);
});

test('unauthorized activity pages stop before data reads', async () => {
  const f = activityPage(false);
  await assert.rejects(f.page({ searchParams: Promise.resolve({}) }), /denied/);
  assert.equal(f.reads(), 0); assert.equal(f.contexts(), 0);
});

test('legacy Echo platform roles get only Echo SQL and foreign roles stop before any report query', async () => {
  const queries: Prisma.Sql[] = [];
  const db: any = { $queryRaw: async (query: Prisma.Sql) => { queries.push(query); return []; } };
  const report = await getUserActivityReport(db, { role: UserRole.PLATFORM_ADMIN, organizationId: ECHO }, { organization: 'outside' });
  assert.equal(report.filters.organizationId, ECHO); assert.equal(queries.length, 4);
  for (const query of queries) { assert.ok(query.values.includes(ECHO)); assert.ok(!query.values.includes('outside')); }
  queries.length = 0;
  await assert.rejects(getUserActivityReport(db, { role: UserRole.PLATFORM_ADMIN, organizationId: 'outside' }, { organization: ECHO }), /Echo admin/);
  assert.equal(queries.length, 0);
});
