import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { directoryPage, directoryPageHref } from '../lib/directoryPagination';
import { readWholesaleDirectory } from '../lib/wholesaleDirectory';

test('directory pagination clamps malformed and out-of-range pages without skipping records', () => {
  for (const input of [undefined, 'invalid', '-2', 'Infinity', '0']) assert.equal(directoryPage(input, 101).page, 1);
  assert.deepEqual(directoryPage('999', 101), { page: 3, pages: 3, skip: 100, take: 50 });
  assert.equal(directoryPage('2.9', 101).skip, 50);
  assert.deepEqual(directoryPage('999', 0), { page: 1, pages: 1, skip: 0, take: 50 });
});

test('directory links preserve search and sort while resetting the first page', () => {
  const href = directoryPageHref('/wholesale', { q: 'Zoo & Garden', sort: 'city', dir: 'desc', page: '3' }, 2);
  const query = new URL(href, 'https://fixture.test').searchParams;
  assert.equal(query.get('q'), 'Zoo & Garden');
  assert.equal(query.get('sort'), 'city');
  assert.equal(query.get('dir'), 'desc');
  assert.equal(query.get('page'), '2');
  assert.equal(directoryPageHref('/agencies', { page: '2', q: '' }, 1), '/agencies');
});

test('ordinary restaurant browsing reads only one bounded page with stable ordering and unchanged scope', async () => {
  const where = { isActive: true, state: 'OH' };
  const records = Array.from({ length: 101 }, (_, i) => ({ id: `account-${i}`, name: `Account ${String(i).padStart(3, '0')}` }));
  let rowsRead = 0;
  const db = { wholesaleAccount: {
    count: async (args: any) => { assert.equal(args.where, where); return records.length; },
    findMany: async (args: any) => {
      assert.equal(args.where, where);
      assert.deepEqual(args.orderBy, [{ name: 'asc' }, { licenseeId: 'asc' }, { id: 'asc' }]);
      const selected = records.slice(args.skip, args.skip + args.take); rowsRead += selected.length; return selected;
    },
  } } as unknown as PrismaClient;
  const result = await readWholesaleDirectory({ where, sort: 'name', direction: 'asc', page: '2' }, db);
  assert.equal(rowsRead, 50);
  assert.equal(result.total, 101);
  assert.equal(result.accounts[0].id, 'account-50');
  assert.equal(result.accounts[49].id, 'account-99');
  assert.equal(result.serverPaged, true);
});

test('computed restaurant rankings retain their complete-sort path rather than ranking only one page', async () => {
  const db = { wholesaleAccount: { findMany: async (args: any) => { assert.equal(args.skip, undefined); assert.equal(args.take, 25000); return [{ id: 'a' }, { id: 'b' }]; } } } as unknown as PrismaClient;
  const result = await readWholesaleDirectory({ where: { isActive: true }, sort: 'commercialRating', direction: 'desc', page: '2' }, db);
  assert.equal(result.serverPaged, false);
  assert.equal(result.total, 2);
});
