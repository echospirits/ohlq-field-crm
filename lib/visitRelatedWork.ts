import { WorklistSource, WorklistStatus, type Prisma } from '@prisma/client';

export type RelatedWorkVisit = {
  id: string;
  agencyId: string | null;
  wholesaleAccountId: string | null;
  locationType: string;
  originatingWorklistItemId: string | null;
};

export function getVisitWorkAccountWhere(visit: RelatedWorkVisit): Prisma.WorklistItemWhereInput {
  return visit.locationType === 'agency' && visit.agencyId
    ? { agencyId: visit.agencyId, wholesaleAccountId: null }
    : visit.locationType === 'wholesale' && visit.wholesaleAccountId
      ? { agencyId: null, wholesaleAccountId: visit.wholesaleAccountId }
      : { id: { in: [] as string[] } };
}

// Match the existing visit form's assignment scope, including a task the user
// deliberately opened from Worklist. Never suggest the new next step just saved.
export function getVisitRelatedWorkWhere(organizationId: string, userId: string, visit: RelatedWorkVisit): Prisma.WorklistItemWhereInput {
  return {
    organizationId,
    AND: [getVisitWorkAccountWhere(visit), { OR: [
      { source: { not: WorklistSource.VISIT_FOLLOW_UP } },
      { loggedVisitId: null },
      { loggedVisitId: { not: visit.id } },
      ...(visit.originatingWorklistItemId ? [{ id: visit.originatingWorklistItemId }] : []),
    ] }],
    status: { in: [WorklistStatus.OPEN, WorklistStatus.IN_PROGRESS] },
    OR: [{ assignedToUserId: userId }, ...(visit.originatingWorklistItemId ? [{ id: visit.originatingWorklistItemId }] : [])],
  };
}

export type VisitRelatedWorkItem = {
  id: string;
  title: string;
  detail: string | null;
  dueDate: string | null;
  assignedTo: string | null;
};

export type VisitRelatedWorkResult = {
  completedIds: string[];
  error?: string;
};
