import { AccountSalesStatus, AccountSalesStatusSource, SalesAccountType, type Prisma, type PrismaClient } from '@prisma/client';
import { setAccountSalesStatus } from './accountSalesStatus';
import { prisma } from './prisma';

type TargetingDb = PrismaClient | Prisma.TransactionClient;

export async function setAccountTargeting({
  accountType, changedByUserId, db = prisma, externalAccountId, isTargeting, loggedVisitId, organizationId, changedAt = new Date(),
}: {
  accountType: SalesAccountType;
  changedByUserId: string;
  db?: TargetingDb;
  externalAccountId: string;
  isTargeting: boolean;
  loggedVisitId?: string | null;
  organizationId: string;
  changedAt?: Date;
}) {
  const account = accountType === SalesAccountType.AGENCY
    ? await db.agency.findUnique({ where: { id: externalAccountId }, select: { id: true } })
    : await db.wholesaleAccount.findFirst({ where: { id: externalAccountId, mergedIntoId: null }, select: { id: true } });
  if (!account) throw new Error('Account not found.');

  const key = { organizationId_accountType_externalAccountId: { organizationId, accountType, externalAccountId } };
  const current = await db.organizationAccountOverlay.findUnique({ where: key, select: { isTargeting: true, salesStatus: true } });
  if ((current?.isTargeting ?? false) === isTargeting) return { changed: false, isTargeting };

  await db.organizationAccountOverlay.upsert({
    where: key,
    create: { organizationId, accountType, externalAccountId, isTargeting, targetingUpdatedAt: changedAt, targetingUpdatedBy: changedByUserId },
    update: { isTargeting, targetingUpdatedAt: changedAt, targetingUpdatedBy: changedByUserId },
  });
  await db.accountTargetingHistory.create({ data: { organizationId, accountType, externalAccountId, isTargeting, changedAt, changedByUserId, loggedVisitId: loggedVisitId ?? null } });

  if (isTargeting) {
    const statusEntitlement = await db.organizationFeature.findFirst({ where: { organizationId, featureKey: 'ACCOUNT_SALES_STATUS', enabled: true }, select: { id: true } });
    if (statusEntitlement && !current?.salesStatus) {
      await setAccountSalesStatus({ accountType, changedAt, changedByUserId, context: 'Account targeted', db, externalAccountId, organizationId, source: AccountSalesStatusSource.SYSTEM, status: AccountSalesStatus.TARGET });
    }
  }
  return { changed: true, isTargeting };
}
