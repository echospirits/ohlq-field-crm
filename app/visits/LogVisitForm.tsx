'use client';

import { useMemo, useState } from 'react';

const photoTypes = [
  { value: 'DISPLAY', label: 'Display' },
  { value: 'MENU', label: 'Menu' },
  { value: 'OTHER', label: 'Other' },
] as const;

const photoSlots = [2, 3] as const;

const quickOutcomes = [
  'Display checked',
  'Menu checked',
  'Staff trained',
  'Order opportunity',
  'Needs follow-up',
  'No action needed',
] as const;

const quickFollowUps = [
  { label: 'Tomorrow', days: 1 },
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
] as const;

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

const toDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

const getFollowUpDate = (daysFromNow: number) => {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);

  return toDateInputValue(date);
};

const getAgencyMeta = (agency: VisitFormAgencyOption) =>
  [agency.agencyId, agency.city, agency.phone].filter(Boolean).join(' / ');

const getWholesaleMeta = (account: VisitFormWholesaleOption) =>
  [account.licenseeId, account.city, account.phone].filter(Boolean).join(' / ');

const getContactMeta = (contact: VisitFormContactOption) =>
  [contact.role, contact.phone, contact.email].filter(Boolean).join(' / ');

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
  const [followUpDate, setFollowUpDate] = useState(initialValues?.followUpDate ?? '');

  const agencySearchText = normalize(agencySearch);
  const wholesaleSearchText = normalize(wholesaleSearch);
  const contactSearchText = normalize(contactSearch);
  const selectedAgency = agencies.find((agency) => agency.id === agencyId);
  const selectedWholesaleAccount = wholesaleAccounts.find((account) => account.id === wholesaleAccountId);
  const selectedContact = contacts.find((contact) => contact.id === contactId);

  const visibleAgencies = useMemo(
    () =>
      withSelected(
        agencies
          .filter((agency) =>
            includesSearch(agencySearchText, agency.name, agency.agencyId, agency.city, agency.county, agency.phone),
          )
          .slice(0, 8),
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
          .slice(0, 8),
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

    return withSelected(
      scopedContacts
        .filter((contact) => includesSearch(contactSearchText, contact.name, contact.role, contact.phone, contact.email))
        .slice(0, 8),
      selectedContact,
    );
  }, [agencyId, contactSearchText, contacts, locationType, selectedAgency, selectedContact, wholesaleAccountId]);

  const handleLocationTypeChange = (nextLocationType: VisitLocationType) => {
    setLocationType(nextLocationType);
    setContactId('');

    if (nextLocationType === 'agency') {
      setWholesaleAccountId('');
    } else {
      setAgencyId('');
    }
  };

  return (
    <form action={action} className="visit-form field-visit-form" encType="multipart/form-data">
      <input name="formOrigin" readOnly type="hidden" value={formOrigin} />
      <input name="locationType" readOnly type="hidden" value={locationType} />
      <input name="agencyId" readOnly type="hidden" value={locationType === 'agency' ? agencyId : ''} />
      <input
        name="wholesaleAccountId"
        readOnly
        type="hidden"
        value={locationType === 'wholesale' ? wholesaleAccountId : ''}
      />
      <input name="contactId" readOnly type="hidden" value={contactId} />
      {worklistItemId ? <input name="worklistItemId" readOnly type="hidden" value={worklistItemId} /> : null}

      <fieldset className="visit-step">
        <legend>1. Pick the location</legend>
        <div className="segmented-control" role="group" aria-label="Location type">
          <button
            aria-pressed={locationType === 'agency'}
            className={locationType === 'agency' ? 'is-active' : ''}
            type="button"
            onClick={() => handleLocationTypeChange('agency')}
          >
            Agency
          </button>
          <button
            aria-pressed={locationType === 'wholesale'}
            className={locationType === 'wholesale' ? 'is-active' : ''}
            type="button"
            onClick={() => handleLocationTypeChange('wholesale')}
          >
            Wholesale
          </button>
        </div>

        {locationType === 'agency' ? (
          <div className="search-select">
            <label>Find agency</label>
            <input
              aria-label="Search agencies"
              placeholder="Search name, agency ID, city, phone"
              type="search"
              value={agencySearch}
              onChange={(event) => setAgencySearch(event.target.value)}
            />
            <div className="quick-picker-list">
              {visibleAgencies.map((agency) => (
                <button
                  className={agency.id === agencyId ? 'quick-picker is-selected' : 'quick-picker'}
                  key={agency.id}
                  type="button"
                  onClick={() => {
                    setAgencyId(agency.id);
                    setContactId('');
                  }}
                >
                  <strong>{agency.name}</strong>
                  <span>{getAgencyMeta(agency)}</span>
                </button>
              ))}
            </div>
            {selectedAgency ? <p className="selected-note">Selected: {selectedAgency.name}</p> : null}
          </div>
        ) : (
          <div className="search-select">
            <label>Find wholesale account</label>
            <input
              aria-label="Search wholesale accounts"
              placeholder="Search name, licensee ID, city, phone"
              type="search"
              value={wholesaleSearch}
              onChange={(event) => setWholesaleSearch(event.target.value)}
            />
            <div className="quick-picker-list">
              {visibleWholesaleAccounts.map((account) => (
                <button
                  className={account.id === wholesaleAccountId ? 'quick-picker is-selected' : 'quick-picker'}
                  key={account.id}
                  type="button"
                  onClick={() => {
                    setWholesaleAccountId(account.id);
                    setContactId('');
                  }}
                >
                  <strong>{account.name}</strong>
                  <span>{getWholesaleMeta(account)}</span>
                </button>
              ))}
            </div>
            {selectedWholesaleAccount ? (
              <p className="selected-note">Selected: {selectedWholesaleAccount.name}</p>
            ) : (
              <details className="compact-details">
                <summary>Create a new wholesale account</summary>
                <div className="form-grid">
                  <input name="newWholesaleLicenseeId" placeholder="Licensee ID" />
                  <input name="newWholesaleName" placeholder="Account name" />
                  <input name="newWholesalePhone" placeholder="Phone" />
                  <input name="newWholesaleCity" placeholder="City" />
                </div>
                <details className="compact-details nested-details">
                  <summary>More account details</summary>
                  <div className="form-grid">
                    <input name="newWholesaleAgencyId" placeholder="Agency ID" />
                    <input name="newWholesaleAddress" placeholder="Address" />
                    <input name="newWholesaleCounty" placeholder="County" />
                    <input name="newWholesaleZip" placeholder="Zip" />
                    <input name="newWholesaleOwnership" placeholder="Ownership" />
                    <input name="newWholesaleDistrictId" placeholder="District ID" />
                    <input name="newWholesaleDeliveryDay" placeholder="Delivery Day" />
                  </div>
                </details>
                {tags.length > 0 ? (
                  <details className="compact-details nested-details">
                    <summary>Apply tags</summary>
                    <div className="tag-checkbox-grid">
                      {tags.map((tag) => (
                        <label className="tag-checkbox" key={tag.id}>
                          <input name="newWholesaleTagId" type="checkbox" value={tag.id} />
                          <span className="tag-swatch" style={{ backgroundColor: tag.color ?? '#7c9cff' }} />
                          <span>{tag.name}</span>
                        </label>
                      ))}
                    </div>
                  </details>
                ) : null}
              </details>
            )}
          </div>
        )}
      </fieldset>

      <details className="compact-details cardless-details">
        <summary>{selectedContact ? `Contact: ${selectedContact.name}` : 'Contact optional'}</summary>
        <div className="search-select">
          <label>Find contact</label>
          <input
            aria-label="Search contacts"
            placeholder="Search contacts for this account"
            type="search"
            value={contactSearch}
            onChange={(event) => setContactSearch(event.target.value)}
          />
          {visibleContacts.length > 0 ? (
            <div className="quick-picker-list">
              {visibleContacts.map((contact) => (
                <button
                  className={contact.id === contactId ? 'quick-picker is-selected' : 'quick-picker'}
                  key={contact.id}
                  type="button"
                  onClick={() => setContactId(contact.id)}
                >
                  <strong>{contact.name}</strong>
                  <span>{getContactMeta(contact) || 'Contact'}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="field-note">Select a location to see saved contacts.</p>
          )}
        </div>

        <label>Create contact</label>
        <div className="form-grid">
          <input name="newContactName" placeholder="Contact name" />
          <input name="newContactPhone" placeholder="Contact phone" />
        </div>
      </details>

      <fieldset className="visit-step">
        <legend>2. Tap what happened</legend>
        <p className="field-note">Visit activity will be recorded as {actorName}.</p>
        <div className="quick-chip-grid">
          {quickOutcomes.map((outcome) => (
            <label className="quick-chip" key={outcome}>
              <input name="quickOutcome" type="checkbox" value={outcome} />
              <span>{outcome}</span>
            </label>
          ))}
        </div>

        <label>Short note</label>
        <textarea
          name="summary"
          rows={2}
          placeholder="Optional dictated note or context"
          defaultValue={initialValues?.summary ?? ''}
        />

        <details className="compact-details nested-details">
          <summary>More notes</summary>
          <label>Outcomes</label>
          <textarea
            name="outcomes"
            rows={2}
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
        </details>
      </fieldset>

      <fieldset className="visit-step">
        <legend>3. Follow-up and photo</legend>
        <label>Follow-up date</label>
        <div className="quick-chip-grid">
          {quickFollowUps.map((option) => (
            <button
              className={followUpDate === getFollowUpDate(option.days) ? 'quick-date is-selected' : 'quick-date'}
              key={option.label}
              type="button"
              onClick={() => setFollowUpDate(getFollowUpDate(option.days))}
            >
              {option.label}
            </button>
          ))}
          <button className="quick-date secondary" type="button" onClick={() => setFollowUpDate('')}>
            None
          </button>
        </div>
        <input
          name="followUpDate"
          type="date"
          value={followUpDate}
          onChange={(event) => setFollowUpDate(event.target.value)}
        />

        <div className="photo-entry fast-photo-entry">
          <h3>Main photo</h3>
          <select name="photoType" defaultValue="DISPLAY" aria-label="Photo type">
            {photoTypes.map((photoType) => (
              <option key={photoType.value} value={photoType.value}>
                {photoType.label}
              </option>
            ))}
          </select>
          <input name="photoFile" type="file" accept="image/*" capture="environment" />
          <input name="photoUrl" readOnly type="hidden" value="" />
          <input name="photoCaption" placeholder="Caption" />
        </div>

        <details className="compact-details nested-details">
          <summary>Add more photos or a URL</summary>
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
              <input name="photoFile" type="file" accept="image/*" capture="environment" />
              <input name="photoUrl" type="url" placeholder="Or paste existing photo URL" />
              <input name="photoCaption" placeholder="Caption or note" />
            </div>
          ))}
        </details>
      </fieldset>

      <div className="visit-submit-bar">
        <button type="submit">{submitLabel}</button>
      </div>
    </form>
  );
}
