'use client';

import { useId } from 'react';
import { normalizeUsState } from '../../lib/usStates';
import { StateField } from './StateField';

export type WholesaleAccountEditValues = {
  id: string;
  name: string;
  licenseeIds: string[];
  phone: string | null;
  agencyId: string | null;
  address: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zip: string | null;
  ownership: string | null;
  districtId: string | null;
  deliveryDay: string | null;
  addressImportProtected?: boolean;
  cityImportProtected?: boolean;
  zipImportProtected?: boolean;
};

export function WholesaleAccountEditFields({ account, compact = false, autoFocus = false }: {
  account: WholesaleAccountEditValues;
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  const name = <label>
    Account name
    <input name="name" defaultValue={account.name} required autoFocus={autoFocus} aria-describedby={`${id}-name-help`} />
    <small id={`${id}-name-help`} className="muted">Kept during future OHLQ imports.</small>
  </label>;
  const location = <>
    <label>
      Address
      <input name="address" defaultValue={account.address ?? ''} autoComplete="street-address" aria-describedby={`${id}-address-help`} />
      <small id={`${id}-address-help`} className="muted">{account.addressImportProtected ? 'Kept during OHLQ imports.' : 'Manual changes are kept during OHLQ imports.'}</small>
    </label>
    <label>
      City
      <input name="city" defaultValue={account.city ?? ''} autoComplete="address-level2" aria-describedby={`${id}-city-help`} />
      <small id={`${id}-city-help`} className="muted">{account.cityImportProtected ? 'Kept during OHLQ imports.' : 'Manual changes are kept during OHLQ imports.'}</small>
    </label>
    <StateField defaultValue={normalizeUsState(account.state) ?? 'OH'} />
    <label>
      ZIP code
      <input name="zip" defaultValue={account.zip ?? ''} autoComplete="postal-code" aria-describedby={`${id}-zip-help`} />
      <small id={`${id}-zip-help`} className="muted">{account.zipImportProtected ? 'Kept during OHLQ imports.' : 'Manual changes are kept during OHLQ imports.'}</small>
    </label>
  </>;
  const licenseeIds = <label>
    Licensee IDs
    <textarea name="licenseeIds" defaultValue={account.licenseeIds.join('\n')} required rows={3} />
  </label>;
  const details = <>
    <label>Phone<input name="phone" defaultValue={account.phone ?? ''} autoComplete="tel" /></label>
    <label>Retail ID<input name="agencyId" defaultValue={account.agencyId ?? ''} /></label>
    <label>County<input name="county" defaultValue={account.county ?? ''} /></label>
    <label>Ownership<input name="ownership" defaultValue={account.ownership ?? ''} /></label>
    <label>District ID<input name="districtId" defaultValue={account.districtId ?? ''} /></label>
    <label>Delivery day<input name="deliveryDay" defaultValue={account.deliveryDay ?? ''} /></label>
  </>;

  return <>
    <input name="id" type="hidden" value={account.id} />
    {compact ? <>
      <div className="form-grid">{name}{location}</div>
      <details className="research-evidence-disclosure">
        <summary>More account details</summary>
        <div className="form-grid">{licenseeIds}{details}</div>
      </details>
    </> : <div className="form-grid">{licenseeIds}{name}{location}{details}</div>}
  </>;
}
