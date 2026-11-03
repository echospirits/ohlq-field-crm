import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { UserRole } from '@prisma/client';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { requireProductionForecastContext } from '../lib/productionForecasting/access';
import { getMoreNavigationItems, getNavigationItems } from '../app/components/navigationConfig';
import { ForecastTable } from '../app/analytics/production/ForecastTable';
import { summaryFor } from '../lib/productionForecasting/service';
import { forecastProduct } from '../lib/productionForecasting/engine';

const echo = { id: 'org_echo_spirits', displayName: 'Echo Spirits' }, other = { id: 'other', displayName: 'Other distillery' };
const actor = (role: UserRole, organizationId: string | null = 'org_echo_spirits') => ({ id: 'actor', role, organizationId });
function dependencies(currentId: string | null = 'staging', enrolled = [echo]) {
  return {
    tenant: async () => ({ organizationId: 'org_echo_spirits', organization: { id: 'org_echo_spirits', displayName: 'Echo Spirits' } }),
    current: async () => currentId ? { organizationId: currentId } : null,
    organizations: async () => enrolled,
  };
}
test('forecast access requires Echo membership and its active pilot entitlement for every role', async () => {
  for (const role of [UserRole.USER, UserRole.ADMIN, UserRole.PLATFORM_ADMIN]) {
    const result = await requireProductionForecastContext(actor(role), 'org_echo_spirits', dependencies());
    assert.equal(result.organization.id, 'org_echo_spirits'); assert.equal(result.platform, false);
    assert.equal(result.organizations.length, 0);
    await assert.rejects(() => requireProductionForecastContext(actor(role), 'other', dependencies()), /NEXT_HTTP_ERROR_FALLBACK;404|404/);
    await assert.rejects(() => requireProductionForecastContext(actor(role, 'other'), undefined, dependencies()), /404/);
    await assert.rejects(() => requireProductionForecastContext(actor(role), undefined, { tenant: async () => { throw Error('pilot-disabled'); } }), /pilot-disabled/);
  }
});
test('a foreign organization context cannot be returned even by a faulty resolver', async () => {
  await assert.rejects(() => requireProductionForecastContext(actor(UserRole.ADMIN), undefined, { tenant: async () => ({ organizationId: 'other', organization: other }) }), /404/);
});

test('forecast discovery appears in desktop and mobile navigation for platform admins while regular tenant gating remains intact', () => {
  for (const platform of [false, true]) {
    assert.equal(getNavigationItems('work', [], platform).some(i => i.key === 'production-forecasting'), false);
    assert.equal(getMoreNavigationItems(false, [], platform).some(i => i.key === 'production-forecasting'), false);
  }
  assert.equal(getNavigationItems('work', ['PRODUCTION_FORECASTING']).some(i => i.key === 'production-forecasting'), true);
  assert.equal(getMoreNavigationItems(false, ['PRODUCTION_FORECASTING']).some(i => i.key === 'production-forecasting'), true);
});
test('mobile and desktop product links carry selected organization and filters into detail', () => {
  const product = { id: 'p', name: 'Rum', code: 'RUM', market: 'OH' };
  const row = summaryFor(forecastProduct(product, [], [], '2026-10-27'));
  const html = renderToStaticMarkup(createElement(ForecastTable, { rows: [row], initial: { q: 'Rum', confidence: 'Low' }, organizationId: echo.id }));
  const productLinks = html.match(/href="\/analytics\/production\/p\?[^\"]+"/g) ?? [];
  assert.equal(productLinks.length, 2);
  for (const link of productLinks) { assert.match(link, /organization=org_echo_spirits/); assert.match(link, /q=Rum/); assert.match(link, /horizon=30/); }
});

function importAction(user: ReturnType<typeof actor>) {
  const events: string[] = [];
  const source = ts.transpileModule(readFileSync('app/analytics/production/actions.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: { importForecastSource?: (form: FormData) => Promise<unknown> } = {};
  const deps: Record<string, unknown> = {
    'next/cache': { revalidatePath: () => undefined },
    'next/navigation': { notFound: () => { throw Error('404'); } },
    '../../../lib/auth': { requireUserSession: async () => ({ user }) },
    '../../../lib/userAccess': { isAdminRole: (role: UserRole) => role === UserRole.ADMIN || role === UserRole.PLATFORM_ADMIN },
    '../../../lib/productionForecasting/access': { requireProductionForecastContext: async (u: typeof user, id?: string) => { events.push(`authorize:${id}`); return requireProductionForecastContext(u, id, dependencies()); } },
    '../../../lib/productionForecasting/import': { importProductionSource: async (_csv: string, options: { organizationId: string }) => { events.push(`import:${options.organizationId}`); return { rowCount: 1, excludedRows: 0, replay: false }; } },
    '../../../lib/productionForecasting/service': { refreshProductionForecast: async (id: string) => { events.push(`refresh:${id}`); } },
  };
  runInNewContext(source, { exports, File, require: (name: string) => { assert.ok(name in deps, name); return deps[name]; } });
  return { execute: exports.importForecastSource!, events };
}
test('source actions require an explicit platform target, reauthorize it, and import/refresh only that organization', async () => {
  const { execute, events } = importAction(actor(UserRole.ADMIN));
  const form = new FormData(); form.set('file', new File(['test'], 'source.csv')); form.set('organizationId', 'org_echo_spirits');
  assert.deepEqual(JSON.parse(JSON.stringify(await execute(form))), { ok: true, message: 'Imported: 1 rows, 0 excluded. Forecast snapshot is ready.' });
  assert.deepEqual(events, ['authorize:org_echo_spirits', 'import:org_echo_spirits', 'refresh:org_echo_spirits']);
  for (const target of ['', 'unknown']) {
    const attempt = importAction(actor(UserRole.PLATFORM_ADMIN)); form.set('organizationId', target);
    await assert.rejects(() => attempt.execute(form), /404/);
    assert.equal(attempt.events.some(e => e.startsWith('import:')), false);
  }
});
test('forged cross-tenant import targets and non-admin imports stop before side effects', async () => {
  for (const role of [UserRole.USER, UserRole.ADMIN]) {
    const attempt = importAction(actor(role, 'own')), form = new FormData(); form.set('organizationId', 'org_echo_spirits');
    await assert.rejects(() => attempt.execute(form), /404/);
    assert.equal(attempt.events.some(e => /^(import|refresh):/.test(e)), false);
  }
});
