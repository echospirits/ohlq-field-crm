import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { UserRole } from '@prisma/client';
import { loadMergeAuth } from './helpers/wholesaleMergeHarness';
import { getAdministrationNavigationGroups, getIntelligenceNavigationItems, getMoreNavigationItems } from '../app/components/navigationConfig';
import { ECHO_ORGANIZATION_ID } from '../lib/echoAccess';
import { getSignedInHomePath } from '../lib/userAccess';
import { NextResponse } from 'next/server';
import { isAdminRole } from '../lib/userAccess';
import { hasEchoAccess } from '../lib/echoAccess';

function settings(role: UserRole | null = UserRole.ADMIN, discoveryFails = false) {
  const events: { operation: string; input: any }[] = [];
  const record = (operation: string, input: any) => { events.push({ operation, input }); };
  const tx = {
    organizationVendorIdentifier: { upsert: async (input: any) => { record('vendor', input); } },
    organizationAuditEvent: { create: async (input: any) => { record('audit', input); } },
  };
  const db = { $transaction: async (work: (value: typeof tx) => Promise<unknown>) => work(tx) };
  const filename = resolve('app/admin/organization/data-actions.ts'), require = createRequire(filename), exports: any = {};
  const mocks: Record<string, unknown> = {
    '../../../lib/auth': loadMergeAuth(role),
    '../../../lib/organizations': {
      requireOrganizationContext: async () => ({ organizationId: ECHO_ORGANIZATION_ID }),
      writeOrganizationAudit: async (...input: any[]) => { record('discovery-audit', input); },
    },
    '../../../lib/prisma': { prisma: db },
    '../../../lib/organizationProductDiscovery': { discoverOrganizationProducts: async (input: any) => {
      record('discover', input); if (discoveryFails) throw Error('private upstream failure'); return { created: 2 };
    } },
    'next/cache': { revalidatePath: () => {} },
    'next/navigation': { redirect: (url: string) => { throw Error(`redirect:${url}`); } },
  };
  runInNewContext(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, require: (name: string) => name in mocks ? mocks[name] : require(name),
  });
  const form = new FormData();
  form.set('vendorId', ' z90399001 '); form.set('label', 'Echo');
  form.set('organizationId', 'outside-company'); form.set('role', 'PLATFORM_ADMIN'); form.set('intelligence', 'on');
  return { actions: exports as { addEchoVendor: (f: FormData) => Promise<void> }, form, events };
}

test('retired platform pages, Support View endpoints and provisioning actions are absent', () => {
  for (const path of ['app/platform/page.tsx','app/platform/organizations/page.tsx','app/platform/organizations/new/page.tsx','app/platform/organizations/[id]/page.tsx','app/platform/organizations/[id]/actions.ts','app/platform/support-view/[id]/route.ts','app/platform/support-view/exit/route.ts','lib/tenantProvisioning.ts','app/analytics/production/ForecastOrganizationScope.tsx']) assert.equal(existsSync(path), false, path);
  assert.ok(existsSync('app/admin/organization/ProductSelectionEditor.tsx'));
  assert.doesNotMatch(readFileSync('app/layout.tsx','utf8'), /Exit Support View|Viewing Neat as/);
  assert.equal(getSignedInHomePath(UserRole.PLATFORM_ADMIN), '/');
});

test('Echo administration retains settings, users and diagnostics without company or package navigation', () => {
  const groups = getAdministrationNavigationGroups(['ADVANCED_INTELLIGENCE']);
  assert.deepEqual(groups.map(g => g.label), ['Echo', 'Data & insights', 'System']);
  const links = groups.flatMap(g => g.items);
  assert.ok(links.some(i => i.label === 'Echo Settings' && i.href === '/admin/organization'));
  assert.ok(links.some(i => i.href === '/users')); assert.ok(links.some(i => i.href === '/admin/environment'));
  assert.ok(links.every(i => !i.href.startsWith('/platform')));
  assert.ok(getMoreNavigationItems(true).some(i => i.label === 'Echo Settings'));
  assert.ok(getIntelligenceNavigationItems(['ADVANCED_INTELLIGENCE'], true, false).some(i => i.key === 'account-research'));
  assert.ok(!getIntelligenceNavigationItems(['ADVANCED_INTELLIGENCE'], false, true).some(i => i.key === 'account-research'));
});

