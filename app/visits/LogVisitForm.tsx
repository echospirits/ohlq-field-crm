'use client';

import { useMemo, useState } from 'react';

const photoTypes = [
  { value: 'DISPLAY', label: 'Display' },
  { value: 'MENU', label: 'Menu' },
  { value: 'OTHER', label: 'Other' },
] as const;

const photoSlots = [1, 2, 3] as const;

export type VisitLocationType = 'agency' | 'wholesale';

export type VisitFormAgencyOption = {
  id: string;
  agencyId: string;
  name: string;
  city: string | null;
  county: string | null;
  phone: string | null;
};

export type VisitFormWholesaleOption = {
  id: string;
  licenseeId: string;
  name: string;
  agencyId: string | null;
  city: string | null;
  county: string | null;
  phone: string | null;
};

export type VisitFormContactOption = {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  agencyId: string | null;
  wholesaleAccountId: string | null;
};

export type VisitFormTagOption = {
  id: string;
  name: string;
  color: string | null;
};

type VisitFormInitialValues = {
  locationType?: VisitLocationType;
  agencyId?: string | null;
  wholesaleAccountId?: string | null;
  summary?: string | null;
  outcomes?: string | null;
  nextStep?: string | null;
  followUpDate?: string | null;
};

type LogVisitFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  agencies: VisitFormAgencyOption[];
  wholesaleAccounts: VisitFormWholesaleOption[];
  contacts: VisitFormContactOption[];
  tags?: VisitFormTagOption[];
  actorName: string;
  formOrigin?: 'visits' | 'worklist';
  worklistItemId?: string;
  initialValues?: VisitFormInitialValues;
  submitLabel?: string;
};

const normalize = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();

const searchable = (...values: Array<string | null | undefined>) => normalize(values.filter(Boolean).join(' '));

const includesSearch = (searchText: string, ...values: Array<string | null | undefined>) =>
  !searchText || searchable(...values).includes(searchText);

const withSelected = <T extends { id: string }>(items: T[], selected: T | undefined) =>
  selected && !items.some((item) => item.id === selected.id) ? [selected, ...items] : items;

