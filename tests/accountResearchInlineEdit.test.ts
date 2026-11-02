import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { UserRole } from '@prisma/client';
import ts from 'typescript';
import { z } from 'zod';
import { hasEchoAccess } from '../lib/echoAccess';
import { isAdminRole, isTasterRole } from '../lib/userAccess';
import { getWholesaleLicenseeIdValues } from '../lib/wholesaleAccounts';
import type { ActionResult } from '../app/components/ActionForm';
import type { WholesaleAccountEditValues } from '../app/components/WholesaleAccountEditFields';

const actionSource = readFileSync('app/admin/account-research/edit-account-actions.ts', 'utf8');
const authAst = ts.createSourceFile('auth.ts', readFileSync('lib/auth.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const authSource = ['requireUserSession', 'requireEchoAdminSession', 'requireEchoAdmin'].map(name => {
  const declaration = authAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `Missing actual authorization function ${name}`);
  return declaration.getText(authAst).replace(/^export /, '');
}).join('\n');
const authCode = ts.transpileModule(`${authSource}\nglobalThis.guard = requireEchoAdmin;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const actionCode = ts.transpileModule(actionSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

type StoredAccount = Omit<WholesaleAccountEditValues, 'licenseeIds'> & {
  licenseeId: string | null;
  licenseeIds: Array<{ licenseeId: string }>;
  mergedIntoId: string | null;
};

const account: StoredAccount = {
  id: 'research-account', name: 'Ming Flower', licenseeId: '06028778-1',
  licenseeIds: [{ licenseeId: '06028778-1' }, { licenseeId: '06028778-2' }],
  address: '475 Lazelle Rd', city: 'Columbus', state: 'OH', zip: '43081', county: 'Franklin',
  phone: '614-555-0100', agencyId: '100', districtId: '2', ownership: 'Local', deliveryDay: 'Monday',
  addressImportProtected: true, cityImportProtected: false, zipImportProtected: true, mergedIntoId: null,
};

function fixture(options: {
  role?: UserRole | null;
  organizationId?: string | null;
  organizationAvailable?: boolean;
  featureEnabled?: boolean;
  account?: Partial<typeof account> | null;
  saveResult?: ActionResult;
  saveError?: Error;
} = {}) {
  const role = options.role === undefined ? UserRole.ADMIN : options.role;
  const user = role ? { id: 'trusted-actor', role, organizationId: options.organizationId === undefined ? 'org_echo_spirits' : options.organizationId } : null;
  const effects: string[] = [];
  const reads: Array<{ where: { id: string }; select: Record<string, unknown> }> = [];
  const submissions: FormData[] = [];
  const auth: Record<string, unknown> = {
    UserRole, isAdminRole, isTasterRole, hasEchoAccess,
    getCurrentSession: async () => user ? { user } : null,
    redirect: (path: string): never => { throw new Error(`redirect:${path}`); },
  };
  runInNewContext(authCode, auth);
  const guard = auth.guard as () => Promise<typeof user>;
  const dependencies: Record<string, unknown> = {
    zod: { z },
    '../../../lib/auth': { requireEchoAdmin: async () => { effects.push('auth'); return guard(); } },
    '../../../lib/organizations': {
      requireOrganizationContext: async (actor: unknown) => {
        effects.push('organization');
        assert.strictEqual(actor, user, 'Organization must come from the authenticated actor');
        if (options.organizationAvailable === false) throw new Error('organization-unavailable');
        return { organizationId: user!.organizationId };
      },
      requireFeatureForUser: async (actor: unknown, feature: string) => {
        effects.push('feature');
        assert.strictEqual(actor, user, 'Feature access must use the authenticated actor');
        assert.equal(feature, 'ADVANCED_INTELLIGENCE');
        if (options.featureEnabled === false) throw new Error('feature-unavailable');
      },
    },
    '../../../lib/wholesaleAccounts': { getWholesaleLicenseeIdValues },
    '../../../lib/prisma': { prisma: {
      wholesaleAccount: {
        findUnique: async (query: { where: { id: string }; select: Record<string, unknown> }) => {
          effects.push('read');
          reads.push(query);
          if (options.account === null) return null;
          const record: Record<string, unknown> = { ...account, ...options.account };
          return Object.fromEntries(Object.keys(query.select).map(key => [key, record[key]]));
        },
      },
    } },
    '../../wholesale/[id]/edit/actions': {
      saveWholesaleAccount: async (data: FormData) => {
        effects.push('canonical-save');
        submissions.push(data);
        if (options.saveError) throw options.saveError;
        return options.saveResult ?? { success: 'Ming Flower saved.' };
      },
    },
  };
  const exports = {};
  // Only the established read and save dependencies are available. A research
  // submission, direct deletion, or second write cannot run in this harness.
  runInNewContext(actionCode, {
    exports,
    require: (name: string) => { assert.ok(Object.hasOwn(dependencies, name), `Unexpected action dependency ${name}`); return dependencies[name]; },
    fetch: () => assert.fail('Editing an account must not launch public research'),
  });
  return { api: exports as typeof import('../app/admin/account-research/edit-account-actions'), effects, reads, submissions };
}

function submittedData() {
  const data = new FormData();
  data.set('id', account.id);
  data.set('name', 'Corrected Ming Flower');
  data.set('city', 'Westerville');
  data.set('organizationId', 'forged-organization');
  data.set('role', 'PLATFORM_ADMIN');
  data.set('userId', 'forged-actor');
  return data;
}

for (const operation of ['load', 'save'] as const) {
  const invoke = (f: ReturnType<typeof fixture>) => operation === 'load'
    ? f.api.loadResearchAccountEditor(account.id) : f.api.saveResearchAccount(submittedData());

  test(`research inline ${operation} rejects anonymous, ordinary, taster, and outside-Echo admins before access`, async () => {
    for (const options of [
      { role: null }, { role: UserRole.USER }, { role: UserRole.TASTER },
      { role: UserRole.ADMIN, organizationId: 'other-tenant' },
      { role: UserRole.PLATFORM_ADMIN, organizationId: 'other-tenant' },
    ]) {
      const f = fixture(options);
      await assert.rejects(invoke(f), /redirect:/);
      assert.deepEqual(f.effects, ['auth']);
      assert.deepEqual(f.reads, []);
      assert.deepEqual(f.submissions, []);
    }
  });

  test(`research inline ${operation} requires available organization and feature before account access`, async () => {
    for (const [options, expected] of [
      [{ organizationAvailable: false }, ['auth', 'organization']],
      [{ featureEnabled: false }, ['auth', 'organization', 'feature']],
    ] as const) {
      const f = fixture(options);
      await assert.rejects(invoke(f), /unavailable/);
      assert.deepEqual(f.effects, expected);
      assert.deepEqual(f.reads, []);
      assert.deepEqual(f.submissions, []);
    }
  });
}

test('research editor rejects invalid account IDs before reading and trims a valid ID', async () => {
  for (const id of ['', '   ', 'x'.repeat(201), null, 42, {}]) {
    const f = fixture();
    const result = await f.api.loadResearchAccountEditor(id as string);
    assert.ok('error' in result);
    assert.deepEqual(f.effects, ['auth', 'organization', 'feature']);
    assert.deepEqual(f.reads, []);
  }
  const f = fixture();
  await f.api.loadResearchAccountEditor(`  ${account.id}  `);
  assert.equal(f.reads[0].where.id, account.id);
});

test('research editor reports missing and merged accounts without exposing an editable stale record', async () => {
  for (const [record, message] of [[null, /no longer available/], [{ mergedIntoId: 'replacement' }, /merged/]] as const) {
    const f = fixture({ account: record });
    const result = await f.api.loadResearchAccountEditor(account.id);
    assert.ok('error' in result);
    assert.match(result.error, message);
    assert.ok(!('account' in result));
    assert.deepEqual(f.effects, ['auth', 'organization', 'feature', 'read']);
    assert.deepEqual(f.submissions, []);
  }
});

test('research editor returns every editable field and import protection with stable, serialized licensee IDs', async () => {
  for (const role of [UserRole.ADMIN, UserRole.PLATFORM_ADMIN]) {
    const f = fixture({ role });
    const result = await f.api.loadResearchAccountEditor(account.id);
    assert.ok('account' in result);
    assert.deepEqual(JSON.parse(JSON.stringify(result.account)), {
      id: account.id, name: account.name, licenseeIds: ['06028778-1', '06028778-2'],
      address: account.address, city: account.city, state: account.state, zip: account.zip, county: account.county,
      phone: account.phone, agencyId: account.agencyId, districtId: account.districtId,
      ownership: account.ownership, deliveryDay: account.deliveryDay,
      addressImportProtected: true, cityImportProtected: false, zipImportProtected: true,
    });
    const identifiers = f.reads[0].select.licenseeIds as { orderBy: unknown; select: unknown };
    assert.deepEqual(JSON.parse(JSON.stringify(identifiers.orderBy)), [{ isPrimary: 'desc' }, { licenseeId: 'asc' }]);
    assert.deepEqual(JSON.parse(JSON.stringify(identifiers.select)), { licenseeId: true });
    assert.deepEqual(f.effects, ['auth', 'organization', 'feature', 'read']);
  }
});

test('research editor retains a legacy primary ID when relation rows are absent and preserves unknown values', async () => {
  const f = fixture({ account: { licenseeIds: [], phone: null, address: null } });
  const result = await f.api.loadResearchAccountEditor(account.id);
  assert.ok('account' in result);
  assert.deepEqual([...result.account.licenseeIds], [account.licenseeId]);
  assert.equal(result.account.phone, null);
  assert.equal(result.account.address, null);
});

test('research inline save delegates the unchanged submission and returns canonical success or validation errors', async () => {
  for (const saveResult of [{ success: 'Corrected Ming Flower saved.' }, { error: 'A restaurant already uses this licensee ID.' }, { error: 'This account was merged.', refresh: true }]) {
    const f = fixture({ saveResult });
    const data = submittedData();
    const result = await f.api.saveResearchAccount(data);
    assert.strictEqual(result, saveResult);
    assert.equal(f.submissions.length, 1);
    assert.strictEqual(f.submissions[0], data, 'Canonical action must receive all form fields unchanged');
    assert.deepEqual(f.effects, ['auth', 'organization', 'feature', 'canonical-save']);
    assert.deepEqual(f.reads, []);
  }
});

test('research inline save does not conceal canonical failures or launch a second operation', async () => {
  const failure = new Error('Unconfirmed canonical save');
  const f = fixture({ saveError: failure });
  await assert.rejects(f.api.saveResearchAccount(submittedData()), error => error === failure);
  assert.deepEqual(f.effects, ['auth', 'organization', 'feature', 'canonical-save']);
  assert.equal(f.submissions.length, 1);
});