test('Echo Settings retains Vendor IDs and retires the account state control and action', () => {
  const page = readFileSync('app/admin/organization/EchoDataSettings.tsx', 'utf8');
  assert.match(page, /Ohio Vendor IDs/);
  assert.doesNotMatch(page, /Account states|StateAccessPicker/);
  assert.equal('saveEchoStates' in settings().actions, false);
});

test('vendor changes normalize IDs, ignore forged ownership, and retain saved configuration if discovery fails', async () => {
  for (const fails of [false,true]) {
    const f = settings(UserRole.ADMIN, fails);
    await assert.rejects(f.actions.addEchoVendor(f.form), fails ? /vendor-saved-discovery-pending/ : /status=vendor-saved$/);
    const vendor = f.events.find(e => e.operation === 'vendor')!.input;
    assert.equal(vendor.where.organizationId_market_vendorId.organizationId, ECHO_ORGANIZATION_ID);
    assert.equal(vendor.create.vendorId, 'Z90399001');
    assert.equal(f.events.find(e => e.operation === 'discover')!.input.organizationId, ECHO_ORGANIZATION_ID);
    assert.equal(f.events.filter(e => e.operation === 'audit').length, 1);
  }
  const invalid = settings(); invalid.form.set('vendorId','bad/value');
  await assert.rejects(invalid.actions.addEchoVendor(invalid.form), /invalid-vendor/);
  assert.equal(invalid.events.length,0);
});

test('ordinary users, tasters and anonymous callers cannot save settings despite forged role fields', async () => {
  for (const role of [UserRole.USER, UserRole.TASTER, null]) {
    const f=settings(role);
    await assert.rejects(f.actions.addEchoVendor(f.form), /redirect:/);
    assert.equal(f.events.length,0);
  }
});

test('manual OHLQ imports require Echo admin membership and retain the environment side-effect gate', async () => {
  for (const [role, organizationId] of [[UserRole.ADMIN,ECHO_ORGANIZATION_ID],[UserRole.USER,ECHO_ORGANIZATION_ID],[UserRole.TASTER,ECHO_ORGANIZATION_ID],[UserRole.ADMIN,'outside-company'],[null,null]] as const) {
    const exports: any={};
    const mocks: Record<string,unknown>={
      'next/cache': { revalidatePath: () => { throw Error('unexpected mutation'); } },
      'next/server': { NextResponse },
      '../../../../lib/auth': { getCurrentSession: async () => role ? { user:{role,organizationId} } : null },
      '../../../../lib/userAccess': {isAdminRole}, '../../../../lib/echoAccess':{hasEchoAccess},
      '../../../../lib/appEnvironment': {isSideEffectEnabled:()=>false},
      '../../../../lib/ohlqManualImport': {},
    };
    runInNewContext(ts.transpileModule(readFileSync('app/api/admin/ohlq-manual-import/route.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,URL,URLSearchParams,require:(name:string)=>{assert.ok(name in mocks,name);return mocks[name];}});
    const response=await exports.POST({url:'https://neat-tst.vercel.app/api/admin/ohlq-manual-import',formData:()=>{throw Error('must stop before parsing or external work');}});
    const target=new URL(response.headers.get('location'));
    if(role===UserRole.ADMIN&&organizationId===ECHO_ORGANIZATION_ID) assert.match(target.searchParams.get('message')!,/imports are disabled/);
    else assert.equal(target.pathname,role?'/':'/login');
  }
});
