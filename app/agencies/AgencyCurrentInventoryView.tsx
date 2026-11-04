import type { OhlqAgencyInventoryCurrent } from '@prisma/client';
import { DataFreshnessBadge } from '../components/DataFreshnessBadge';

export type CurrentInventoryProduct = Pick<OhlqAgencyInventoryCurrent,
  'itemCode' | 'itemName' | 'status' | 'coverageGroup' | 'onHand' | 'minimum' | 'snapshotDate'>;

export function AgencyCurrentInventoryView({
  products,
  unavailable = false,
}: {
  products: CurrentInventoryProduct[];
  unavailable?: boolean;
}) {
  // A mixed-date input must not make older stock look as fresh as its newest row.
  const sourceDate = products.reduce<Date | null>((oldest, product) =>
    !oldest || product.snapshotDate < oldest ? product.snapshotDate : oldest, null);

  return <section className="workspace-section agency-overview-inventory" id="current-inventory" aria-labelledby="current-inventory-heading">
    <div className="section-heading">
      <h2 id="current-inventory-heading">Current Inventory</h2>
      <DataFreshnessBadge datePrefix="As of" sourceDate={sourceDate} />
    </div>
    {unavailable ? <p role="status">Current inventory could not be loaded. Refresh to try again.</p>
      : products.length ? <div className="table-scroll" role="region" aria-label="Current inventory comparison" tabIndex={0}>
        <table className="comparison-table inventory-comparison-table">
          <colgroup><col /><col className="inventory-quantity-column" /><col className="inventory-quantity-column" /></colgroup>
          <thead><tr><th scope="col">Product</th><th scope="col" className="numeric">On hand</th><th scope="col" className="numeric">Minimum</th></tr></thead>
          <tbody>{products.map((product) => <tr key={product.itemCode}>
            <th scope="row"><strong>{product.itemName}</strong><small>{[product.itemCode, product.status, product.coverageGroup].filter(Boolean).join(' · ')}</small></th>
            <td className="numeric">{product.onHand ?? 'Unknown'}</td>
            <td className="numeric">{product.minimum ?? 'Unknown'}</td>
          </tr>)}</tbody>
        </table>
      </div> : <p className="muted activity-empty">No current inventory is recorded for this agency.</p>}
  </section>;
}
