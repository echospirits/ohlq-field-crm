type A3aLocation = {
  active: boolean;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  dba: string | null;
  email: string | null;
  id: string;
  isDefault: boolean;
  name: string | null;
  permitNumber: string | null;
  phone: string | null;
  postalCode: string | null;
  state: string;
  storeId: string;
};

export function A3aLocationForm({
  action,
  location,
  organizationId,
}: {
  action: (formData: FormData) => void | Promise<void>;
  location?: A3aLocation;
  organizationId?: string;
}) {
  return (
    <form action={action} className="a3a-location-form">
      {organizationId ? <input name="organizationId" type="hidden" value={organizationId} /> : null}
      {location ? <input name="locationId" type="hidden" value={location.id} /> : null}
      <div className="section-heading">
        <div>
          <span className="page-eyebrow">{location ? `Store ${location.storeId}` : 'New selling location'}</span>
          <h3>{location?.name || 'Add A-3a location'}</h3>
        </div>
        <button className="compact-btn" type="submit">{location ? 'Save location' : 'Add location'}</button>
      </div>
      <div className="form-grid">
        <label>A-3a Store ID<input defaultValue={location?.storeId ?? ''} name="storeId" required /></label>
        <label>Name of A-3a<input defaultValue={location?.name ?? ''} name="name" required /></label>
        <label>DBA<input defaultValue={location?.dba ?? ''} name="dba" /></label>
        <label>A-3a permit number<input defaultValue={location?.permitNumber ?? ''} name="permitNumber" /></label>
        <label>Address line 1<input defaultValue={location?.addressLine1 ?? ''} name="addressLine1" required /></label>
        <label>Address line 2<input defaultValue={location?.addressLine2 ?? ''} name="addressLine2" /></label>
        <label>City<input defaultValue={location?.city ?? ''} name="city" required /></label>
        <label>State<input defaultValue="OH" name="state" readOnly required /></label>
        <label>Postal code<input defaultValue={location?.postalCode ?? ''} name="postalCode" required /></label>
        <label>Phone<input defaultValue={location?.phone ?? ''} name="phone" type="tel" /></label>
        <label>Email<input defaultValue={location?.email ?? ''} name="email" type="email" /></label>
      </div>
      <div className="a3a-location-options">
        <label className="checkbox-label"><input defaultChecked={location?.active ?? true} name="active" type="checkbox" /> Active</label>
        <label className="checkbox-label"><input defaultChecked={location?.isDefault ?? false} name="isDefault" type="checkbox" /> Default selling location</label>
      </div>
    </form>
  );
}
