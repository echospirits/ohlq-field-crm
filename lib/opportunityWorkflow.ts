type OpportunityIdentity = {
  targetCategory?: string | null;
  targetProduct?: { itemCode?: string | null } | null;
  type: string;
};

type DismissedOpportunity = {
  targetCategory: string | null;
  type: string;
  events: Array<{ metadata: unknown }>;
};

const stableIdentity = (opportunity: OpportunityIdentity) => [
  opportunity.type,
  opportunity.targetCategory ?? '',
  opportunity.targetProduct?.itemCode ?? '',
].join(':');

export function isDismissedOpportunityMatch(
  current: OpportunityIdentity,
  dismissed: DismissedOpportunity[],
) {
  const currentIdentity = stableIdentity(current);
  return dismissed.some((opportunity) => {
    const metadata = opportunity.events[0]?.metadata as { hypothesis?: OpportunityIdentity } | null;
    if (metadata?.hypothesis) return stableIdentity(metadata.hypothesis) === currentIdentity;
    return opportunity.type === current.type && opportunity.targetCategory === (current.targetCategory ?? null);
  });
}
