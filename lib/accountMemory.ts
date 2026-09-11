import type { Prisma, PrismaClient } from '@prisma/client';

export type AccountLocation =
  | { accountType: 'AGENCY'; agencyId: string; wholesaleAccountId?: never }
  | { accountType: 'WHOLESALE'; agencyId?: never; wholesaleAccountId: string };

export const getAccountLocation = (accountType: string, accountId: string): AccountLocation | null => {
  if (accountType === 'AGENCY') return { accountType, agencyId: accountId };
  if (accountType === 'WHOLESALE') return { accountType, wholesaleAccountId: accountId };
  return null;
};

export const getAccountContactWhere = (
  organizationId: string,
  location: AccountLocation,
): Prisma.LocationContactWhereInput => ({
  organizationId,
  ...(location.accountType === 'AGENCY'
    ? { agencyId: location.agencyId }
    : { wholesaleAccountId: location.wholesaleAccountId }),
});

export async function accountExists(db: PrismaClient, location: AccountLocation) {
  return location.accountType === 'AGENCY'
    ? Boolean(await db.agency.findUnique({ where: { id: location.agencyId }, select: { id: true } }))
    : Boolean(await db.wholesaleAccount.findFirst({
        where: { id: location.wholesaleAccountId, mergedIntoId: null },
        select: { id: true },
      }));
}

export const getCommunicationHref = (kind: 'email' | 'phone', value: string) =>
  `${kind === 'email' ? 'mailto' : 'tel'}:${kind === 'email' ? value.trim() : value.replace(/[^+\d*#,;]/g, '')}`;

export const getCommunicationTitle = (kind: 'EMAIL_INITIATED' | 'CALL_INITIATED', name: string) =>
  `${kind === 'EMAIL_INITIATED' ? 'Email' : 'Call'} initiated to ${name}`;
