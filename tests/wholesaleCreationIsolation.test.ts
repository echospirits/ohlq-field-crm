import * as visitGuides from '../lib/crm/visitGuides';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import * as enums from '@prisma/client';
import ts from 'typescript';
import { isTasterRole } from '../lib/userAccess';
import { normalizeUsState, stateScopedLicenseeIds } from '../lib/usStates';
import * as wholesaleAccounts from '../lib/wholesaleAccounts';
import * as visitWorkflow from '../lib/visitWorkflow';
import { getWholesaleAddressProtectionForEdit } from '../lib/wholesaleAddressProtection';

type RecordData = Record<string, any>;
type Flow = 'directory' | 'visit';

function declarations(source: string, names?: string[]) {
  const ast = ts.createSourceFile('actions.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return ast.statements.filter(node => names
    ? ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? '')
    : !ts.isImportDeclaration(node)
  ).map(node => node.getText(ast).replace(/^export (?:default )?/, '')).join('\n');
}

function sharedAccount(): RecordData {
  return {
    id: 'shared-account', name: 'Canonical restaurant', state: 'OH',
    licenseeId: '12345', licenseeIds: [{ licenseeId: '12345' }, { licenseeId: 'SECONDARY' }],
    address: '1 Main St', city: 'Columbus', county: 'Franklin', zip: '43215',
    phone: '614-555-0100', ownership: 'Canonical owner', agencyId: '10', districtId: '2',
    deliveryDay: 'Monday', officialAccountId: 'official-original', isActive: true, mergedIntoId: null,
    latitude: 39.96, longitude: -83, geocodeStatus: 'SUCCESS', geocodedAddress: '1 Main St',
  };
}

function loadFlow(flow: Flow, role: enums.UserRole | null, organizationId: string, accounts: RecordData[]) {
  const effects: string[] = [];
  const tags: RecordData[] = [];
  const visits: RecordData[] = [];
  const contacts: RecordData[] = [];
  const overlays: RecordData[] = [];
  const worklistItems: RecordData[] = [{ id: 'existing-open-task', organizationId, assignedToUserId: `${organizationId}-caller`, wholesaleAccountId: 'shared-account', agencyId: null, status: 'OPEN' }];
  const user = role ? { id: `${organizationId}-caller`, role, organizationId } : null;
  const wholesaleAccount = {
    findMany: async () => { effects.push('account-read'); return accounts; },
    findFirst: async () => { effects.push('account-read'); return accounts[0] ?? null; },
    update: async ({ data }: { data: RecordData }) => {
      effects.push('canonical-update'); Object.assign(accounts[0], data); return accounts[0];
    },
    create: async ({ data }: { data: RecordData }) => {
      effects.push('canonical-create'); const account = { id: 'new-account', ...data };
      accounts.push(account); return account;
    },
  };
  const tx = {
    wholesaleAccount,
    organization:{findUniqueOrThrow:async()=>({crmPreferences:{}})},
    account: { findFirst: async () => { effects.push('official-read'); return { id: 'official-submitted' }; } },
    locationTag: { createMany: async ({ data }: { data: RecordData[] }) => { tags.push(...data); } },
    locationContact: { create: async ({ data }: { data: RecordData }) => {
      contacts.push(data); return { id: 'new-contact', ...data };
    } },
    loggedVisit: { create: async ({ data }: { data: RecordData }) => {
      visits.push(data); return { id: 'new-visit', visitAt: new Date(), ...data };
    } },
    loggedVisitContact: { createMany: async () => {} },
    worklistItem: { updateMany: async ({ where, data }: RecordData) => {
      const matching = worklistItems.filter((item) => where.id.in.includes(item.id) && item.organizationId === where.organizationId);
      matching.forEach((item) => Object.assign(item, data));
      return { count: matching.length };
    } },
  };
  const context: RecordData = {
    URLSearchParams,
    ...enums, ...visitGuides, ...wholesaleAccounts, ...visitWorkflow, normalizeUsState, stateScopedLicenseeIds, isTasterRole,
    getWholesaleAddressProtectionForEdit,
    getCurrentSession: async () => user ? { user } : null,
    requireOrganizationContext: async (actor: typeof user) => ({ organizationId: actor!.organizationId, organization: { enabledStates: ['OH','FL'] } }),
    hasFeature: async () => true,
    getUserDisplayName: () => 'Caller', randomUUID: () => 'unique-test',
    getSelectedTagIds: (data: FormData) => data.getAll('tagId'),
    toOptional: (value: unknown) => String(value ?? '').trim() || null,
    getGeocodeResetForAddressChange: () => { effects.push('geocode-reset'); return { geocodeStatus: 'PENDING' }; },
    syncWholesaleAccountLicenseeIds: async (_db: unknown, _id: string, ids: string[]) => {
      effects.push('licensee-sync'); accounts[0].licenseeIds = ids.map(licenseeId => ({ licenseeId }));
    },
    getSelectedVoiceFollowUps: () => [], parseSalesStatus: (value: unknown) => value || null,
    setAccountSalesStatus: async (args: RecordData) => { overlays.push(args); },
    setAccountTargeting: async (args: RecordData) => { overlays.push(args); },
    createVisitDiagnostics: () => ({ mark: () => {}, failure: () => {}, bestEffort: async (_stage: string, callback: () => Promise<void>) => callback() }),
    unstable_rethrow: (error: Error) => { if (error.message.startsWith('REDIRECT:')) throw error; },
    prisma: {
      ...tx,
      tag: { findMany: async ({ where }: { where: RecordData }) => {
        assert.equal(where.organizationId, organizationId); return [{ id: `${organizationId}-tag` }];
      } },
      worklistItem: { findMany: async () => [] },
      $transaction: async (callback: (db: typeof tx) => Promise<unknown>) => callback(tx),
    },
    revalidatePath: () => {}, redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
  };
  context.organizationModule = { requireOrganizationContext: context.requireOrganizationContext };
  const auth = declarations(readFileSync('lib/auth.ts', 'utf8'), ['requireUserSession', 'requireUser'])
    .replace("await import('./organizations')", 'organizationModule');
  const action = flow === 'directory'
    ? declarations(readFileSync('app/wholesale/page.tsx', 'utf8'), ['createWholesale'])
    : declarations(readFileSync('app/visits/actions.ts', 'utf8'));
  const code = `${auth}\n${action}\nglobalThis.action = ${flow === 'directory' ? 'createWholesale' : 'createVisit'};`;
  runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { run: context.action as (data: FormData) => Promise<any>, effects, tags, visits, contacts, overlays, worklistItems };
}

