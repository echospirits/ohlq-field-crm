'use client';

import { useEffect, useMemo, useState } from 'react';
import { addEasternCalendarDays, EASTERN_TIME_ZONE } from '../../lib/dateTime';
import { formatDistanceMiles } from '../../lib/location/distance';
import type { NearbyAccount } from '../../lib/location/nearbyAccounts';
import type { VisitLocationType } from '../../lib/visitPickerOptions';
import {
  getMatchingVisitWorklistItems,
  getVisitOutcomes,
  type VisitFollowUpMode,
  type VisitWorklistCandidate,
} from '../../lib/visitWorkflow';
import { DatePickerField } from '../components/DatePickerField';
import { useCurrentLocation } from '../components/useCurrentLocation';
import { VoiceVisitNotePanel } from './VoiceVisitNotePanel';
import { VisitSubmitButton } from './VisitSubmitButton';
import { useVisitPhotoFormAction } from './clientPhotoUpload';

const photoSlots = [1, 2, 3] as const;

export type { VisitLocationType };

export type VisitFormAgencyOption = {
  id: string;
  agencyId: string;
  lastVisitAt: string | null;
  name: string;
  city: string | null;
  county: string | null;
  phone: string | null;
  distanceMiles?: number;
};

export type VisitFormWholesaleOption = {
  id: string;
  licenseeId: string;
  lastVisitAt: string | null;
  name: string;
  agencyId: string | null;
  city: string | null;
  county: string | null;
  phone: string | null;
  distanceMiles?: number;
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

export type VisitFormUserOption = {
  id: string;
  name: string;
};

type VisitFormInitialValues = {
  locationType?: VisitLocationType;
  locationName?: string | null;
  locationLocked?: boolean;
  agencyId?: string | null;
  wholesaleAccountId?: string | null;
  contactId?: string | null;
  summary?: string | null;
  outcomeCodes?: string[];
  outcomes?: string | null;
  nextStep?: string | null;
  followUpMode?: VisitFollowUpMode;
  followUpDate?: string | null;
  followUpTime?: string | null;
  followUpAssignedToUserId?: string | null;
  startVoiceNote?: boolean;
  opportunityId?: string | null;
  agencyProductIntelligenceId?: string | null;
  productItemCode?: string | null;
  productName?: string | null;
  sourceType?: string | null;
  sourceLabel?: string | null;
  reason?: string | null;
  returnTo?: string | null;
};

type LogVisitFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  agencies: VisitFormAgencyOption[];
  wholesaleAccounts: VisitFormWholesaleOption[];
  contacts: VisitFormContactOption[];
  tags?: VisitFormTagOption[];
  actorName: string;
  assignedWorklistItems?: VisitWorklistCandidate[];
  currentUserId?: string;
  users?: VisitFormUserOption[];
  formOrigin?: 'visits' | 'worklist';
  worklistItemId?: string;
  initialValues?: VisitFormInitialValues;
  mode?: 'create' | 'edit';
  submitLabel?: string;
};

const normalize = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();
const searchable = (...values: Array<string | null | undefined>) => normalize(values.filter(Boolean).join(' '));
const includesSearch = (searchText: string, ...values: Array<string | null | undefined>) =>
  !searchText || searchable(...values).includes(searchText);
const withSelected = <T extends { id: string }>(items: T[], selected: T | undefined) =>
  selected && !items.some((item) => item.id === selected.id) ? [selected, ...items] : items;

const getAgencyMeta = (agency: VisitFormAgencyOption) =>
  [agency.agencyId, agency.city, agency.phone].filter(Boolean).join(' / ');
const getWholesaleMeta = (account: VisitFormWholesaleOption) =>
  [account.licenseeId, account.city, account.phone].filter(Boolean).join(' / ');
const getContactMeta = (contact: VisitFormContactOption) =>
  [contact.role, contact.phone, contact.email].filter(Boolean).join(' / ');

const lastVisitFormatter = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  timeZone: EASTERN_TIME_ZONE,
});
const getLastVisitLabel = (lastVisitAt: string | null) =>
  lastVisitAt ? `Visited ${lastVisitFormatter.format(new Date(lastVisitAt))}` : 'Not visited yet';

