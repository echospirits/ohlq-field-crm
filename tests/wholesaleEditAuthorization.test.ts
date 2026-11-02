import assert from 'node:assert/strict';
import { isAdminRole } from '../lib/userAccess';
import { hasEchoAccess } from '../lib/echoAccess';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { SalesAccountType, UserRole } from '@prisma/client';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { z } from 'zod';
import { isTasterRole } from '../lib/userAccess';
import { normalizeUsState, stateScopedLicenseeIds } from '../lib/usStates';
import * as wholesaleAccounts from '../lib/wholesaleAccounts';
import { getWholesaleAddressProtectionForEdit } from '../lib/wholesaleAddressProtection';
import { WholesaleAccountEditFields, type WholesaleAccountEditValues } from '../app/components/WholesaleAccountEditFields';

const editSource = readFileSync('app/wholesale/[id]/edit/page.tsx', 'utf8');
const actionSource = readFileSync('app/wholesale/[id]/edit/actions.ts', 'utf8');
const authSource = readFileSync('lib/auth.ts', 'utf8');

function functionSource(source: string, names: string[]) {
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return names.map(name => {
    const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration, `Missing function ${name}`);
    return declaration.getText(ast).replace(/^export default /, '').replace(/^export /, '');
  }).join('\n');
}

function loadEdit(role: UserRole | null, accountOverrides: Record<string, unknown> = {}, official: object | null = null, options: { missing?: boolean; conflictId?: string; organizationId?: string } = {}) {
  const effects: string[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const account = {
    id: 'shared-account', licenseeId: '12345', licenseeIds: [{ licenseeId: '12345' }],
    name: 'Original name', state: 'OH', mergedIntoId: null, officialAccountId: null,
    address: '1 Main St', city: 'Columbus', county: 'Franklin', zip: '43215',
    agencyId: '10', districtId: '2', deliveryDay: 'Monday', ownership: null, phone: null,
    ...accountOverrides,
  };
  const context: Record<string, unknown> = {
    ...wholesaleAccounts, UserRole, isTasterRole, isAdminRole, hasEchoAccess, normalizeUsState, stateScopedLicenseeIds, z,
    getWholesaleAddressProtectionForEdit,
    getCurrentSession: async () => role ? { user: { id: 'caller', role, organizationId: options.organizationId ?? 'org_echo_spirits' } } : null,
    toOptional: (value: unknown) => String(value ?? '').trim() || null,
    findOfficialWholesaleAccountByLicenseeIds: async () => { effects.push('official-lookup'); return official; },
    getGeocodeResetForAddressChange: () => ({ geocodeStatus: 'PENDING' }),
    syncWholesaleAccountLicenseeIds: async () => { effects.push('licensee-sync'); },
    prisma: {
      wholesaleAccount: {
        findUnique: async ({ select }: { select?: Record<string, unknown> }) => {
          effects.push('account-read');
          if (options.missing) return null;
          return select ? Object.fromEntries(Object.keys(select).map(key => [key, account[key as keyof typeof account]])) : account;
        },
        findFirst: async () => { effects.push('conflict-read'); return options.conflictId ? { id: options.conflictId } : null; },
      },
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
        effects.push('transaction');
        return callback({ wholesaleAccount: { update: async ({ data }: { data: Record<string, unknown> }) => {
          effects.push('account-update'); updates.push(data);
        } } });
      },
      wholesaleAccountAssessment: { updateMany: async () => { effects.push('assessment-request'); } },
    },
    after: (callback: () => Promise<void>) => { effects.push('after'); return callback(); },
    refreshTenantOpportunityScoresForAccounts: async () => { effects.push('score-refresh'); },
    revalidatePath: (path: string) => { effects.push('revalidate', `revalidate:${path}`); },
    redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
    notFound: () => { throw new Error('NOT_FOUND'); },
  };
  const code = [
    functionSource(authSource, ['requireUserSession', 'requireUser', 'requireEchoAdminSession', 'requireEchoAdmin']),
    functionSource(actionSource, ['saveWholesaleAccount', 'updateWholesaleAccount']),
    functionSource(editSource, ['EditWholesaleAccountPage']),
    'globalThis.action = updateWholesaleAccount; globalThis.save = saveWholesaleAccount; globalThis.page = EditWholesaleAccountPage;',
  ].join('\n');
  runInNewContext(ts.transpileModule(code, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
  } }).outputText, context);
  return {
    action: context.action as (data: FormData) => Promise<unknown>,
    save: context.save as (data: FormData) => Promise<{ success?: string; error?: string; refresh?: boolean }>,
    page: context.page as (props: { params: Promise<{ id: string }> }) => Promise<unknown>,
    effects, updates,
  };
}

