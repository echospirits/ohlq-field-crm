export type VisitOriginResolution = 'task' | 'opportunity' | null;

const active = (status: string | null | undefined) => status === 'OPEN' || status === 'IN_PROGRESS';

export function getVisitOriginResolution({
  originatingTaskStatus,
  salesOpportunityStatus,
  agencyOpportunityStatus,
}: {
  originatingTaskStatus?: string | null;
  salesOpportunityStatus?: string | null;
  agencyOpportunityStatus?: string | null;
}): VisitOriginResolution {
  if (active(originatingTaskStatus)) return 'task';
  if (salesOpportunityStatus === 'OPEN' || agencyOpportunityStatus === 'OPEN') return 'opportunity';
  return null;
}