export function LogVisitForm({
  action,
  agencies,
  wholesaleAccounts,
  contacts,
  tags = [],
  actorName,
  assignedWorklistItems = [],
  currentUserId,
  users = [],
  formOrigin = 'visits',
  worklistItemId,
  initialValues,
  mode = 'create',
  submitLabel = 'Save visit',
}: LogVisitFormProps) {
  const [locationType, setLocationType] = useState<VisitLocationType>(initialValues?.locationType ?? 'wholesale');
  const [agencyId, setAgencyId] = useState(initialValues?.agencyId ?? '');
  const [wholesaleAccountId, setWholesaleAccountId] = useState(initialValues?.wholesaleAccountId ?? '');
  const [isChangingLocation, setIsChangingLocation] = useState(!initialValues?.locationLocked);
  const [contactId, setContactId] = useState(initialValues?.contactId ?? '');
  const [locationSearch, setLocationSearch] = useState('');
  const [contactSearch, setContactSearch] = useState('');
  const [summary, setSummary] = useState(initialValues?.summary ?? '');
  const [selectedOutcomes, setSelectedOutcomes] = useState(initialValues?.outcomeCodes ?? []);
  const [legacyOutcomes, setLegacyOutcomes] = useState(initialValues?.outcomes ?? '');
  const [followUpMode, setFollowUpMode] = useState<VisitFollowUpMode>(initialValues?.followUpMode ?? 'none');
  const [followUpText, setFollowUpText] = useState(initialValues?.nextStep ?? '');
  const [followUpDate, setFollowUpDate] = useState(initialValues?.followUpDate ?? '');
  const [followUpTime, setFollowUpTime] = useState(initialValues?.followUpTime ?? '');
  const [followUpAssignedToUserId, setFollowUpAssignedToUserId] = useState(
    initialValues?.followUpAssignedToUserId ?? currentUserId ?? '',
  );
  const [isVoiceNoteOpen, setIsVoiceNoteOpen] = useState(initialValues?.startVoiceNote ?? false);
  const [submissionKey, setSubmissionKey] = useState('');
  const [newWholesaleName, setNewWholesaleName] = useState('');
  const [agencySearchResults, setAgencySearchResults] = useState<VisitFormAgencyOption[]>([]);
  const [wholesaleSearchResults, setWholesaleSearchResults] = useState<VisitFormWholesaleOption[]>([]);
  const [resolvedLocationSearch, setResolvedLocationSearch] = useState('');
  const [isLocationSearching, setIsLocationSearching] = useState(false);
  const [locationSearchError, setLocationSearchError] = useState<string | null>(null);
  const [nearbyAgencies, setNearbyAgencies] = useState<VisitFormAgencyOption[]>([]);
  const [nearbyWholesaleAccounts, setNearbyWholesaleAccounts] = useState<VisitFormWholesaleOption[]>([]);
  const { location: currentLocation, requestLocation, status: locationStatus } = useCurrentLocation();
  const { formAction, photoUploadError } = useVisitPhotoFormAction(action);

  useEffect(() => {
    setSubmissionKey(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  }, []);

  useEffect(() => {
    const query = locationSearch.trim();
    const searchKey = `${locationType}:${normalize(query)}`;

    if (query.length < 2) {
      setIsLocationSearching(false);
      setLocationSearchError(null);
      setResolvedLocationSearch('');
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsLocationSearching(true);
      setLocationSearchError(null);

      try {
        const params = new URLSearchParams({ q: query, type: locationType });
        if (currentLocation) {
          params.set('latitude', String(currentLocation.latitude));
          params.set('longitude', String(currentLocation.longitude));
        }
        const response = await fetch(
          `/api/visits/account-search?${params}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error(`Account search failed with status ${response.status}.`);

        const data = (await response.json()) as {
          results: VisitFormAgencyOption[] | VisitFormWholesaleOption[];
        };
        if (locationType === 'agency') setAgencySearchResults(data.results as VisitFormAgencyOption[]);
        else setWholesaleSearchResults(data.results as VisitFormWholesaleOption[]);
        setResolvedLocationSearch(searchKey);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('Visit account search failed', error);
        setLocationSearchError('Account search is unavailable. Try again.');
      } finally {
        if (!controller.signal.aborted) setIsLocationSearching(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [currentLocation, locationSearch, locationType]);

  useEffect(() => {
    if (!currentLocation) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      latitude: String(currentLocation.latitude),
      longitude: String(currentLocation.longitude),
      type: locationType,
    });
    fetch(`/api/accounts/nearby?${params}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`Nearby lookup failed: ${response.status}`)))
      .then((data: { results: NearbyAccount[] }) => {
        if (locationType === 'agency') {
          setNearbyAgencies(data.results.map((account) => ({
            agencyId: account.agencyId ?? '', city: account.city, county: account.county,
            distanceMiles: account.distanceMiles, id: account.id, lastVisitAt: account.lastVisitAt,
            name: account.name, phone: account.phone,
          })));
        } else {
          setNearbyWholesaleAccounts(data.results.map((account) => ({
            agencyId: account.agencyId, city: account.city, county: account.county,
            distanceMiles: account.distanceMiles, id: account.id, lastVisitAt: account.lastVisitAt,
            licenseeId: account.licenseeId ?? '', name: account.name, phone: account.phone,
          })));
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) console.error(error);
      });
    return () => controller.abort();
  }, [currentLocation, locationType]);

  const searchText = normalize(locationSearch);
  const contactSearchText = normalize(contactSearch);
  const selectedAgency =
    nearbyAgencies.find((agency) => agency.id === agencyId) ??
    agencySearchResults.find((agency) => agency.id === agencyId) ??
    agencies.find((agency) => agency.id === agencyId) ??
    (locationType === 'agency' && agencyId && initialValues?.locationName
      ? { id: agencyId, agencyId: '', lastVisitAt: null, name: initialValues.locationName, city: null, county: null, phone: null }
      : undefined);
  const selectedWholesaleAccount =
    nearbyWholesaleAccounts.find((account) => account.id === wholesaleAccountId) ??
    wholesaleSearchResults.find((account) => account.id === wholesaleAccountId) ??
    wholesaleAccounts.find((account) => account.id === wholesaleAccountId) ??
    (locationType === 'wholesale' && wholesaleAccountId && initialValues?.locationName
      ? { id: wholesaleAccountId, licenseeId: '', lastVisitAt: null, name: initialValues.locationName, agencyId: null, city: null, county: null, phone: null }
      : undefined);
  const selectedLocation = locationType === 'agency' ? selectedAgency : selectedWholesaleAccount;
  const selectedContact = contacts.find((contact) => contact.id === contactId);
  const locationSearchKey = `${locationType}:${searchText}`;
  const hasResolvedLocationSearch = resolvedLocationSearch === locationSearchKey;
  const visibleLocations = useMemo(() => {
    const initialOptions = locationType === 'agency' ? agencies : wholesaleAccounts;
    const searchedOptions = locationType === 'agency' ? agencySearchResults : wholesaleSearchResults;
    const options = searchText.length >= 2
      ? hasResolvedLocationSearch
        ? searchedOptions
        : []
      : initialOptions.slice(0, 5);

    const nearbyIds = new Set(
      (locationType === 'agency' ? nearbyAgencies : nearbyWholesaleAccounts).map((item) => item.id),
    );
    return withSelected(
      searchText.length >= 2 ? options : options.filter((item) => !nearbyIds.has(item.id)),
      selectedLocation,
    );
  }, [
    agencies,
    agencySearchResults,
    hasResolvedLocationSearch,
    locationType,
    nearbyAgencies,
    nearbyWholesaleAccounts,
    searchText,
    selectedLocation,
    wholesaleAccounts,
    wholesaleSearchResults,
  ]);
  const nearbyLocations = locationType === 'agency' ? nearbyAgencies : nearbyWholesaleAccounts;
  const selectLocation = (location: VisitFormAgencyOption | VisitFormWholesaleOption) => {
    if (locationType === 'agency') setAgencyId(location.id);
    else setWholesaleAccountId(location.id);
    setContactId('');
    setIsChangingLocation(false);
  };
  const visibleContacts = useMemo(() => {
    const agencyKeys = new Set([selectedAgency?.id, selectedAgency?.agencyId, agencyId].filter(Boolean));
    const scopedContacts = contacts.filter((contact) =>
      locationType === 'agency'
        ? !!contact.agencyId && agencyKeys.has(contact.agencyId)
        : !!wholesaleAccountId && contact.wholesaleAccountId === wholesaleAccountId,
    );
    return withSelected(
      scopedContacts
        .filter((contact) => includesSearch(contactSearchText, contact.name, contact.role, contact.phone, contact.email))
        .slice(0, 6),
      selectedContact,
    );
  }, [agencyId, contactSearchText, contacts, locationType, selectedAgency, selectedContact, wholesaleAccountId]);

  const outcomeOptions = getVisitOutcomes(locationType);
  const voiceAccountContext = selectedLocation
    ? {
        id: selectedLocation.id,
        name: selectedLocation.name,
        identifier: 'licenseeId' in selectedLocation ? selectedLocation.licenseeId : selectedLocation.agencyId,
        city: selectedLocation.city,
        phone: selectedLocation.phone,
      }
    : null;
  const hasLocation = locationType === 'agency' ? Boolean(agencyId) : Boolean(wholesaleAccountId);
  const canSave = hasLocation || (locationType === 'wholesale' && Boolean(newWholesaleName.trim()));
  const matchingWorklistItems = mode === 'create' && formOrigin === 'visits' && !isChangingLocation
    ? getMatchingVisitWorklistItems({
        agencyId,
        items: assignedWorklistItems,
        locationType,
        wholesaleAccountId,
      })
    : [];

  const handleLocationTypeChange = (nextType: VisitLocationType) => {
    setLocationType(nextType);
    setAgencyId('');
    setWholesaleAccountId('');
    setContactId('');
    setLocationSearch('');
    setResolvedLocationSearch('');
    setLocationSearchError(null);
    setSelectedOutcomes([]);
  };

  const handleFollowUpModeChange = (mode: VisitFollowUpMode) => {
    setFollowUpMode(mode);
    if (mode !== 'none' && !followUpDate) setFollowUpDate(addEasternCalendarDays(7));
    if (mode === 'none') {
      setFollowUpDate('');
      setFollowUpTime('');
      setFollowUpText('');
    }
  };

  return (
    <form action={formAction} className="visit-form field-visit-form">
      <input name="formOrigin" readOnly type="hidden" value={formOrigin} />
      <input name="locationType" readOnly type="hidden" value={locationType} />
      <input name="agencyId" readOnly type="hidden" value={locationType === 'agency' ? agencyId : ''} />
      <input name="wholesaleAccountId" readOnly type="hidden" value={locationType === 'wholesale' ? wholesaleAccountId : ''} />
      <input name="contactId" readOnly type="hidden" value={contactId} />
      <input name="outcomes" readOnly type="hidden" value={legacyOutcomes} />
      <input name="submissionKey" readOnly type="hidden" value={submissionKey} />
      {worklistItemId ? <input name="worklistItemId" readOnly type="hidden" value={worklistItemId} /> : null}
      {initialValues?.opportunityId ? <input name="opportunityId" readOnly type="hidden" value={initialValues.opportunityId} /> : null}
      {initialValues?.agencyProductIntelligenceId ? <input name="agencyProductIntelligenceId" readOnly type="hidden" value={initialValues.agencyProductIntelligenceId} /> : null}
      {initialValues?.productItemCode ? <input name="productItemCode" readOnly type="hidden" value={initialValues.productItemCode} /> : null}
      {initialValues?.productName ? <input name="productName" readOnly type="hidden" value={initialValues.productName} /> : null}
      {initialValues?.sourceType ? <input name="sourceType" readOnly type="hidden" value={initialValues.sourceType} /> : null}
      {initialValues?.sourceLabel ? <input name="sourceLabel" readOnly type="hidden" value={initialValues.sourceLabel} /> : null}
      {initialValues?.reason ? <input name="contextReason" readOnly type="hidden" value={initialValues.reason} /> : null}
      {initialValues?.returnTo ? <input name="returnTo" readOnly type="hidden" value={initialValues.returnTo} /> : null}
      {photoUploadError ? <p className="toast-notice page-status" role="alert">{photoUploadError}</p> : null}

      {initialValues?.sourceLabel || initialValues?.productName ? <div className="action-context-summary visit-action-context">
        <span className="page-eyebrow">Started from context</span>
        <strong>{initialValues.sourceLabel ?? initialValues.productName}</strong>
        {initialValues.productItemCode && initialValues.productName ? <span>{initialValues.productItemCode} - {initialValues.productName}</span> : null}
        {initialValues.reason ? <small>{initialValues.reason}</small> : null}
      </div> : null}

      <fieldset className="visit-step visit-account-step">
        <legend>Account</legend>
        {!isChangingLocation && selectedLocation ? (
          <div className="selected-location-card">
            <div>
              <span>{locationType === 'agency' ? 'Agency' : 'Wholesale'}</span>
              <strong>{selectedLocation.name}</strong>
            </div>
            <button className="secondary compact-btn" type="button" onClick={() => setIsChangingLocation(true)}>Change</button>
          </div>
        ) : (
          <>
            <div className="segmented-control" role="group" aria-label="Visit type">
              {(['wholesale', 'agency'] as const).map((type) => (
                <button
                  aria-pressed={locationType === type}
                  className={locationType === type ? 'is-active' : ''}
                  key={type}
                  type="button"
                  onClick={() => handleLocationTypeChange(type)}
                >
                  {type === 'wholesale' ? 'Wholesale' : 'Agency'}
                </button>
              ))}
            </div>
            <div className="search-select">
              <label htmlFor="visit-location-search">Find {locationType === 'agency' ? 'agency' : 'wholesale account'}</label>
              <input
                id="visit-location-search"
                placeholder="Search name, ID, city, or phone"
                type="search"
                value={locationSearch}
                onChange={(event) => setLocationSearch(event.target.value)}
              />
              {!searchText ? <p className="field-note">Recently visited first. Type at least 2 characters to search every account.</p> : null}
              {searchText.length === 1 ? <p className="field-note">Enter one more character to search every account.</p> : null}
              {isLocationSearching ? <p aria-live="polite" className="field-note">Searching all {locationType} accounts…</p> : null}
              {locationSearchError ? <p className="field-note danger-text" role="alert">{locationSearchError}</p> : null}
              {searchText.length >= 2 && hasResolvedLocationSearch && visibleLocations.length === 0 ? (
                <p className="field-note">No {locationType} accounts match “{locationSearch.trim()}”.</p>
              ) : null}
              {!searchText && locationStatus !== 'ready' ? (
                <div className="nearby-location-control visit-nearby-control">
                  <button className="secondary compact-btn" disabled={locationStatus === 'loading'} onClick={requestLocation} type="button">
                    {locationStatus === 'loading' ? 'Finding nearby accounts…' : 'Use my location to show nearby accounts'}
                  </button>
                  {locationStatus === 'denied' || locationStatus === 'unavailable' ? (
                    <span className="field-note">Location unavailable. Recent accounts are shown instead.</span>
                  ) : null}
                </div>
              ) : null}
              {!searchText && nearbyLocations.length > 0 ? (
                <>
                  <div className="quick-picker-section-label">Nearby</div>
                  <div className="quick-picker-list nearby-picker-list">
                    {nearbyLocations.map((location) => (
                      <button className="quick-picker account-picker-option" key={`nearby-${location.id}`} type="button" onClick={() => selectLocation(location)}>
                        <strong>{location.name}</strong>
                        <span>{'licenseeId' in location ? getWholesaleMeta(location) : getAgencyMeta(location)}</span>
                        <span className="quick-picker-last">
                          {location.distanceMiles === undefined ? '' : `${currentLocation && currentLocation.accuracy > 1609 ? `${Math.round(location.distanceMiles)} mi` : formatDistanceMiles(location.distanceMiles)} • `}
                          {getLastVisitLabel(location.lastVisitAt)}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="quick-picker-section-label">Recent</div>
                </>
              ) : null}
              <div className="quick-picker-list">
                {visibleLocations.map((location) => (
                  <button
                    className={location.id === selectedLocation?.id ? 'quick-picker account-picker-option is-selected' : 'quick-picker account-picker-option'}
                    key={location.id}
                    type="button"
                    onClick={() => selectLocation(location)}
                  >
                    <strong>{location.name}</strong>
                    <span>{'licenseeId' in location ? getWholesaleMeta(location) : getAgencyMeta(location)}</span>
                    <span className="quick-picker-last">{getLastVisitLabel(location.lastVisitAt)}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </fieldset>

      {matchingWorklistItems.length > 0 ? (
        <fieldset className="visit-step visit-worklist-prompt">
          <legend>Complete existing follow-up?</legend>
          <p className="field-note">This account already has follow-up assigned to you. Choose what should happen when this visit is saved.</p>
          <div className="worklist-completion-list">
            {matchingWorklistItems.map((item) => (
              <div className="worklist-completion-item" key={item.id}>
                <strong>{item.title}</strong>
                <div className="worklist-completion-choice-grid">
                  <label className="follow-up-choice">
                    <input name={`worklistCompletion:${item.id}`} required type="radio" value="complete" />
                    <span>Yes, complete</span>
                  </label>
                  <label className="follow-up-choice">
                    <input name={`worklistCompletion:${item.id}`} required type="radio" value="leave-open" />
                    <span>No, leave open</span>
                  </label>
                </div>
              </div>
            ))}
          </div>
        </fieldset>
      ) : null}

      <fieldset className="visit-step visit-outcome-step">
        <legend>What happened?</legend>
        <div className="visit-outcome-grid">
          {outcomeOptions.map((outcome) => (
            <label className="visit-outcome-chip" key={outcome.code}>
              <input
                checked={selectedOutcomes.includes(outcome.code)}
                name="outcomeCode"
                type="checkbox"
                value={outcome.code}
                onChange={(event) => {
                  setSelectedOutcomes((current) => {
                    if (!event.target.checked) return current.filter((code) => code !== outcome.code);
                    if (outcome.code === 'follow-up-needed') return [...current.filter((code) => code !== 'no-action-needed'), outcome.code];
                    if (outcome.code === 'no-action-needed') return [...current.filter((code) => code !== 'follow-up-needed'), outcome.code];
                    return [...current, outcome.code];
                  });
                  if (outcome.code === 'follow-up-needed' && event.target.checked && followUpMode === 'none') {
                    handleFollowUpModeChange('task');
                  }
                  if (outcome.code === 'no-action-needed' && event.target.checked) handleFollowUpModeChange('none');
                }}
              />
              <span>{outcome.label}</span>
            </label>
          ))}
        </div>
        <label htmlFor="visit-notes">Visit notes <span className="optional-label">Optional</span></label>
        <textarea
          id="visit-notes"
          name="summary"
          rows={3}
          placeholder="Key conversation, product interest, or anything worth remembering"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />
      </fieldset>

      <fieldset className="visit-step visit-follow-up-step">
        <legend>Next step</legend>
        <div className="follow-up-choice-grid">
          {([
            ['none', 'No follow-up'],
            ['task', 'Save next step'],
          ] as const).map(([mode, label]) => (
            <label className="follow-up-choice" key={mode}>
              <input checked={followUpMode === mode} name="followUpMode" type="radio" value={mode} onChange={() => handleFollowUpModeChange(mode)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        {followUpMode !== 'none' ? (
          <div className="follow-up-fields">
            <label htmlFor="follow-up-text">What needs to happen?</label>
            <input
              id="follow-up-text"
              name="nextStep"
              placeholder="Send pricing, check inventory, schedule tasting…"
              value={followUpText}
              onChange={(event) => setFollowUpText(event.target.value)}
            />
            <DatePickerField
              name="followUpDate"
              pickerLabel="Due date"
              value={followUpDate}
              onChange={(event) => setFollowUpDate(event.target.value)}
            />
            <label htmlFor="follow-up-time">Time <span className="optional-label">Optional</span></label>
            <input
              id="follow-up-time"
              name="followUpTime"
              type="time"
              value={followUpTime}
              onChange={(event) => setFollowUpTime(event.target.value)}
            />
            <label htmlFor="follow-up-assignee">
              Responsible person
              <select
                id="follow-up-assignee"
                name="followUpAssignedToUserId"
                required
                value={followUpAssignedToUserId}
                onChange={(event) => setFollowUpAssignedToUserId(event.target.value)}
              >
                {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
              </select>
              {users.length === 0 ? <span className="task-preview">Assigned to {actorName}</span> : null}
            </label>
          </div>
        ) : null}
      </fieldset>

      <details className="visit-details">
        <summary>Add details <span>Contact, voice note, photo, or new account</span></summary>
        <div className="visit-details-content">
          {mode === 'create' ? <details
            className="compact-details nested-details"
            open={isVoiceNoteOpen}
            onToggle={(event) => setIsVoiceNoteOpen(event.currentTarget.open)}
          >
            <summary>Dictate and structure a visit note</summary>
            <VoiceVisitNotePanel
              accountContext={voiceAccountContext}
              nextStep={followUpText}
              outcomes={legacyOutcomes}
              setNextStep={(value) => {
                setFollowUpText(value);
                if (value && followUpMode === 'none') handleFollowUpModeChange('task');
              }}
              setOutcomes={setLegacyOutcomes}
              setSummary={setSummary}
              summary={summary}
              visitType={locationType}
            />
          </details> : null}

          <details className="compact-details nested-details">
            <summary>{selectedContact ? `Contact: ${selectedContact.name}` : 'Add a contact'}</summary>
            <label htmlFor="visit-contact-search">Saved contacts</label>
            <input id="visit-contact-search" placeholder="Search contacts" type="search" value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} />
            {visibleContacts.length > 0 ? (
              <div className="quick-picker-list">
                {visibleContacts.map((contact) => (
                  <button className={contact.id === contactId ? 'quick-picker is-selected' : 'quick-picker'} key={contact.id} type="button" onClick={() => setContactId(contact.id)}>
                    <strong>{contact.name}</strong><span>{getContactMeta(contact) || 'Contact'}</span>
                  </button>
                ))}
              </div>
            ) : <p className="field-note">Choose an account to see its contacts.</p>}
            {mode === 'create' ? <div className="form-grid">
              <input aria-label="New contact name" name="newContactName" placeholder="Or enter a new contact name" />
              <input aria-label="New contact phone" name="newContactPhone" placeholder="Phone (optional)" />
            </div> : null}
          </details>

          {mode === 'create' && locationType === 'wholesale' && !wholesaleAccountId ? (
            <details className="compact-details nested-details">
              <summary>Create a wholesale account</summary>
              <div className="form-grid">
                <input name="newWholesaleName" placeholder="Account name" value={newWholesaleName} onChange={(event) => setNewWholesaleName(event.target.value)} />
                <input name="newWholesaleLicenseeId" placeholder="Licensee ID (optional)" />
                <input name="newWholesalePhone" placeholder="Phone (optional)" />
                <input name="newWholesaleCity" placeholder="City (optional)" />
              </div>
              {tags.length > 0 ? (
                <div className="tag-checkbox-grid">
                  {tags.map((tag) => (
                    <label className="tag-checkbox" key={tag.id}>
                      <input name="newWholesaleTagId" type="checkbox" value={tag.id} />
                      <span className="tag-swatch" style={{ backgroundColor: tag.color ?? '#7c9cff' }} />
                      <span>{tag.name}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </details>
          ) : null}

          {mode === 'create' ? <details className="compact-details nested-details">
            <summary>Add photo proof</summary>
            {photoSlots.map((slot) => (
              <div className="photo-entry streamlined-photo-entry" key={slot}>
                <input name="photoType" readOnly type="hidden" value="OTHER" />
                <label htmlFor={`visit-photo-${slot}`}>{slot === 1 ? 'Photo' : `Additional photo ${slot}`}</label>
                <input id={`visit-photo-${slot}`} name="photoFile" type="file" accept="image/*" />
                <input name="photoUrl" readOnly type="hidden" value="" />
                <input aria-label={`Photo ${slot} caption`} name="photoCaption" placeholder="Caption (optional)" />
              </div>
            ))}
          </details> : null}
        </div>
      </details>

      <div className="visit-submit-bar">
        <VisitSubmitButton disabled={!canSave} label={submitLabel} />
        {!canSave ? <p>Select an account to save.</p> : null}
      </div>
    </form>
  );
}