function submittedData() {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    id: 'shared-account', name: 'Changed canonical name', licenseeIds: '12345', state: 'OH',
    address: '2 Main St', city: 'Columbus', county: 'Franklin', zip: '43215', agencyId: '10', districtId: '2',
  })) data.set(name, value);
  return data;
}

for (const role of [null, UserRole.USER, UserRole.TASTER]) {
  test(`inline wholesale save rejects ${role ?? 'anonymous'} before all reads and side effects`, async () => {
    const { save, effects, updates } = loadEdit(role);
    await assert.rejects(save(submittedData()), /REDIRECT:/);
    assert.deepEqual(effects, []);
    assert.deepEqual(updates, []);
  });

  test(`wholesale edit direct submission rejects ${role ?? 'anonymous'} before all reads and side effects`, async () => {
    const { action, effects, updates } = loadEdit(role);
    const destination = role === null ? '/login' : role === UserRole.TASTER ? '/visits/new' : '/';
    await assert.rejects(action(submittedData()), error => error instanceof Error && error.message === `REDIRECT:${destination}`);
    assert.deepEqual(effects, []);
    assert.deepEqual(updates, []);
  });

  test(`wholesale edit page rejects ${role ?? 'anonymous'} before reading the shared account`, async () => {
    const { page, effects } = loadEdit(role);
    await assert.rejects(page({ params: Promise.resolve({ id: 'shared-account' }) }), /REDIRECT:/);
    assert.deepEqual(effects, []);
  });
}

test('inline save rejects an admin outside Echo before reading or changing shared accounts', async () => {
  const { save, effects } = loadEdit(UserRole.ADMIN, {}, null, { organizationId: 'other-tenant' });
  await assert.rejects(save(submittedData()), /REDIRECT:\//);
  assert.deepEqual(effects, []);
});

test('inline save returns success without navigation and revalidates the research queue', async () => {
  const { save, effects, updates } = loadEdit(UserRole.PLATFORM_ADMIN);
  const result = await save(submittedData());
  assert.equal(result.success, 'Changed canonical name saved.');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].addressImportProtected, true);
  for (const effect of ['licensee-sync', 'assessment-request', 'score-refresh', 'revalidate:/admin/account-research', 'revalidate:/wholesale/shared-account']) {
    assert.ok(effects.includes(effect), `Missing ${effect}`);
  }
});

test('inline validation returns recoverable errors before any reads or mutations', async () => {
  for (const field of ['id', 'name', 'licenseeIds']) {
    const { save, effects } = loadEdit(UserRole.PLATFORM_ADMIN);
    const data = submittedData(); data.set(field, '');
    assert.ok((await save(data)).error);
    assert.deepEqual(effects, []);
  }
  const { save, effects } = loadEdit(UserRole.PLATFORM_ADMIN);
  const data = submittedData(); data.set('address', new Blob(['invalid']), 'not-an-address.txt');
  assert.ok((await save(data)).error);
  assert.deepEqual(effects, []);
});

test('missing and merged inline accounts return recoverable errors without mutation', async () => {
  const missing = loadEdit(UserRole.PLATFORM_ADMIN, {}, null, { missing: true });
  assert.match((await missing.save(submittedData())).error ?? '', /no longer available/);
  assert.deepEqual(missing.effects, ['account-read']);
  const merged = loadEdit(UserRole.PLATFORM_ADMIN, { mergedIntoId: 'merged-destination' });
  const result = await merged.save(submittedData());
  assert.match(result.error ?? '', /merged/);
  assert.equal(result.refresh, true);
  assert.deepEqual(merged.effects, ['account-read']);
});

test('inline duplicate licensee and official-account errors retain the form without mutation', async () => {
  const duplicate = loadEdit(UserRole.PLATFORM_ADMIN, {}, null, { conflictId: 'other-account' });
  assert.match((await duplicate.save(submittedData())).error ?? '', /already uses/);
  assert.equal(duplicate.updates.length, 0);
  assert.ok(!duplicate.effects.includes('assessment-request'));
  const official = loadEdit(UserRole.PLATFORM_ADMIN, { officialAccountId: 'official' }, {
    id: 'official', licenseeId: '12345', officialWholesale: { id: 'other-account' },
  });
  assert.match((await official.save(submittedData())).error ?? '', /already linked/);
  assert.equal(official.updates.length, 0);
  assert.ok(!official.effects.includes('assessment-request'));
});

