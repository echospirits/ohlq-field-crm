'use client';

import { VisitDraft } from './VisitDraft';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { WholesaleAddressFields } from '../components/WholesaleAddressFields';
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
import { VisitSubmitButton } from './VisitSubmitButton';
import { useVisitPhotoFormAction } from './clientPhotoUpload';
import { beginVisitTiming, finishVisitTiming, markVisitResponse } from './visitTimingClient';

const photoCategories = [
  ['OTHER', 'Other'],
  ['SHELF', 'Shelf'],
  ['DISPLAY', 'Display'],
  ['MENU', 'Menu'],
  ['BACK_BAR', 'Back bar'],
  ['COMPETITOR', 'Competitor'],
] as const;

type VisitPhoto = { id: number; file: File; category: string; caption: string };

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
  active: boolean;
  isPrimary: boolean;
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
  eventId?: string;
  locationType?: VisitLocationType;
  locationName?: string | null;
  locationLocked?: boolean;
  agencyId?: string | null;
  wholesaleAccountId?: string | null;
  contactId?: string | null;
  contactIds?: string[];
  summary?: string | null;
  outcomeCodes?: string[];
  outcomes?: string | null;
  nextStep?: string | null;
  followUpMode?: VisitFollowUpMode;
  followUpDate?: string | null;
  followUpTime?: string | null;
  followUpAssignedToUserId?: string | null;
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
  organizationId?: string;
  visitGuides?: Array<{accountType:string;name:string;questions:string[]}>;
  action: (formData: FormData) => void | Promise<void>;
  agencies: VisitFormAgencyOption[];
  wholesaleAccounts: VisitFormWholesaleOption[];
  contacts: VisitFormContactOption[];
  loadSelectedAccountContacts?: boolean;
  loadPickerSuggestions?: boolean;
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
  salesStatusOptions?: Array<{ label: string; value: string }>;
  targetedAgencyIds?: string[];
  targetedWholesaleAccountIds?: string[];
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
const lastVisitFormatter = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  timeZone: EASTERN_TIME_ZONE,
});
const getLastVisitLabel = (lastVisitAt: string | null) =>
  lastVisitAt ? `Visited ${lastVisitFormatter.format(new Date(lastVisitAt))}` : 'Not visited yet';

