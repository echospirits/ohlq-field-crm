import { PrismaClient } from '@prisma/client';
import { extendWithAccountStateAccess, withOrganizationStateAccess, type StateAccessOptions } from './accountStateAccess';
import { validateRuntimeEnvironment } from './appEnvironment';

validateRuntimeEnvironment();

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const basePrisma = globalForPrisma.prisma ?? new PrismaClient();
export const prisma = extendWithAccountStateAccess(basePrisma) as unknown as PrismaClient;
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = basePrisma;

// Explicit tenant scope for cron and other background dispatchers.
export function runWithOrganizationStateAccess<T>(organizationId: string, work: () => Promise<T>, options?: StateAccessOptions) {
  return withOrganizationStateAccess(basePrisma, organizationId, work, options);
}
