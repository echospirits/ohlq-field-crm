import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma, type PrismaClient } from '@prisma/client';
import { assertStateWrite, combineWhere, modelStateWhere, scopeReadArgs, stateWhere, type StateScope } from '../lib/accountStatePolicy';
import { extendWithAccountStateAccess, loadStateScope, withAccountStateScope } from '../lib/accountStateAccess';
import { ECHO_ORGANIZATION_ID } from '../lib/echoAccess';

const ohio: StateScope = { states: ['OH'], agencyIds: ['oh-retail'], agencyNumbers: ['100'], restaurantIds: ['oh-restaurant'] };
const florida: StateScope = { states: ['FL'], agencyIds: ['fl-retail'], agencyNumbers: ['ABC-FL-003'], restaurantIds: ['fl-restaurant'] };

test('Echo sales workflows skip state filtering while configured-state jobs retain their coverage', async () => {
  const directoryReads: unknown[] = [];
  const db = {
    organization: { findUnique: async () => ({ active: true, accountStatus: 'ACTIVE', enabledStates: ['OH'] }) },
    agency: { findMany: async ({ where }: { where: unknown }) => { directoryReads.push(where); return []; } },
    wholesaleAccount: { findMany: async ({ where }: { where: unknown }) => { directoryReads.push(where); return []; } },
    $queryRawUnsafe: async () => [],
  } as unknown as PrismaClient;
  assert.equal(await loadStateScope(db, ECHO_ORGANIZATION_ID), null);
  assert.deepEqual(directoryReads, []);
  const scope = await loadStateScope(db, ECHO_ORGANIZATION_ID, { restrictToConfiguredStates: true });
  assert.deepEqual(scope?.states, ['OH']);
  assert.deepEqual(directoryReads, [stateWhere(['OH']), stateWhere(['OH'])]);
});

test('legacy blank Ohio state remains Ohio, while a Florida-only tenant cannot match blank or Ohio rows', () => {
  assert.deepEqual(stateWhere(['FL']), { OR: [{ state: { in: ['FL', 'Florida'], mode: 'insensitive' } }] });
  assert.deepEqual(stateWhere(['OH']).OR.slice(1), [{ state: null }, { state: '' }]);
  assert.deepEqual(modelStateWhere('OhlqAnnualSalesRow', florida), { OR: [] });
});

test('state filters retain unique keys and the caller’s original OR and AND filters', () => {
  const original = { id: 'fl-retail', OR: [{ city: 'Miami' }, { name: 'ABC' }], AND: [{ name: { not: '' } }] };
  const where = combineWhere(original, stateWhere(['OH'])) as Record<string, unknown>;
  assert.equal(where.id, original.id);
  assert.deepEqual(where.OR, original.OR);
  assert.deepEqual(where.AND, [...original.AND, stateWhere(['OH'])]);
});

test('contacts, audit overlays, visits, photos, calendar links and nested tag counts carry state restrictions', () => {
  for (const model of ['LocationContact', 'OrganizationAccountOverlay', 'LoggedVisit', 'VisitPhoto', 'WorklistCalendarEvent', 'DealEvent']) {
    const where = modelStateWhere(model, florida);
    assert.ok(where, model);
    assert.ok(JSON.stringify(where).includes('fl-') || JSON.stringify(where).includes('Florida'), model);
  }
  const result = scopeReadArgs('Tag', { include: { locationTags: true, _count: true } }, ohio) as any;
  assert.ok(result.include.locationTags.where);
  assert.ok(result.include._count.select.locationTags.where);
  const sales = JSON.stringify(modelStateWhere('AccountSalesEvent', ohio));
  assert.ok(sales.includes('Ohio')); // Scope the restaurant, not its supplying OHLQ agency number.
  assert.ok(JSON.stringify(modelStateWhere('LoggedVisit', ohio)).includes('100')); // Legacy visits may use agency numbers.
});

test('writes cannot create or relink accounts, contacts or overlays outside the enabled states', () => {
  assert.throws(() => assertStateWrite('Agency', { state: 'FL' }, ohio, true));
  assert.throws(() => assertStateWrite('WholesaleAccount', { state: { set: 'FL' } }, ohio));
  assert.throws(() => assertStateWrite('LocationContact', { agencyId: 'fl-retail' }, ohio, true));
  assert.throws(() => assertStateWrite('OrganizationAccountOverlay', { accountType: 'AGENCY', externalAccountId: 'fl-retail' }, ohio, true));
  assert.throws(() => assertStateWrite('Tag', { locationTags: { create: { agencyId: 'fl-retail' } } }, ohio));
  assert.doesNotThrow(() => assertStateWrite('WholesaleAccount', { state: 'Florida' }, florida, true));
  assert.doesNotThrow(() => assertStateWrite('AccountSalesEvent', { agencyId: '100', wholesaleAccountId: 'oh-restaurant' }, ohio, true));
});

