import { prisma } from '../prisma';

export class CalendarSyncBusyError extends Error {
  constructor() { super('Another calendar operation is running. Try again shortly.'); }
}

// Transaction-scoped locks work through PgBouncer and release on process failure.
// The transaction holds only the lock; normal writes remain durable individually.
// All calendar writers (including settings and OAuth) must use this same lock.
export async function withCalendarSyncLock<T>(operation: () => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT pg_try_advisory_xact_lock(187911, 14001) AS acquired
    `;
    if (!lock.acquired) throw new CalendarSyncBusyError();
    return operation();
  }, { maxWait: 5_000, timeout: 240_000 });
}