export function LogVisitForm({
  organizationId, visitGuides = [],
  action,
  agencies,
  wholesaleAccounts,
  contacts,
  loadSelectedAccountContacts = false,
  loadPickerSuggestions = false,
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
  salesStatusOptions = [],
  targetedAgencyIds = [],
  targetedWholesaleAccountIds = [],
}: LogVisitFormProps) {
  const [interactionType, setInteractionType] = useState('PHYSICAL_VISIT');
  const physicalVisit = interactionType === 'PHYSICAL_VISIT';
  const [locationType, setLocationType] = useState<VisitLocationType>(initialValues?.locationType ?? 'wholesale');
  const [agencyId, setAgencyId] = useState(initialValues?.agencyId ?? '');
  const [wholesaleAccountId, setWholesaleAccountId] = useState(initialValues?.wholesaleAccountId ?? '');
  const [isChangingLocation, setIsChangingLocation] = useState(!initialValues?.locationLocked);
  const [contactIds, setContactIds] = useState<string[]>(initialValues?.contactIds ?? (initialValues?.contactId ? [initialValues.contactId] : []));
  const [locationSearch, setLocationSearch] = useState('');
  const [searchAttempt, setSearchAttempt] = useState(0);
  const pendingSearchRetry = useRef<string | null>(null);
  const [contactSearch, setContactSearch] = useState('');
  const [contactOptions, setContactOptions] = useState(contacts);
  const [contactLoad, setContactLoad] = useState<{ key: string; failed: boolean } | null>(null);
  const [contactRetry, setContactRetry] = useState(0);
  const [loadedContactKeys, setLoadedContactKeys] = useState<Set<string>>(() => new Set());
  const [newContact, setNewContact] = useState({ name: '', role: '', email: '', phone: '' });
  const [contactCreateStatus, setContactCreateStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [summary, setSummary] = useState(initialValues?.summary ?? '');
  const [outcomeSelection, setOutcomeSelection] = useState<string[] | null>(initialValues?.outcomeCodes ?? null);
  const [salesStatus, setSalesStatus] = useState('');
  const [followUpMode, setFollowUpMode] = useState<VisitFollowUpMode>(initialValues?.followUpMode ?? 'none');
  const [followUpText, setFollowUpText] = useState(initialValues?.nextStep ?? '');
  const [followUpDate, setFollowUpDate] = useState(initialValues?.followUpDate ?? '');
  const [followUpTime, setFollowUpTime] = useState(initialValues?.followUpTime ?? '');
  const [followUpAssignedToUserId, setFollowUpAssignedToUserId] = useState(
    initialValues?.followUpAssignedToUserId ?? currentUserId ?? '',
  );
  const [fieldError, setFieldError] = useState<'notes' | 'outcomes' | null>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const firstOutcomeRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<VisitPhoto[]>([]);
  const nextPhotoId = useRef(0);
  const photoInputId = useId();
  const [submissionKey, setSubmissionKey] = useState('');
  const [newWholesaleName, setNewWholesaleName] = useState('');
  const [agencySearchResults, setAgencySearchResults] = useState<VisitFormAgencyOption[]>([]);
  const [wholesaleSearchResults, setWholesaleSearchResults] = useState<VisitFormWholesaleOption[]>([]);
  const [resolvedLocationSearch, setResolvedLocationSearch] = useState('');
  const [isLocationSearching, setIsLocationSearching] = useState(false);
  const [locationSearchError, setLocationSearchError] = useState<string | null>(null);
  const [pickedLocation, setPickedLocation] = useState<VisitFormAgencyOption | VisitFormWholesaleOption | null>(null);
  const [pickerSuggestions, setPickerSuggestions] = useState<{ agencies: VisitFormAgencyOption[]; wholesaleAccounts: VisitFormWholesaleOption[] } | null>(null);
  const [nearbyAgencies, setNearbyAgencies] = useState<VisitFormAgencyOption[]>([]);
  const [nearbyWholesaleAccounts, setNearbyWholesaleAccounts] = useState<VisitFormWholesaleOption[]>([]);
  const { location: currentLocation, requestLocation, status: locationStatus } = useCurrentLocation();
  const { handleSubmit, pending, photoUploadError } = useVisitPhotoFormAction(
    action,
    mode === 'create' && physicalVisit,
  );

  useEffect(() => {
    setSubmissionKey(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  }, []);

  useEffect(() => {
    const query = locationSearch.trim();
    const searchKey = `${locationType}:${normalize(query)}`;
    const retried = pendingSearchRetry.current === searchKey;
    pendingSearchRetry.current = null;

    if (!isChangingLocation || query.length < 2) {
      setIsLocationSearching(false);
      setLocationSearchError(null);
      setResolvedLocationSearch('');
      return;
    }

    setIsLocationSearching(true);
    setLocationSearchError(null);
    const controller = new AbortController();
    const timing = beginVisitTiming('search');
    let finished = false;
    const responseFrame = window.requestAnimationFrame(() => markVisitResponse(timing));
    const timeout = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query, type: locationType });
        if (timing) params.set('timing', timing.id);
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
        if (controller.signal.aborted) return;
        if (locationType === 'agency') setAgencySearchResults(data.results as VisitFormAgencyOption[]);
        else setWholesaleSearchResults(data.results as VisitFormWholesaleOption[]);
        setResolvedLocationSearch(searchKey);
        finished = true;
        window.requestAnimationFrame(() => finishVisitTiming(timing, retried ? 'retry' : 'success'));
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('Visit account search failed', error);
        setLocationSearchError('Account search is unavailable. Try again.');
        finished = true;
        window.requestAnimationFrame(() => finishVisitTiming(timing, 'failed'));
      } finally {
        if (!controller.signal.aborted) setIsLocationSearching(false);
      }
    }, 150);

    return () => {
      window.cancelAnimationFrame(responseFrame);
      window.clearTimeout(timeout);
      controller.abort();
      if (!finished) finishVisitTiming(timing, 'cancelled');
    };
  }, [currentLocation, isChangingLocation, locationSearch, locationType, searchAttempt]);

  useEffect(() => {
    if (!loadPickerSuggestions || !isChangingLocation || pickerSuggestions) return;
    const controller = new AbortController();
    fetch('/api/visits/account-search?suggestions=1', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Visit suggestions could not be loaded');
        return response.json();
      })
      .then((suggestions) => {
        if (!controller.signal.aborted) setPickerSuggestions(suggestions);
      })
      .catch(() => {}); // Search remains available.
    return () => controller.abort();
  }, [isChangingLocation, loadPickerSuggestions, pickerSuggestions]);

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
  const currentAccountId = locationType === 'agency' ? agencyId : wholesaleAccountId;
  const contactKey = `${locationType}:${currentAccountId}`;
  const contactsLoaded = !loadSelectedAccountContacts || loadedContactKeys.has(contactKey);
  const contactLoadFailed = contactLoad?.key === contactKey && contactLoad.failed;
  useEffect(() => {
    if (!currentAccountId || contactsLoaded) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ id: currentAccountId, type: locationType });
    fetch(`/api/visits/account-contacts?${params}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Visit contacts could not be loaded');
        return response.json() as Promise<{ contacts: VisitFormContactOption[] }>;
      })
      .then(({ contacts: loadedContacts }) => {
        if (controller.signal.aborted) return;
        setContactOptions((options) => {
          const byId = new Map(options.map((contact) => [contact.id, contact]));
          loadedContacts.forEach((contact) => byId.set(contact.id, contact));
          return [...byId.values()];
        });
        setLoadedContactKeys((keys) => new Set([...keys, contactKey]));
        setContactLoad({ key: contactKey, failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setContactLoad({ key: contactKey, failed: true });
      });
    return () => controller.abort();
  }, [contactKey, contactRetry, contactsLoaded, currentAccountId, locationType]);

  const selectedAgency =
    (pickedLocation?.id === agencyId && !('licenseeId' in pickedLocation) ? pickedLocation : undefined) ??
    nearbyAgencies.find((agency) => agency.id === agencyId) ??
    agencySearchResults.find((agency) => agency.id === agencyId) ??
    agencies.find((agency) => agency.id === agencyId) ??
    (locationType === 'agency' && agencyId && initialValues?.locationName
      ? { id: agencyId, agencyId: '', lastVisitAt: null, name: initialValues.locationName, city: null, county: null, phone: null }
      : undefined);
  const selectedWholesaleAccount =
    (pickedLocation?.id === wholesaleAccountId && 'licenseeId' in pickedLocation ? pickedLocation : undefined) ??
    nearbyWholesaleAccounts.find((account) => account.id === wholesaleAccountId) ??
    wholesaleSearchResults.find((account) => account.id === wholesaleAccountId) ??
    wholesaleAccounts.find((account) => account.id === wholesaleAccountId) ??
    (locationType === 'wholesale' && wholesaleAccountId && initialValues?.locationName
      ? { id: wholesaleAccountId, licenseeId: '', lastVisitAt: null, name: initialValues.locationName, agencyId: null, city: null, county: null, phone: null }
      : undefined);
  const selectedLocation = locationType === 'agency' ? selectedAgency : selectedWholesaleAccount;
  const selectedContacts = contactOptions.filter((contact) => contactIds.includes(contact.id));
  const locationSearchKey = `${locationType}:${searchText}`;
  const hasResolvedLocationSearch = resolvedLocationSearch === locationSearchKey;
  const visibleLocations = useMemo(() => {
    const initialOptions = locationType === 'agency'
      ? pickerSuggestions?.agencies ?? agencies
      : pickerSuggestions?.wholesaleAccounts ?? wholesaleAccounts;
    const searchedOptions = locationType === 'agency' ? agencySearchResults : wholesaleSearchResults;
    if (searchText.length >= 2) {
      if (hasResolvedLocationSearch) return searchedOptions;
      return initialOptions.filter((option) =>
        includesSearch(searchText, option.name, option.agencyId, option.city, option.county, option.phone,
          'licenseeId' in option ? option.licenseeId : null),
      ).slice(0, 5);
    }

    const nearbyIds = new Set(
      (locationType === 'agency' ? nearbyAgencies : nearbyWholesaleAccounts).map((item) => item.id),
    );
    return withSelected(initialOptions.slice(0, 5).filter((item) => !nearbyIds.has(item.id)), selectedLocation);
  }, [
    agencies,
    agencySearchResults,
    hasResolvedLocationSearch,
    locationType,
    nearbyAgencies,
    nearbyWholesaleAccounts,
    pickerSuggestions,
    searchText,
    selectedLocation,
    wholesaleAccounts,
    wholesaleSearchResults,
  ]);
  const nearbyLocations = locationType === 'agency' ? nearbyAgencies : nearbyWholesaleAccounts;
  const selectLocation = (location: VisitFormAgencyOption | VisitFormWholesaleOption) => {
    setPickedLocation(location);
    if (locationType === 'agency') setAgencyId(location.id);
    else setWholesaleAccountId(location.id);
    setContactIds([]);
    setContactSearch('');
    setLocationSearch('');
    setResolvedLocationSearch('');
    setIsChangingLocation(false);
  };
  const visibleContacts = useMemo(() => {
    const agencyKeys = new Set([selectedAgency?.id, selectedAgency?.agencyId, agencyId].filter(Boolean));
    const scopedContacts = contactOptions.filter((contact) =>
      locationType === 'agency'
        ? !!contact.agencyId && agencyKeys.has(contact.agencyId)
        : !!wholesaleAccountId && contact.wholesaleAccountId === wholesaleAccountId,
    );
    return scopedContacts
        .filter((contact) => contact.active || contactIds.includes(contact.id))
        .filter((contact) => includesSearch(contactSearchText, contact.name, contact.role, contact.phone, contact.email))
        .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary) || left.name.localeCompare(right.name))
        .slice(0, 10);
  }, [agencyId, contactIds, contactOptions, contactSearchText, locationType, selectedAgency, wholesaleAccountId]);

  const addContactDuringVisit = async () => {
    if (!newContact.name.trim() || !hasLocation) return;
    setContactCreateStatus('saving');
    try {
      const response = await fetch('/api/contacts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: locationType === 'agency' ? agencyId : wholesaleAccountId,
          accountType: locationType === 'agency' ? 'AGENCY' : 'WHOLESALE',
          ...newContact,
        }),
      });
      if (!response.ok) throw new Error('Contact could not be saved');
      const created = await response.json() as VisitFormContactOption;
      setContactOptions((current) => [...current, created]);
      setContactIds((current) => [...current.filter((id) => id !== created.id), created.id]);
      setNewContact({ name: '', role: '', email: '', phone: '' });
      setContactCreateStatus('idle');
    } catch {
      setContactCreateStatus('error');
    }
  };

  const outcomeOptions = getVisitOutcomes(locationType);
  const standardVisit = mode === 'create' && physicalVisit;
  const selectedOutcomes = outcomeSelection ?? (
    standardVisit ? [followUpMode === 'task' ? 'follow-up-needed' : 'no-action-needed'] : []
  );
  const hasLocation = locationType === 'agency' ? Boolean(agencyId) : Boolean(wholesaleAccountId);
  const canSave = (!isChangingLocation && hasLocation) ||
    (!hasLocation && locationType === 'wholesale' && Boolean(newWholesaleName.trim()));
  const matchingWorklistItems = mode === 'create' && formOrigin === 'visits' && !isChangingLocation
    ? getMatchingVisitWorklistItems({
        agencyId,
        items: assignedWorklistItems,
        locationType,
        wholesaleAccountId,
      })
    : [];

  const handleLocationTypeChange = (nextType: VisitLocationType) => {
    if (nextType === locationType) return;
    setPickedLocation(null);
    setLocationType(nextType);
    setAgencyId('');
    setWholesaleAccountId('');
    setContactIds([]);
    setContactSearch('');
    setLocationSearch('');
    setResolvedLocationSearch('');
    setLocationSearchError(null);
    setOutcomeSelection(null);
    if (fieldError === 'outcomes') setFieldError(null);
  };

  const handleFollowUpModeChange = (mode: VisitFollowUpMode) => {
    setFollowUpMode(mode);
    if (standardVisit && mode === 'task') {
      setOutcomeSelection((current) => current?.map((code) => code === 'no-action-needed' ? 'follow-up-needed' : code) ?? null);
    }
    if (mode !== 'none' && !followUpDate) setFollowUpDate(addEasternCalendarDays(7));
    if (mode === 'none') {
      setFollowUpDate('');
      setFollowUpTime('');
      setFollowUpText('');
    }
  };

  const outcomeChoices = (
    <div className="visit-outcome-grid">
      {outcomeOptions.map((outcome, index) => (
        <label className="visit-outcome-chip" key={outcome.code}>
          <input
            ref={index === 0 ? firstOutcomeRef : undefined}
            aria-describedby={standardVisit && fieldError === 'outcomes' ? 'visit-outcomes-error' : undefined}
            checked={selectedOutcomes.includes(outcome.code)}
            name="outcomeCode"
            type="checkbox"
            value={outcome.code}
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              if (checked && fieldError === 'outcomes') setFieldError(null);
              setOutcomeSelection((current) => {
                const chosen = current ?? [];
                if (!checked) return chosen.filter((code) => code !== outcome.code);
                if (outcome.code === 'follow-up-needed') return [...chosen.filter((code) => code !== 'no-action-needed'), outcome.code];
                if (outcome.code === 'no-action-needed') return [...chosen.filter((code) => code !== 'follow-up-needed'), outcome.code];
                return [...chosen, outcome.code];
              });
              if (outcome.code === 'follow-up-needed' && checked && followUpMode === 'none') {
                handleFollowUpModeChange('task');
              }
              if (outcome.code === 'no-action-needed' && checked) handleFollowUpModeChange('none');
            }}
          />
          <span>{outcome.label}</span>
        </label>
      ))}
    </div>
  );

  const salesStatusChoices = (
    <div className="visit-outcome-grid">
      <label className="visit-outcome-chip">
        <input checked={salesStatus === ''} name="salesStatus" onChange={() => setSalesStatus('')} required={standardVisit} type="radio" value="" />
        <span>No change</span>
      </label>
      {salesStatusOptions.map((option) => (
        <label className="visit-outcome-chip" key={option.value}>
          <input checked={salesStatus === option.value} name="salesStatus" onChange={() => setSalesStatus(option.value)} type="radio" value={option.value} />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );

  const appendVisitPhotos = (formData: FormData) => {
    for (const photo of photos) {
      formData.append('photoFile', photo.file);
      formData.append('photoType', photo.category);
      formData.append('photoCaption', photo.caption);
    }
  };

  return (
    <form
      method="post"
      className="visit-form field-visit-form"
      onSubmit={(event) => {
        if (standardVisit) {
          if (!summary.trim()) {
            event.preventDefault();
            setFieldError('notes');
            notesRef.current?.focus();
            return;
          }
          if (!outcomeOptions.some(({ code }) => selectedOutcomes.includes(code))) {
            event.preventDefault();
            setFieldError('outcomes');
            firstOutcomeRef.current?.focus();
            return;
          }
        }
        handleSubmit(event, standardVisit ? appendVisitPhotos : undefined);
      }}
    >
      <input name="formOrigin" readOnly type="hidden" value={formOrigin} />
      <input name="locationType" readOnly type="hidden" value={locationType} />
      <input name="agencyId" readOnly type="hidden" value={locationType === 'agency' ? agencyId : ''} />
      <input name="wholesaleAccountId" readOnly type="hidden" value={locationType === 'wholesale' ? wholesaleAccountId : ''} />
      {contactIds.map((contactId) => <input key={contactId} name="contactId" readOnly type="hidden" value={contactId} />)}
      <input name="outcomes" readOnly type="hidden" value={initialValues?.outcomes ?? ''} />
      <input name="eventId" type="hidden" value={initialValues?.eventId??''} />
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

      {(initialValues?.sourceLabel && initialValues.sourceLabel !== selectedLocation?.name) || initialValues?.productName || initialValues?.reason ? <section className="action-context-summary visit-action-context" aria-label="Task and recommendation context">

        <strong>{initialValues.sourceLabel ?? initialValues.productName}</strong>
        {initialValues.productItemCode && initialValues.productName ? <span>{initialValues.productItemCode} - {initialValues.productName}</span> : null}
        {initialValues.reason ? <small>{initialValues.reason}</small> : null}
      </section> : null}

      <fieldset className="visit-step visit-account-step">
        <legend className={!isChangingLocation && selectedLocation ? 'sr-only' : undefined}>Account</legend>
        {!isChangingLocation && selectedLocation ? (
          <div className="selected-location-card">
            <div>
              <span>{locationType === 'agency' ? 'Retail' : 'Restaurants'}</span>
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
                  {type === 'wholesale' ? 'Restaurants' : 'Retail'}
                </button>
              ))}
            </div>
            <div className="search-select">
              <label htmlFor="visit-location-search">Find {locationType === 'agency' ? 'agency' : 'restaurant account'}</label>
              <input
                id="visit-location-search"
                placeholder="Search name, ID, city, or phone"
                type="search"
                maxLength={200}
                value={locationSearch}
                onChange={(event) => setLocationSearch(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }}
              />
              {!searchText ? <p className="field-note">Type at least 2 characters to search every account.</p> : null}
              {searchText.length === 1 ? <p className="field-note">Enter one more character to search every account.</p> : null}
              {isLocationSearching ? <p role="status" className="field-note">Searching {locationType === 'agency' ? 'retail' : 'restaurant'} accounts…</p> : null}
              {locationSearchError ? <div className="field-note">
                <p className="danger-text" role="alert">{locationSearchError}</p>
                <button type="button" className="secondary compact-btn" onClick={() => {
                  pendingSearchRetry.current = `${locationType}:${normalize(locationSearch.trim())}`;
                  setSearchAttempt((attempt) => attempt + 1);
                }}>Retry search</button>
              </div> : null}
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

      {mode === 'create' ? <fieldset className="visit-step"><legend>How did you connect?</legend>
        <div className="visit-contact-chips interaction-channel-options" role="group" aria-label="Interaction type">
          {([['PHYSICAL_VISIT', 'In person'], ['PHONE_CALL', 'Phone'], ['EMAIL', 'Email'], ['SMS', 'Text'], ['VIRTUAL_MEETING', 'Video'], ['INTERNAL_NOTE', 'Note']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={interactionType === value} className={interactionType === value ? 'visit-contact-chip is-selected' : 'visit-contact-chip'} onClick={() => setInteractionType(value)}>{label}</button>)}
        </div><input name="interactionType" type="hidden" value={interactionType} />
        {!physicalVisit ? <p className="field-note">Record a completed conversation. Emails and texts entered here are logged only.</p> : null}
      </fieldset> : null}
      <fieldset className="visit-step visit-outcome-step">
        <legend className="sr-only">What happened?</legend>
        <label className={standardVisit ? 'visit-required-notes-label' : undefined} htmlFor="visit-notes">
          {physicalVisit ? 'Visit notes' : 'Conversation notes'}
          {physicalVisit ? <span className="optional-label"> {standardVisit ? 'Required' : 'Optional'}</span> : null}
        </label>
        <textarea
          ref={notesRef}
          className={standardVisit ? 'visit-required-notes' : undefined}
          id="visit-notes"
          name="summary"
          required={!physicalVisit || standardVisit}
          aria-invalid={standardVisit && fieldError === 'notes' ? true : undefined}
          aria-describedby={standardVisit && fieldError === 'notes' ? 'visit-notes-error' : undefined}
          maxLength={4000}
          rows={mode === 'create' ? 2 : 3}
          placeholder={standardVisit ? 'What happened, and what should you remember next time?' : 'Key conversation, product interest, or anything worth remembering'}
          value={summary}
          onChange={(event) => {
            setSummary(event.target.value);
            if (fieldError === 'notes') setFieldError(null);
          }}
        />
        {standardVisit && fieldError === 'notes' ? <p className="field-note form-error" id="visit-notes-error" role="alert">Enter your visit notes.</p> : null}
        {!physicalVisit ? <div className="form-grid">
          {interactionType !== 'INTERNAL_NOTE' ? <label><input type="checkbox" name="meaningful" /> Meaningful exchange with the customer</label> : null}
          <label htmlFor="interaction-visibility">Visibility</label><select id="interaction-visibility" name="visibility" defaultValue="TEAM"><option value="TEAM">Team</option><option value="PRIVATE">Only me</option></select><p className="field-note">Follow-up titles and account status changes are shared with your team.</p>
        </div> : null}
        {!standardVisit ? (
          <details className="visit-outcomes-details">
            <summary>Outcomes{selectedOutcomes.length ? ` · ${selectedOutcomes.length} selected` : ' (optional)'}</summary>
            {outcomeChoices}
          </details>
        ) : null}
      </fieldset>

      {standardVisit ? (
        <>
          <fieldset className="visit-step">
            <legend>Outcomes <span className="optional-label">Select at least one</span></legend>
            {outcomeChoices}
            {fieldError === 'outcomes' ? <p className="field-note form-error" id="visit-outcomes-error" role="alert">Select at least one outcome.</p> : null}
          </fieldset>
          <fieldset className="visit-step">
            <legend>Sales status <span className="optional-label">Required</span></legend>
            {salesStatusChoices}
          </fieldset>
        </>
      ) : null}

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

      {!physicalVisit && matchingWorklistItems.length > 0 ? (
        <fieldset className="visit-step visit-worklist-prompt">
          <legend>Complete existing follow-up?</legend>
          <p className="field-note">This account already has follow-up assigned to you. Choose what should happen when this interaction is saved.</p>
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

      {!standardVisit && mode === 'create' && formOrigin === 'visits' && salesStatusOptions.length > 0 ? <details><summary>Sales status · Optional</summary><fieldset className="visit-step">
        <legend>Sales status changed?</legend>
        <p className="field-note">Optional. Keep No change selected unless this interaction moved the relationship.</p>
        {salesStatusChoices}
      </fieldset></details> : null}

      {hasLocation && mode === 'create' ? <fieldset className="visit-step visit-target-account-step">
        <legend>Account focus <span className="optional-label">Optional</span></legend>
        {(locationType === 'agency' ? targetedAgencyIds.includes(agencyId) : targetedWholesaleAccountIds.includes(wholesaleAccountId))
          ? <p className="visit-target-state"><strong className="target-account-marker">TARGET ACCOUNT</strong><span>We’re actively working this account.</span></p>
          : <label className="visit-target-choice"><input name="targetAccount" type="checkbox" value="true" /><span><strong>Target Account</strong><small>Mark this account for active work and refresh its research.</small></span></label>}
      </fieldset> : null}

      {hasLocation ? <fieldset className="visit-step visit-contact-step">
        <legend>{physicalVisit ? 'Who did you meet?' : 'Who was involved?'} <span className="optional-label">Optional</span></legend>
        {visibleContacts.length > 0 ? <div className="visit-contact-chips">
          {visibleContacts.map((contact) => <button
            aria-pressed={contactIds.includes(contact.id)}
            className={contactIds.includes(contact.id) ? 'visit-contact-chip is-selected' : 'visit-contact-chip'}
            key={contact.id}
            type="button"
            onClick={() => setContactIds((current) => current.includes(contact.id) ? current.filter((id) => id !== contact.id) : [...current, contact.id])}
          ><strong>{contact.name}</strong>{contact.role ? <small>{contact.role}</small> : null}{contact.isPrimary ? <span>Primary</span> : null}</button>)}
        </div> : contactLoadFailed ? <div className="field-note">
          <p role="status">Contacts could not be loaded.</p>
          <button type="button" className="secondary compact-btn" onClick={() => {
            setContactLoad(null);
            setContactRetry((attempt) => attempt + 1);
          }}>Retry contacts</button>
        </div> : <p className="field-note" role="status">
          {!contactsLoaded ? 'Loading contacts…' : contactSearchText ? 'No contacts match your search.' : 'No active contacts for this account.'}
        </p>}
        <details className="compact-details nested-details">
          <summary>Find or add contact</summary>
          <label htmlFor="visit-contact-search">Search saved contacts</label>
          <input id="visit-contact-search" placeholder="Name, role, email, or phone" type="search" value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} />
          {mode === 'create' ? <div className="form-grid inline-contact-create">
            <input aria-label="New contact name" placeholder="New contact name" value={newContact.name} onChange={(event) => setNewContact((current) => ({ ...current, name: event.target.value }))} />
            <input aria-label="New contact role" placeholder="Role / title (optional)" value={newContact.role} onChange={(event) => setNewContact((current) => ({ ...current, role: event.target.value }))} />
            <input aria-label="New contact email" placeholder="Email (optional)" type="email" value={newContact.email} onChange={(event) => setNewContact((current) => ({ ...current, email: event.target.value }))} />
            <input aria-label="New contact phone" placeholder="Phone (optional)" type="tel" value={newContact.phone} onChange={(event) => setNewContact((current) => ({ ...current, phone: event.target.value }))} />
            <button disabled={!newContact.name.trim() || contactCreateStatus === 'saving'} type="button" onClick={addContactDuringVisit}>{contactCreateStatus === 'saving' ? 'Saving…' : 'Add and select contact'}</button>
            {contactCreateStatus === 'error' ? <p className="field-note form-error">Contact could not be saved. Try again.</p> : <p className="field-note">Saves to this account and selects the contact without leaving Log Visit.</p>}
          </div> : null}
        </details>
      </fieldset> : null}

      <section className="visit-details" aria-label="Additional visit tools">
        <div className="visit-details-content">
          {mode === 'create' && locationType === 'wholesale' && !wholesaleAccountId ? (
            <details className="compact-details nested-details">
              <summary>Create a restaurant account</summary>
              <fieldset className="wholesale-create-section">
                <legend>Account</legend>
                <div className="wholesale-create-grid">
                  <label>Account name<input name="newWholesaleName" autoComplete="organization" value={newWholesaleName} onChange={(event) => setNewWholesaleName(event.target.value)} /></label>
                  <label>Phone (optional)<input name="newWholesalePhone" type="tel" autoComplete="tel" /></label>
                </div>
              </fieldset>
              <WholesaleAddressFields visit />
              <label>Licensee ID (optional)<input name="newWholesaleLicenseeId" /></label>
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

          {standardVisit ? (
            <details className="compact-details nested-details">
              <summary>Add photo proof{photos.length ? ` · ${photos.length} added` : ''}</summary>
              <div className="visit-photo-proof">
                {photos.map((photo, index) => (
                  <div className="visit-photo-proof-entry" key={photo.id}>
                    <div className="visit-photo-proof-file">
                      <strong>{photo.file.name}</strong>
                      <button
                        aria-label={`Remove photo ${index + 1}`}
                        className="secondary compact-btn"
                        type="button"
                        onClick={() => {
                          setPhotos((current) => current.filter(({ id }) => id !== photo.id));
                          document.getElementById(photoInputId)?.focus();
                        }}
                      >Remove</button>
                    </div>
                    <details className="compact-details">
                      <summary>Category and caption</summary>
                      <label>
                        Category
                        <select
                          value={photo.category}
                          onChange={(event) => {
                            const category = event.currentTarget.value;
                            setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, category } : item));
                          }}
                        >
                          {photoCategories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </label>
                      <label>
                        Caption <span className="optional-label">Optional</span>
                        <input
                          value={photo.caption}
                          onChange={(event) => {
                            const caption = event.currentTarget.value;
                            setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, caption } : item));
                          }}
                        />
                      </label>
                    </details>
                  </div>
                ))}
                <div className="visit-photo-proof-entry" key="chooser">
                  <label htmlFor={photoInputId}>{photos.length ? 'Add another photo' : 'Photo'}</label>
                  <input
                    id={photoInputId}
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (!file) return;
                      const photo = { id: nextPhotoId.current++, file, category: 'OTHER', caption: '' };
                      setPhotos((current) => [...current, photo]);
                      event.currentTarget.value = '';
                    }}
                  />
                </div>
              </div>
            </details>
          ) : null}
        </div>
      </section>

      {physicalVisit && visitGuides.length ? <details className="compact-details"><summary>Visit guide</summary><input name="guideSignature" type="hidden" value={JSON.stringify(visitGuides.find(g=>g.accountType===(locationType==='agency'?'AGENCY':'WHOLESALE')))}/><label><input name="guideEnabled" type="checkbox"/>Include these answers with the visit</label>{visitGuides.find(g=>g.accountType===(locationType==='agency'?'AGENCY':'WHOLESALE'))?.questions.map((question,index)=><label key={`${locationType}:${index}`}>{question}<textarea name={`guideAnswer${index}`} maxLength={1500}/></label>)}</details> : null}
      {physicalVisit && mode === 'create' && organizationId && currentUserId && (agencyId || wholesaleAccountId) ? (
        <VisitDraft
          scope={`${organizationId}:${currentUserId}:${locationType}:${locationType === 'agency' ? agencyId : wholesaleAccountId}:${initialValues?.eventId ?? ''}:${worklistItemId ?? ''}:${initialValues?.opportunityId ?? ''}`}
          value={{ summary, followUpText, followUpDate, followUpTime, followUpMode, selectedOutcomes: outcomeSelection, submissionKey }}
          onRestore={(draft) => {
            if (typeof draft.summary === 'string') setSummary(draft.summary);
            if (typeof draft.followUpText === 'string') setFollowUpText(draft.followUpText);
            if (typeof draft.followUpDate === 'string') setFollowUpDate(draft.followUpDate);
            if (typeof draft.followUpTime === 'string') setFollowUpTime(draft.followUpTime);
            if (draft.followUpMode === 'none' || draft.followUpMode === 'task') setFollowUpMode(draft.followUpMode);
            if (draft.selectedOutcomes === null) setOutcomeSelection(null);
            if (Array.isArray(draft.selectedOutcomes)) {
              setOutcomeSelection(draft.selectedOutcomes.filter((code): code is string => typeof code === 'string'));
            }
            if (typeof draft.submissionKey === 'string') setSubmissionKey(draft.submissionKey);
          }}
        />
      ) : null}
      <div className="visit-submit-bar">
        {photoUploadError ? <p className="visit-submit-error danger-text" role="alert">{photoUploadError}</p> : null}
        <a className="btn secondary visit-cancel" href={initialValues?.returnTo ?? '/visits'}>Cancel</a>
        <VisitSubmitButton disabled={!canSave || !submissionKey} pending={pending} label={physicalVisit ? submitLabel : 'Save interaction'} />
        {!canSave ? <p>Select an account to save.</p> : null}
      </div>
    </form>
  );
}