function submission(flow: Flow, organizationId: string) {
  const data = new FormData();
  const fields = flow === 'directory' ? {
    name: 'ATTACKER NAME', licenseeIds: 'SECONDARY;12345;INJECTED', state: 'OH', address: '99 Wrong St',
    city: 'Wrong city', county: 'Wrong county', zip: '99999', phone: '000', ownership: 'Wrong owner', deliveryDay: 'Friday',
  } : {
    locationType: 'wholesale', newWholesaleName: 'ATTACKER NAME', newWholesaleLicenseeId: 'SECONDARY',
    newWholesaleState: 'OH', newWholesaleAddress: '99 Wrong St', newWholesaleCity: 'Wrong city',
    newWholesaleCounty: 'Wrong county', newWholesaleZip: '99999', newWholesalePhone: '000',
    newWholesaleOwnership: 'Wrong owner', newWholesaleAgencyId: '999', newWholesaleDistrictId: '999',
    newWholesaleDeliveryDay: 'Friday', summary: 'Tenant visit', followUpMode: 'none', newContactName: 'Tenant contact',
    targetAccount: 'true', salesStatus: 'PURSUING',
  };
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  data.set(flow === 'directory' ? 'tagId' : 'newWholesaleTagId', `${organizationId}-tag`);
  data.set('role', 'PLATFORM_ADMIN'); data.set('organizationId', 'forged-tenant');
  data.set('createdByUserId', 'forged-actor');
  return data;
}

