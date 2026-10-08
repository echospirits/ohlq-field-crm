import assert from 'node:assert/strict';
import test from 'node:test';
import { accountWorklistWhere, getAccountWorklist } from '../lib/accountWorklist';
import type { PrismaClient } from '@prisma/client';

for (const accountType of ['AGENCY', 'WHOLESALE'] as const) {
  test(`${accountType}: outstanding work is tenant scoped, active only, and includes source-visit follow-ups`, async () => {
    const input = { organizationId: 'tenant-a', accountId: 'account-1', accountType, enabledFeatures: new Set<string>() };
    const where = accountWorklistWhere(input);
    assert.equal(where.organizationId, 'tenant-a');
    assert.deepEqual(where.status, { in: ['OPEN', 'IN_PROGRESS'] });
    assert.deepEqual(where.source, { notIn: ['AGENCY_INTELLIGENCE', 'OPPORTUNITY_INTELLIGENCE'] });
    const field = accountType === 'AGENCY' ? 'agencyId' : 'wholesaleAccountId';
    assert.deepEqual(where.OR, [
      { [field]: 'account-1' },
      { agencyId: null, wholesaleAccountId: null, loggedVisit: { is: { organizationId: 'tenant-a', [field]: 'account-1', locationType: accountType === 'AGENCY' ? 'agency' : 'wholesale' } } },
    ]);
    assert.equal(where.assignedToUserId, undefined, 'Includes team and unassigned work');
    let called = false;
    const db = { worklistItem: { findMany: async (query: any) => {
      called = true;
      assert.deepEqual(query.where, where);
      assert.deepEqual(query.orderBy, [{ dueDate: 'asc' }, { dueTimeMinutes: 'asc' }, { createdAt: 'desc' }]);
      return [{ id: 'task-1' }];
    } } } as unknown as PrismaClient;
    assert.deepEqual(await getAccountWorklist(input, db), [{ id: 'task-1' }]);
    assert.equal(called, true);
  });
}

test('enabled intelligence sources stay visible without requiring an add-on for manual tasks', () => {
  const where = accountWorklistWhere({ organizationId: 'tenant-b', accountId: 'b', accountType: 'WHOLESALE', enabledFeatures: new Set(['AGENCY_INTELLIGENCE', 'WHOLESALE_OPPORTUNITIES']) });
  assert.deepEqual(where.source, { notIn: [] });
});