export function LogVisitForm({
  action,
  agencies,
  wholesaleAccounts,
  contacts,
  tags = [],
  actorName,
  formOrigin = 'visits',
  worklistItemId,
  initialValues,
  submitLabel = 'Log visit',
}: LogVisitFormProps) {
  const [locationType, setLocationType] = useState<VisitLocationType>(initialValues?.locationType ?? 'agency');
  const [agencyId, setAgencyId] = useState(initialValues?.agencyId ?? '');
  const [wholesaleAccountId, setWholesaleAccountId] = useState(initialValues?.wholesaleAccountId ?? '');
  const [contactId, setContactId] = useState('');
  const [agencySearch, setAgencySearch] = useState('');
  const [wholesaleSearch, setWholesaleSearch] = useState('');
  const [contactSearch, setContactSearch] = useState('');

  const agencySearchText = normalize(agencySearch);
  const wholesaleSearchText = normalize(wholesaleSearch);
  const contactSearchText = normalize(contactSearch);
  const selectedAgency = agencies.find((agency) => agency.id === agencyId);
  const selectedWholesaleAccount = wholesaleAccounts.find((account) => account.id === wholesaleAccountId);

  const visibleAgencies = useMemo(
    () =>
      withSelected(
        agencies
          .filter((agency) =>
            includesSearch(agencySearchText, agency.name, agency.agencyId, agency.city, agency.county, agency.phone),
          )
          .slice(0, 150),
        selectedAgency,
      ),
    [agencies, agencySearchText, selectedAgency],
  );

  const visibleWholesaleAccounts = useMemo(
    () =>
      withSelected(
        wholesaleAccounts
          .filter((account) =>
            includesSearch(
              wholesaleSearchText,
              account.name,
              account.licenseeId,
              account.agencyId,
              account.city,
              account.county,
              account.phone,
            ),
          )
          .slice(0, 150),
        selectedWholesaleAccount,
      ),
    [selectedWholesaleAccount, wholesaleAccounts, wholesaleSearchText],
  );

  const visibleContacts = useMemo(() => {
    const agencyKeys = new Set([selectedAgency?.id, selectedAgency?.agencyId, agencyId].filter(Boolean));
    const scopedContacts = contacts.filter((contact) => {
      if (locationType === 'agency') {
        return agencyKeys.size > 0 && !!contact.agencyId && agencyKeys.has(contact.agencyId);
      }

      return !!wholesaleAccountId && contact.wholesaleAccountId === wholesaleAccountId;
    });

    return scopedContacts
      .filter((contact) => includesSearch(contactSearchText, contact.name, contact.role, contact.phone, contact.email))
      .slice(0, 150);
  }, [agencyId, contactSearchText, contacts, locationType, selectedAgency, wholesaleAccountId]);

  const handleLocationTypeChange = (nextLocationType: VisitLocationType) => {
    setLocationType(nextLocationType);
    setContactId('');

    if (nextLocationType === 'agency') {
      setWholesaleAccountId('');
    } else {
      setAgencyId('');
    }
  };

  const contactSelectLabel =
    locationType === 'agency'
      ? agencyId
        ? '-- Optional agency contact --'
        : '-- Select an agency first --'
      : wholesaleAccountId
        ? '-- Optional wholesale contact --'
        : '-- Select a wholesale account first --';

  return (
    <form action={action} className="visit-form" encType="multipart/form-data">
      <input name="formOrigin" type="hidden" value={formOrigin} />
      {worklistItemId ? <input name="worklistItemId" type="hidden" value={worklistItemId} /> : null}

      <fieldset>
        <legend>Location</legend>
        <label>Location type</label>
        <select
          name="locationType"
          value={locationType}
          onChange={(event) =>
            handleLocationTypeChange(event.target.value === 'wholesale' ? 'wholesale' : 'agency')
          }
        >
          <option value="agency">Agency</option>
          <option value="wholesale">Wholesale</option>
        </select>

        <div className="search-select">
          <label>Agency</label>
          <input
            aria-label="Search agencies"
            placeholder="Search agency name, agency ID, city, county, phone"
            type="search"
            value={agencySearch}
            onChange={(event) => setAgencySearch(event.target.value)}
          />
          <select
            name="agencyId"
            value={agencyId}
            onChange={(event) => {
              setAgencyId(event.target.value);
              setContactId('');
            }}
            disabled={locationType !== 'agency'}
          >
            <option value="">-- Select agency for agency visits --</option>
            {visibleAgencies.map((agency) => (
              <option key={agency.id} value={agency.id}>
                {agency.name} ({agency.agencyId})
              </option>
            ))}
          </select>
        </div>

        <div className="search-select">
          <label>Existing wholesale account</label>
          <input
            aria-label="Search wholesale accounts"
            placeholder="Search account name, licensee ID, agency ID, city, county, phone"
            type="search"
            value={wholesaleSearch}
            onChange={(event) => setWholesaleSearch(event.target.value)}
          />
          <select
            name="wholesaleAccountId"
            value={wholesaleAccountId}
            onChange={(event) => {
              setWholesaleAccountId(event.target.value);
              setContactId('');
            }}
            disabled={locationType !== 'wholesale'}
          >
            <option value="">-- Select wholesale or create one below --</option>
            {visibleWholesaleAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.licenseeId})
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      {locationType === 'wholesale' ? (
        <fieldset>
          <legend>Create / tag wholesale account</legend>
          <div className="form-grid">
            <input name="newWholesaleLicenseeId" placeholder="Licensee ID" />
            <input name="newWholesaleName" placeholder="Account name" />
            <input name="newWholesaleAgencyId" placeholder="Agency ID" />
            <input name="newWholesalePhone" placeholder="Phone" />
            <input name="newWholesaleAddress" placeholder="Address" />
            <input name="newWholesaleCity" placeholder="City" />
            <input name="newWholesaleCounty" placeholder="County" />
            <input name="newWholesaleZip" placeholder="Zip" />
            <input name="newWholesaleOwnership" placeholder="Ownership" />
            <input name="newWholesaleDistrictId" placeholder="District ID" />
            <input name="newWholesaleDeliveryDay" placeholder="Delivery Day" />
          </div>
          {tags.length > 0 ? (
            <>
              <label>Tags</label>
              <div className="tag-checkbox-grid">
                {tags.map((tag) => (
                  <label className="tag-checkbox" key={tag.id}>
                    <input name="newWholesaleTagId" type="checkbox" value={tag.id} />
                    <span className="tag-swatch" style={{ backgroundColor: tag.color ?? '#7c9cff' }} />
                    <span>{tag.name}</span>
                  </label>
                ))}
              </div>
            </>
          ) : null}
        </fieldset>
      ) : null}

      <fieldset>
        <legend>Contact</legend>
        <div className="search-select">
          <label>Existing contact</label>
          <input
            aria-label="Search contacts"
            placeholder="Search contacts for the selected account"
            type="search"
            value={contactSearch}
            onChange={(event) => setContactSearch(event.target.value)}
          />
          <select
            name="contactId"
            value={contactId}
            onChange={(event) => setContactId(event.target.value)}
            disabled={locationType === 'agency' ? !agencyId : !wholesaleAccountId}
          >
            <option value="">{contactSelectLabel}</option>
            {visibleContacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}
                {contact.role ? `, ${contact.role}` : ''}
                {contact.phone ? ` (${contact.phone})` : ''}
              </option>
            ))}
          </select>
        </div>

        <label>Or create contact on the fly</label>
        <div className="form-grid">
          <input name="newContactName" placeholder="Contact name" />
          <input name="newContactPhone" placeholder="Contact phone" />
        </div>
      </fieldset>

      <fieldset>
        <legend>Visit notes</legend>
        <p className="field-note">Visit activity will be recorded as {actorName}.</p>
        <label>Visit summary</label>
        <textarea
          name="summary"
          rows={3}
          placeholder="What happened during the visit?"
          defaultValue={initialValues?.summary ?? ''}
        />

        <label>Outcomes</label>
        <textarea
          name="outcomes"
          rows={3}
          placeholder="Wins, losses, placement notes"
          defaultValue={initialValues?.outcomes ?? ''}
        />

        <label>Next step</label>
        <textarea
          name="nextStep"
          rows={2}
          placeholder="What should happen next?"
          defaultValue={initialValues?.nextStep ?? ''}
        />

        <label>Follow-up date</label>
        <input name="followUpDate" type="date" defaultValue={initialValues?.followUpDate ?? ''} />
      </fieldset>

      <fieldset>
        <legend>Photos</legend>
        {photoSlots.map((photoNumber) => (
          <div className="photo-entry" key={photoNumber}>
            <h3>Photo {photoNumber}</h3>
            <select name="photoType" defaultValue="DISPLAY">
              {photoTypes.map((photoType) => (
                <option key={photoType.value} value={photoType.value}>
                  {photoType.label}
                </option>
              ))}
            </select>
            <input name="photoFile" type="file" accept="image/*" />
            <input name="photoUrl" type="url" placeholder="Or paste an existing photo URL" />
            <input name="photoCaption" placeholder="Caption or note" />
          </div>
        ))}
      </fieldset>

      <button type="submit">{submitLabel}</button>
    </form>
  );
}