for (const flow of ['directory', 'visit'] as const) {
  for (const role of [enums.UserRole.USER, enums.UserRole.ADMIN, enums.UserRole.PLATFORM_ADMIN]) {
    test(`${flow} creation by ${role} in two tenants reuses shared identity without canonical or licensee writes`, async () => {
      const accounts = [sharedAccount()]; const before = structuredClone(accounts);
      for (const organizationId of ['tenant-a', 'tenant-b']) {
        const harness = loadFlow(flow, role, organizationId, accounts);
        await assert.rejects(harness.run(submission(flow, organizationId)), /REDIRECT:/);
        assert.deepEqual(accounts, before);
        assert.ok(!harness.effects.some(effect => ['canonical-update', 'canonical-create', 'licensee-sync', 'geocode-reset'].includes(effect)));
        assert.equal(harness.tags.length, 1);
        assert.equal(harness.tags[0].organizationId, organizationId);
        assert.equal(harness.tags[0].wholesaleAccountId, 'shared-account');
        assert.equal(harness.tags[0].createdByUserId, `${organizationId}-caller`);
        if (flow === 'visit') {
          assert.equal(harness.visits.length, 1); assert.equal(harness.contacts.length, 1);
          for (const record of [...harness.visits, ...harness.contacts, ...harness.overlays]) {
            assert.equal(record.organizationId, organizationId);
          }
          assert.equal(harness.visits[0].wholesaleAccountId, 'shared-account');
          assert.equal(harness.contacts[0].wholesaleAccountId, 'shared-account');
          assert.equal(harness.overlays.length, 2);
        }
      }
    });
  }

  test(`${flow} rejects signed-out callers and neutralizes taster wholesale submissions before shared writes`, async () => {
    for (const role of [null, enums.UserRole.TASTER]) {
      const accounts = [sharedAccount()]; const before = structuredClone(accounts);
      const harness = loadFlow(flow, role, 'tenant-a', accounts);
      await assert.rejects(harness.run(submission(flow, 'tenant-a')), /REDIRECT:/);
      assert.deepEqual(accounts, before); assert.deepEqual(harness.effects, []);
    }
  });

  test(`${flow} retains new prospect creation and tenant ownership for a nonmatching permit`, async () => {
    const accounts: RecordData[] = [];
    const harness = loadFlow(flow, enums.UserRole.USER, 'tenant-a', accounts);
    const data = submission(flow, 'tenant-a');
    if (flow === 'directory') data.set('licenseeIds', 'NEW-PERMIT');
    else data.set('newWholesaleLicenseeId', 'NEW-PERMIT');
    await assert.rejects(harness.run(data), /REDIRECT:/);
    assert.equal(accounts.length, 1); assert.equal(accounts[0].licenseeId, 'NEW-PERMIT');
    assert.equal(accounts[0].createdByUserId, 'tenant-a-caller');
    assert.equal(accounts[0].officialAccountId, 'official-submitted');
    for (const field of ['address', 'city', 'zip']) assert.equal(accounts[0][`${field}ImportProtected`], true);
    assert.equal(harness.effects.filter(effect => effect === 'canonical-create').length, 1);
    assert.ok(!harness.effects.includes('canonical-update'));
    assert.equal(harness.tags[0].wholesaleAccountId, 'new-account');
  });

  test(`${flow} does not reactivate or replace the official link of a matched inactive account`, async () => {
    const accounts = [{ ...sharedAccount(), isActive: false }]; const before = structuredClone(accounts);
    const harness = loadFlow(flow, enums.UserRole.ADMIN, 'tenant-a', accounts);
    await assert.rejects(harness.run(submission(flow, 'tenant-a')), /REDIRECT:/);
    assert.deepEqual(accounts, before);
  });

  test(`${flow} rejects conflicting-state matches without writes`, async () => {
    const accounts = [{ ...sharedAccount(), state: 'KY' }]; const before = structuredClone(accounts);
    const harness = loadFlow(flow, enums.UserRole.USER, 'tenant-a', accounts);
    const result = harness.run(submission(flow, 'tenant-a'));
    if (flow === 'directory') assert.match((await result).error, /another state/);
    else await assert.rejects(result, /conflicting-state/);
    assert.deepEqual(accounts, before); assert.equal(harness.tags.length, 0); assert.equal(harness.visits.length, 0);
  });
}

test('visit creation reuses a manual name/address match without canonical writes', async () => {
  const accounts = [sharedAccount()]; const before = structuredClone(accounts);
  const harness = loadFlow('visit', enums.UserRole.USER, 'tenant-a', accounts);
  const data = submission('visit', 'tenant-a'); data.delete('newWholesaleLicenseeId');
  data.set('newWholesaleName', 'Canonical restaurant'); data.set('newWholesaleAddress', '1 Main St'); data.set('newWholesaleCity', 'Columbus');
  await assert.rejects(harness.run(data), /REDIRECT:/);
  assert.deepEqual(accounts, before); assert.equal(harness.visits[0].wholesaleAccountId, 'shared-account');
  assert.ok(!harness.effects.includes('canonical-update'));
});

test('directory rejects ambiguous licensee matches without canonical or tenant writes', async () => {
  const accounts = [sharedAccount(), { ...sharedAccount(), id: 'other-account' }]; const before = structuredClone(accounts);
  const harness = loadFlow('directory', enums.UserRole.USER, 'tenant-a', accounts);
  await assert.rejects(harness.run(submission('directory', 'tenant-a')), /duplicate-licensee/);
  assert.deepEqual(accounts, before); assert.equal(harness.tags.length, 0);
});

test('physical Visit ignores legacy completion fields and saves with related work left open', async () => {
  const h = loadFlow('visit', enums.UserRole.USER, 'tenant-a', [sharedAccount()]);
  const data = submission('visit', 'tenant-a');
  data.set('worklistCompletion:existing-open-task', 'complete');
  await assert.rejects(h.run(data), /REDIRECT:\/visits\/confirmed/);
  assert.equal(h.visits.length, 1);
  assert.equal(h.worklistItems[0].status, 'OPEN');
  assert.equal(h.worklistItems[0].completedAt, undefined);
});
