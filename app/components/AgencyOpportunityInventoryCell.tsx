import { isRestrictedAgencyInventory } from '../../lib/ohlqAgencyInventory';

type OpportunityInventory = {
  onHand: number | null;
  minimum: number | null;
  coverageGroup: string | null;
};

export function AgencyOpportunityInventoryCell({ opportunity }: { opportunity: OpportunityInventory }) {
  const minimumLabel = isRestrictedAgencyInventory(opportunity.coverageGroup)
    ? 'Restricted'
    : `Min ${opportunity.minimum ?? 'Unavailable'}`;

  return <td className="numeric" data-label="On hand / min">
    <strong>{opportunity.onHand ?? 'Unavailable'}</strong>
    <small>{minimumLabel}</small>
  </td>;
}
