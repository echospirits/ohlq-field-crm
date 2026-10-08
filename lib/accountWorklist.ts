import { WorklistSource, type Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from './prisma';

export function accountWorklistWhere({ organizationId, accountId, accountType, enabledFeatures }: {
  organizationId: string;
  accountId: string;
  accountType: 'AGENCY' | 'WHOLESALE';
  enabledFeatures: ReadonlySet<string>;
}): Prisma.WorklistItemWhereInput {
  const excludedSources: WorklistSource[] = [
    ...(!enabledFeatures.has('AGENCY_INTELLIGENCE') ? [WorklistSource.AGENCY_INTELLIGENCE] : []),
    ...(!enabledFeatures.has('WHOLESALE_OPPORTUNITIES') ? [WorklistSource.OPPORTUNITY_INTELLIGENCE] : []),
  ];
  const accountField = accountType === 'AGENCY' ? 'agencyId' : 'wholesaleAccountId';
  return {
    organizationId,
    status: { in: ['OPEN', 'IN_PROGRESS'] },
    source: { notIn: excludedSources },
    OR: [
      { [accountField]: accountId },
      // Older follow-ups may carry the account only through their source visit.
      { agencyId: null, wholesaleAccountId: null, loggedVisit: { is: { organizationId, [accountField]: accountId, locationType: accountType === 'AGENCY' ? 'agency' : 'wholesale' } } },
    ],
  };
}

export function getAccountWorklist(input: Parameters<typeof accountWorklistWhere>[0], db: PrismaClient = prisma) {
  return db.worklistItem.findMany({
    where: accountWorklistWhere(input),
    include: {
      assignedToUser: { select: { name: true, email: true } },
      agencyProductIntelligence: { select: { itemCode: true, itemName: true } },
      calendarEvents: { where: { provider: 'GOOGLE' } },
    },
    orderBy: [{ dueDate: 'asc' }, { dueTimeMinutes: 'asc' }, { createdAt: 'desc' }],
  });
}
