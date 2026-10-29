import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { getWorklistSearchAlternatives } from '../lib/worklistSearch';

test('task search finds linked account names, including legacy retail keys and source-visit follow-ups', async () => {
  const queries: any[] = [];
  const db = {
    agency: { findMany: async (args: any) => { queries.push(args); return [{ id: 'retail-id', agencyId: '30748' }]; } },
    wholesaleAccount: { findMany: async (args: any) => { queries.push(args); return [{ id: 'restaurant-id' }]; } },
  } as unknown as PrismaClient;
  const filters = await getWorklistSearchAlternatives('  Cincinnati  ', 'tenant-a', db);
  for (const query of queries) assert.deepEqual(query.where.name, { contains: 'Cincinnati', mode: 'insensitive' });
  assert.ok(filters.some(filter => JSON.stringify(filter) === JSON.stringify({ agencyId: { in: ['retail-id', '30748'] } })));
  assert.ok(filters.some(filter => JSON.stringify(filter) === JSON.stringify({ wholesaleAccountId: { in: ['restaurant-id'] } })));
  const visit = filters.find(filter => filter.loggedVisit)!;
  assert.equal(visit.agencyId, null, 'A visit fallback must not replace a directly linked account');
  assert.equal(visit.wholesaleAccountId, null);
  assert.equal((visit.loggedVisit as any).is.organizationId, 'tenant-a');
  assert.equal((visit.loggedVisit as any).is.OR.length, 2);
});

test('an unmatched account name retains text search without an unrestricted location alternative', async () => {
  const db = { agency: { findMany: async () => [] }, wholesaleAccount: { findMany: async () => [] } } as unknown as PrismaClient;
  const filters = await getWorklistSearchAlternatives('unmatched', 'tenant-a', db);
  assert.equal(filters.length, 4);
  assert.ok(filters.every(filter => ['title', 'detail', 'assignedTo', 'createdBy'].includes(Object.keys(filter)[0])));
});

test('an empty query does not load the directory', async () => {
  const db = {} as PrismaClient;
  assert.deepEqual(await getWorklistSearchAlternatives('  ', 'tenant-a', db), []);
});
