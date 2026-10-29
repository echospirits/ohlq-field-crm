import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './prisma';
import { directoryPage } from './directoryPagination';

const databaseColumns = new Set(['name', 'address', 'city', 'agencyId']);

/** Page ordinary directory reads in SQL. Computed rankings retain their complete-sort path. */
export async function readWholesaleDirectory({ where, sort, direction, page }: { where: Prisma.WholesaleAccountWhereInput; sort: string; direction: 'asc' | 'desc'; page?: string }, db: PrismaClient = prisma) {
  const serverPaged = databaseColumns.has(sort);
  const total = serverPaged ? await db.wholesaleAccount.count({ where }) : 0;
  const pagination = directoryPage(page, total);
  const orderBy: Prisma.WholesaleAccountOrderByWithRelationInput[] = serverPaged
    ? [{ [sort]: sort === 'name' ? direction : { sort: direction, nulls: 'last' } }, ...(sort !== 'name' ? [{ name: 'asc' as const }] : []), { licenseeId: 'asc' }, { id: 'asc' }]
    : [{ name: 'asc' }, { licenseeId: 'asc' }, { id: 'asc' }];
  const accounts = await db.wholesaleAccount.findMany({
    where, orderBy, take: serverPaged ? pagination.take : 25000,
    ...(serverPaged ? { skip: pagination.skip } : {}),
    include: { licenseeIds: { orderBy: [{ isPrimary: 'desc' }, { licenseeId: 'asc' }], select: { licenseeId: true } } },
  });
  return { accounts, serverPaged, total: serverPaged ? total : accounts.length, page: pagination.page };
}