test('multiple inline forms keep distinct help IDs and preserve all canonical account values', () => {
  const account: WholesaleAccountEditValues = {
    id: 'account-one', name: 'Account one', licenseeIds: ['12345', '67890'],
    address: '1 Main St', city: 'Columbus', state: 'OH', zip: '43215', county: 'Franklin',
    agencyId: '10', districtId: '2', deliveryDay: 'Monday', ownership: 'Owner', phone: '614-555-0100',
  };
  const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(WholesaleAccountEditFields, { account, compact: true }),
    React.createElement(WholesaleAccountEditFields, { account: { ...account, id: 'account-two' }, compact: true }),
  ));
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, describedBy] of html.matchAll(/aria-describedby="([^"]+)"/g)) assert.ok(ids.includes(describedBy));
  assert.ok(html.indexOf('name="name"') < html.indexOf('name="address"'));
  assert.ok(html.indexOf('name="zip"') < html.indexOf('<summary>More account details</summary>'));
  for (const field of ['id', 'name', 'licenseeIds', 'address', 'city', 'state', 'zip', 'county', 'agencyId', 'districtId', 'deliveryDay', 'ownership', 'phone']) {
    assert.equal(html.split(`name="${field}"`).length - 1, 2, field);
  }
  assert.match(html, /12345\n67890/);
  assert.match(html, /value="Monday"/);
  assert.match(html, /value="Owner"/);
});

test('platform admin can update the shared account and retain licensee and assessment side effects', async () => {
  const { action, effects, updates } = loadEdit(UserRole.ADMIN);
  await assert.rejects(action(submittedData()), /REDIRECT:\/wholesale\/shared-account\?status=updated/);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].name, 'Changed canonical name');
  assert.equal(updates[0].address, '2 Main St');
  assert.equal(updates[0].licenseeId, '12345');
  assert.equal(updates[0].geocodeStatus, 'PENDING');
  for (const effect of ['transaction', 'licensee-sync', 'assessment-request', 'after', 'score-refresh', 'revalidate']) {
    assert.ok(effects.includes(effect), `Missing ${effect}`);
  }
});

test('platform admin validation errors still prevent mutation and assessment refresh', async () => {
  const { action, effects } = loadEdit(UserRole.PLATFORM_ADMIN);
  const data = submittedData(); data.set('state', 'invalid');
  assert.match(String((await action(data) as { error: string }).error), /valid US state/);
  assert.deepEqual(effects, []);
});

test('the actual edit action protects only corrected address fields and preserves existing protection', async () => {
  for (const field of ['address', 'city', 'zip'] as const) {
    const { action, updates } = loadEdit(UserRole.PLATFORM_ADMIN);
    const data = submittedData(); data.set('address', '1 Main St'); data.set(field, 'Public correction');
    await assert.rejects(action(data), /REDIRECT:/);
    assert.equal(updates[0][`${field}ImportProtected`], true);
    for (const other of ['address', 'city', 'zip'] as const) if (other !== field) assert.equal(updates[0][`${other}ImportProtected`], undefined);
  }
  const { action, updates } = loadEdit(UserRole.PLATFORM_ADMIN, { addressImportProtected: true });
  const data = submittedData(); data.set('address', '1 Main St');
  await assert.rejects(action(data), /REDIRECT:/);
  assert.equal(updates[0].addressImportProtected, true);
});

test('official relinking does not refill a deliberately cleared public address', async () => {
  const { action, updates } = loadEdit(UserRole.PLATFORM_ADMIN,
    { address: null, addressImportProtected: true },
    { id: 'official', address: 'Official address', city: 'Columbus', zip: '43215', state: 'OH' });
  const data = submittedData(); data.set('address', '');
  await assert.rejects(action(data), /REDIRECT:/);
  assert.equal(updates[0].address, null);
  assert.equal(updates[0].addressImportProtected, true);
});

test('wholesale detail renders the Edit link only for Echo admins', () => {
  const source = readFileSync('app/wholesale/[id]/page.tsx', 'utf8');
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let header: ts.JsxElement | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'header') header = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(header);
  const code = ts.transpileModule(`globalThis.header = (${header.getText(ast)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  for (const role of Object.values(UserRole)) {
    const context: Record<string, unknown> = {
      React, UserRole, SalesAccountType, user: { id: 'caller', role, organizationId: 'org_echo_spirits' }, id: 'shared-account', overlay: null,
      account: { id: 'shared-account', name: 'Account', city: 'Columbus', tags: [], officialAccountId: 'official' },
      isAdminRole, hasDirectWholesaleOrders: false, actionUsers: [],
      Link: ({ children, ...props }: { children: React.ReactNode; href: string }) => React.createElement('a', props, children),
      TargetAccountControl: () => null, ContextualActions: ({ secondaryActions }: { secondaryActions: React.ReactNode }) => React.createElement(React.Fragment, null, secondaryActions), TagBadges: () => null,
    };
    runInNewContext(code, context);
    const html = renderToStaticMarkup(context.header as React.ReactElement);
    assert.equal(html.includes('href="/wholesale/shared-account/edit"'), isAdminRole(role), role);
  }
});
