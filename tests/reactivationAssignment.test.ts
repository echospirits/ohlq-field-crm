import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { configureDefaultReactivationAssignee, readDefaultReactivationAssigneeUserId, resolveReactivationAssignees } from '../lib/reactivationAssignment';
import { findOhlqWholesaleReactivationCandidates, getOhlqWholesaleReactivationDashboardSummary, syncOhlqWholesaleReactivationWorklist } from '../lib/ohlqWholesaleReactivation';

const runAt = new Date('2026-11-04T15:00:00Z');
const purchaseAt = new Date('2026-09-20T00:00:00Z');
const member = (id: string, organizationId = 'org_echo_spirits', extra: Record<string, unknown> = {}) => ({ id, organizationId, name: id === 'stable-james-id' ? 'James' : id, email: `${id}@example.test`, firstName: null, lastName: null, isActive: true, role: 'USER', ...extra });
const visit = (user: ReturnType<typeof member> | null, visitAt: string, organizationId = 'org_echo_spirits', wholesaleAccountId = 'account-1') => ({ id: visitAt, organizationId, wholesaleAccountId, locationType: 'wholesale', visitAt: new Date(visitAt), createdAt: new Date(visitAt), createdByUser: user });

function fixture({ organizationId = 'org_echo_spirits', settings = {}, users = [] as ReturnType<typeof member>[], visits = [] as ReturnType<typeof visit>[], items = [] as any[] } = {}) {
  const accounts = [{ id: 'account-1', name: 'Account One', licenseeId: '00123456', licenseeIds: [], ohlqLastEchoPurchaseDate: purchaseAt, ohlqLastEchoPurchaseBottles: 5, ohlqLastEchoPurchaseItemCode: 'ITEM-1', ohlqLastEchoPurchaseItemName: 'Tenant product' }];
  const saved = items;
  const created: any[] = [], updated: any[] = [], repairs: any[] = [];
  const keys = new Set(items.map(item => item.submissionKey).filter(Boolean));
  const db: any = {
    organization: { findUnique: async ({ where }: any) => { assert.equal(where.id, organizationId); return { settings }; } },
    loggedVisit: { findMany: async ({ where, orderBy }: any) => {
      assert.equal(where.organizationId, organizationId);
      assert.equal(where.locationType, 'wholesale');
      assert.equal(where.createdByUser.is.organizationId, organizationId);
      assert.equal(where.createdByUser.is.isActive, true);
      assert.deepEqual(where.createdByUser.is.role.notIn, ['TASTER', 'PLATFORM_ADMIN']);
      assert.deepEqual(orderBy, [{ visitAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]);
      return visits.filter(v => v.organizationId === where.organizationId && v.locationType === where.locationType && where.wholesaleAccountId.in.includes(v.wholesaleAccountId) && v.visitAt <= where.visitAt.lte && v.createdByUser?.organizationId === organizationId && v.createdByUser.isActive && !where.createdByUser.is.role.notIn.includes(v.createdByUser.role)).sort((a,b) => b.visitAt.getTime() - a.visitAt.getTime());
    } },
    user: { findFirst: async ({ where }: any) => {
      assert.equal(where.organizationId, organizationId); assert.equal(where.isActive, true);
      return users.find(u => u.id === where.id && u.organizationId === where.organizationId && u.isActive && !where.role.notIn.includes(u.role)) ?? null;
    } },
    wholesaleAccount: { findMany: async ({ where }: any) => where.id ? accounts.filter(a => where.id.in.includes(a.id)) : where.ohlqLastEchoPurchaseDate.lt ? accounts : [] },
    wholesaleAccountAssessment: { findMany: async ({ where }: any) => { assert.equal(where.organizationId, organizationId); return accounts.map(a => ({ wholesaleAccountId: a.id, wholesaleAccount: { isActive: true, tags: [] } })); } },
    organizationAccountOverlay: { findMany: async () => [] },
    salesOpportunity: { findMany: async () => [] },
    worklistItem: {
      findMany: async ({ where }: any) => { assert.equal(where.organizationId, organizationId); return saved.filter(i => i.organizationId === organizationId).map(i => ({ ...i })); },
      create: async ({ data }: any) => {
        if (keys.has(data.submissionKey)) throw { code: 'P2002' };
        keys.add(data.submissionKey); created.push(data);
        const item = { id: `work-${saved.length}`, ...data, completedAt: null, cancelledAt: null, updatedAt: runAt, assignedToUser: users.find(u => u.id === data.assignedToUserId) ?? null };
        saved.push(item); return item;
      },
      update: async ({ where, data }: any) => { updated.push({ where, data }); const item = saved.find(i => i.id === where.id); if (item) Object.assign(item, data); return item; },
      updateMany: async ({ where, data }: any) => {
        assert.equal(where.organizationId, organizationId); assert.deepEqual(where.status.notIn, ['COMPLETED', 'CANCELLED']);
        if ('assignedToUserId' in data) repairs.push({ where, data }); else updated.push({ where, data });
        const item = saved.find(i => i.id === where.id && i.organizationId === organizationId && (!('assignedToUserId' in where) || i.assignedToUserId === where.assignedToUserId) && !where.status.notIn.includes(i.status));
        if (item) Object.assign(item, data); return { count: item ? 1 : 0 };
      },
    },
  };
  return { db, created, updated, repairs, saved, organizationId };
}
const existingItem = (overrides: Record<string, unknown> = {}) => ({ id: 'existing', organizationId: 'org_echo_spirits', wholesaleAccountId: 'account-1', status: 'OPEN', detail: 'Existing follow-up', assignedToUserId: null, assignedToUser: null, completedAt: null, cancelledAt: null, updatedAt: new Date('2026-10-01'), ...overrides });

describe('reactivation ownership', () => {
  it('assigns new follow-up to the latest qualifying Visit user instead of an older visitor or fallback', async () => {
    const older = member('older'), newer = member('newer'), james = member('stable-james-id');
    const state = fixture({ settings: { defaultReactivationAssigneeUserId: james.id }, users: [older, newer, james], visits: [visit(older, '2026-10-01'), visit(newer, '2026-11-01')] });
    await syncOhlqWholesaleReactivationWorklist({ db: state.db, runAt });
    assert.equal(state.created.length, 1); assert.equal(state.created[0].assignedToUserId, newer.id); assert.equal(state.created[0].assignedTo, newer.name);
  });

  it('uses Echo configured James stable ID when no qualifying Visit exists', async () => {
    const james = member('stable-james-id');
    const state = fixture({ settings: { defaultReactivationAssigneeUserId: james.id }, users: [james] });
    await syncOhlqWholesaleReactivationWorklist({ db: state.db, runAt });
    assert.equal(state.created[0].assignedToUserId, 'stable-james-id'); assert.equal(state.created[0].assignedTo, 'James');
  });

  it('uses each other tenant configured fallback without a global James default', async () => {
    const owner = member('other-owner', 'other-tenant');
    const state = fixture({ organizationId: 'other-tenant', settings: { defaultReactivationAssigneeUserId: owner.id }, users: [owner] });
    const configured = await resolveReactivationAssignees({ db: state.db, organizationId: state.organizationId, wholesaleAccountIds: ['account-1'], runAt });
    assert.equal(configured.get('account-1')?.id, owner.id);
    const unset = fixture({ organizationId: 'other-tenant', users: [member('stable-james-id')] });
    const unconfigured = await resolveReactivationAssignees({ db: unset.db, organizationId: unset.organizationId, wholesaleAccountIds: ['account-1'], runAt });
    assert.equal(unconfigured.get('account-1'), null);
  });

  it('fails closed before reading Echo purchase state or writing follow-ups for another tenant', async () => {
    const db: any = new Proxy({}, { get() { throw new Error('A database read/write was attempted'); } });
    for (const operation of [findOhlqWholesaleReactivationCandidates, syncOhlqWholesaleReactivationWorklist, getOhlqWholesaleReactivationDashboardSummary]) {
      await assert.rejects(operation({ db, organizationId: 'other-tenant', runAt }), /restricted to Echo Spirits/);
    }
  });

  it('excludes foreign, inactive, non-assignable, unidentified and future Visit users and invalid fallbacks', async () => {
    const outsider = member('outsider', 'other-tenant'), inactive = member('inactive', undefined, { isActive: false }), taster = member('taster', undefined, { role: 'TASTER' }), platform = member('platform', undefined, { role: 'PLATFORM_ADMIN' }), valid = member('valid');
    const state = fixture({ settings: { defaultReactivationAssigneeUserId: outsider.id }, users: [outsider], visits: [visit(outsider, '2026-11-03'), visit(inactive, '2026-11-03'), visit(taster, '2026-11-03'), visit(platform, '2026-11-03'), visit(null, '2026-11-03'), visit(valid, '2026-11-03', 'other-tenant'), visit(valid, '2026-12-01')] });
    const result = await resolveReactivationAssignees({ db: state.db, organizationId: state.organizationId, wholesaleAccountIds: ['account-1'], runAt });
    assert.equal(result.get('account-1'), null);
  });

  it('does not duplicate an existing follow-up on repeated imports or reassign its valid owner', async () => {
    const owner = member('owner'), newer = member('newer');
    const state = fixture({ users: [owner, newer], visits: [visit(newer, '2026-11-01')], items: [existingItem({ assignedToUserId: owner.id, assignedToUser: owner })] });
    await syncOhlqWholesaleReactivationWorklist({ db: state.db, runAt });
    await syncOhlqWholesaleReactivationWorklist({ db: state.db, runAt });
    assert.equal(state.created.length, 0); assert.equal(state.repairs.length, 0); assert.equal(state.saved[0].assignedToUserId, owner.id);
  });

  it('repairs only an encountered active follow-up with no valid owner using a conditional tenant-scoped update', async () => {
    const owner = member('recent-visitor');
    const state = fixture({ users: [owner], visits: [visit(owner, '2026-11-01')], items: [existingItem()] });
    await syncOhlqWholesaleReactivationWorklist({ db: state.db, runAt });
    assert.equal(state.created.length, 0); assert.equal(state.repairs.length, 1); assert.equal(state.repairs[0].where.assignedToUserId, null); assert.equal(state.saved[0].assignedToUserId, owner.id);
  });

  it('preserves a concurrent owner change instead of overwriting it with the Visit owner', async () => {
    const owner = member('recent-visitor');
    const state = fixture({ users: [owner], visits: [visit(owner, '2026-11-01')], items: [existingItem()] });
    const updateMany = state.db.worklistItem.updateMany;
    state.db.worklistItem.updateMany = async (args: any) => {
      if ('assignedToUserId' in args.data) state.saved[0].assignedToUserId = 'concurrent-owner';
      return updateMany(args);
    };
    await syncOhlqWholesaleReactivationWorklist({ db: state.db, runAt });
    assert.equal(state.saved[0].assignedToUserId, 'concurrent-owner');
  });

  it('does not change ownership, details or scheduling if the follow-up completes while sync is running', async () => {
    const owner = member('recent-visitor');
    const state = fixture({ users: [owner], visits: [visit(owner, '2026-11-01')], items: [existingItem()] });
    const updateMany = state.db.worklistItem.updateMany;
    let completedState = '';
    state.db.worklistItem.updateMany = async (args: any) => {
      state.saved[0].status = 'COMPLETED';
      state.saved[0].completedAt = runAt;
      completedState ||= JSON.stringify(state.saved[0]);
      return updateMany(args);
    };
    const result = await syncOhlqWholesaleReactivationWorklist({ db: state.db, runAt });
    assert.equal(JSON.stringify(state.saved[0]), completedState); assert.equal(result.updatedItems, 0);
  });

  it('preserves completed/cancelled historical follow-ups and creates no replacement for their handled lapse', async () => {
    for (const status of ['COMPLETED', 'CANCELLED']) {
      const item = existingItem({ status, assignedToUserId: 'historical-owner', completedAt: status === 'COMPLETED' ? new Date('2026-10-01') : null, cancelledAt: status === 'CANCELLED' ? new Date('2026-10-01') : null });
      const before = JSON.stringify(item), state = fixture({ items: [item], users: [member('stable-james-id')], settings: { defaultReactivationAssigneeUserId: 'stable-james-id' } });
      await syncOhlqWholesaleReactivationWorklist({ db: state.db, runAt });
      assert.equal(state.created.length, 0); assert.equal(state.updated.length, 0); assert.equal(state.repairs.length, 0); assert.equal(JSON.stringify(item), before);
    }
  });

  it('prevents concurrent duplicate imports for the same purchase lapse through the existing tenant submission key', async () => {
    const state = fixture();
    const results = await Promise.all([syncOhlqWholesaleReactivationWorklist({ db: state.db, runAt }), syncOhlqWholesaleReactivationWorklist({ db: state.db, runAt })]);
    assert.equal(state.created.length, 1); assert.equal(results.reduce((sum, result) => sum + result.createdItems, 0), 1);
    assert.equal(state.created[0].submissionKey, `ohlq-reactivation:account-1:${purchaseAt.toISOString()}`);
  });
});

describe('reactivation fallback configuration', () => {
  it('reads only a valid explicit ID and treats missing/null/malformed values as unset', () => {
    assert.equal(readDefaultReactivationAssigneeUserId({ defaultReactivationAssigneeUserId: 'stable-james-id' }), 'stable-james-id');
    for (const settings of [null, {}, { defaultReactivationAssigneeUserId: null }, { defaultReactivationAssigneeUserId: '' }, { defaultReactivationAssigneeUserId: 123 }]) assert.equal(readDefaultReactivationAssigneeUserId(settings), null);
  });

  it('merges the configured stable ID and audits it without changing unrelated organization settings', async () => {
    const updates: any[] = [], audits: any[] = [];
    const db: any = {
      $executeRaw: async () => 1,
      user: { findFirst: async ({ where }: any) => { assert.equal(where.organizationId, 'org_echo_spirits'); assert.equal(where.isActive, true); return where.id === 'admin-id' ? { id: 'admin-id' } : where.id === 'stable-james-id' ? member('stable-james-id') : null; } },
      organization: { findUniqueOrThrow: async () => ({ settings: { existingFeature: { retained: true } } }), update: async (args: any) => { updates.push(args); } },
      organizationAuditEvent: { create: async (args: any) => { audits.push(args); } },
    };
    await configureDefaultReactivationAssignee({ db, organizationId: 'org_echo_spirits', userId: 'stable-james-id', actorUserId: 'admin-id' });
    assert.deepEqual(updates[0].data.settings, { existingFeature: { retained: true }, defaultReactivationAssigneeUserId: 'stable-james-id' });
    assert.equal(audits[0].data.metadata.assignedToUserId, 'stable-james-id');
    await assert.rejects(configureDefaultReactivationAssignee({ db, organizationId: 'org_echo_spirits', userId: 'foreign-or-missing-id', actorUserId: 'admin-id' }), /active assignable member/);
    await assert.rejects(configureDefaultReactivationAssignee({ db, organizationId: 'org_echo_spirits', userId: 'stable-james-id', actorUserId: 'non-admin-id' }), /administrator/);
    assert.equal(updates.length, 1);
  });
});