test('concurrent request contexts keep independent states and guard reads and updates', async () => {
  let operation: (value: any) => Promise<unknown>;
  extendWithAccountStateAccess({ $extends: (configuration: any) => { operation = configuration.query.$allModels.$allOperations; return {}; } } as any);
  const invoke = (model: string, op: string) => operation({ model, operation: op, args: { where: { id: 'same' }, ...(op === 'update' ? { data: { name: 'Edit' } } : {}) }, query: async (args: unknown) => args });
  const [oh, fl] = await Promise.all([
    withAccountStateScope(ohio, async () => { await new Promise(resolve => setTimeout(resolve, 10)); return invoke('Agency', 'findUnique'); }),
    withAccountStateScope(florida, () => invoke('WholesaleAccount', 'update')),
  ]);
  assert.ok(JSON.stringify(oh).includes('Ohio')); assert.ok(!JSON.stringify(oh).includes('Florida'));
  assert.ok(JSON.stringify(fl).includes('Florida')); assert.ok(!JSON.stringify(fl).includes('Ohio'));
});

test('identity-only reads bypass directory scope while nested account selections remain restricted', async () => {
  let operation: (value: any) => Promise<any>;
  extendWithAccountStateAccess({ $extends: (configuration: any) => { operation = configuration.query.$allModels.$allOperations; return {}; } } as any);
  const run = (model: string, op: string, args: Record<string, unknown>) =>
    withAccountStateScope(ohio, () => operation({ model, operation: op, args, query: async (value: unknown) => value }));

  const session = { where: { tokenHash: 'hash' }, include: { user: true } };
  assert.strictEqual(await run('UserSession', 'findFirst', session), session);
  const feature = { where: { organizationId: 'org' }, select: { featureKey: true } };
  assert.strictEqual(await run('OrganizationFeature', 'findMany', feature), feature);

  const nested = await run('UserSession', 'findFirst', { include: { user: { include: { createdWholesaleAccounts: true } } } });
  assert.ok(JSON.stringify(nested.include.user.include.createdWholesaleAccounts.where).includes('Ohio'));
  const counts = await run('User', 'findMany', { select: { _count: { select: { createdWholesaleAccounts: true } } } });
  assert.ok(JSON.stringify(counts.select._count.select.createdWholesaleAccounts.where).includes('Ohio'));
});

test('large Ohio directories use only each legacy table’s referenced IDs in recursive policies', () => {
  const ids = Array.from({length: 16000}, (_, i) => 'restaurant-' + i);
  const scope: StateScope = {...ohio, restaurantIds: ids, referencesByModel: { ...Object.fromEntries(Prisma.dmmf.datamodel.models.map(model => [model.name, {agency: [], restaurant: []}])) ,
    LoggedVisit: {agency: [], restaurant: [ids[0], 'outside-state']},
    WorklistItem: {agency: [], restaurant: [ids[1]]},
    OrganizationAccountOverlay: {agency: [], restaurant: ids},
  }};
  const policy = JSON.stringify(modelStateWhere('LoggedVisitContact', scope));
  assert.ok(policy.includes(ids[0]));
  assert.ok(!policy.includes('outside-state'));
  assert.ok(!policy.includes(ids[15999]));
  assert.ok(policy.length < 30000);
});

test('new event and playbook account references follow tenant state scope',()=>{
 for(const model of ['EventShift','PlaybookRun']){
  const where=JSON.stringify(modelStateWhere(model,florida));assert.ok(where.includes('fl-retail'));assert.ok(!where.includes('oh-retail'));
  assert.throws(()=>assertStateWrite(model,{accountType:'AGENCY',[model==='EventShift'?'externalAccountId':'accountId']:'oh-retail'},florida,true));
 }
 assertStateWrite('EventShift',{accountType:null,externalAccountId:null},florida,true);
 assert.ok(JSON.stringify(modelStateWhere('EventShift',florida)).includes('"externalAccountId":null'));
});

test('composing state restrictions preserves flat Prisma AND arrays across repeated scopes',()=>{const first=combineWhere({AND:[{status:'OPEN'},{organizationId:'tenant'}]},{agencyId:{in:['oh']}});const again=combineWhere(first,{dueDate:{not:null}});assert.equal(again.AND.length,4);assert.ok(again.AND.every(v=>!Array.isArray(v)));});

test('optional composite account relations use nullable identity columns rather than a nullable tenant key',()=>{const policy=JSON.stringify(modelStateWhere('WorklistItem',ohio));assert.ok(policy.includes('"sourceActivityId":null'));assert.ok(policy.includes('"playbookRunId":null'));assert.ok(!policy.includes('"sourceActivity":null'));assert.ok(JSON.stringify(modelStateWhere('LoggedVisit',ohio)).includes('"eventShiftId":null'));});
