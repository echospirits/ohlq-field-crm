import { StateField } from './StateField';

/** Keep manual-account address order consistent in the directory and visit form. */
export function WholesaleAddressFields({ visit = false }: { visit?: boolean }) {
  const names = visit
    ? { address: 'newWholesaleAddress', city: 'newWholesaleCity', state: 'newWholesaleState', zip: 'newWholesaleZip' }
    : { address: 'address', city: 'city', state: 'state', zip: 'zip' };

  return (
    <fieldset className="wholesale-create-section">
      <legend>Location</legend>
      <div className="wholesale-address-grid">
        <label className="wholesale-address-street">Street address<input name={names.address} autoComplete="street-address" /></label>
        <label className="wholesale-address-city">City<input name={names.city} autoComplete="address-level2" /></label>
        <StateField name={names.state} />
        <label>ZIP code<input name={names.zip} autoComplete="postal-code" inputMode="numeric" /></label>
        {!visit ? <label className="wholesale-address-county">County (optional)<input name="county" /></label> : null}
      </div>
      <p className="muted wholesale-create-help">Include the full address for accurate location research. State defaults to Ohio; change it for out-of-state accounts.</p>
    </fieldset>
  );
}
