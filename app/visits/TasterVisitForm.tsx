'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AgencyVisitContext } from '../../lib/agencyVisitContext';
import { EASTERN_TIME_ZONE } from '../../lib/dateTime';
import { formatDistanceMiles } from '../../lib/location/distance';
import type { NearbyAccount } from '../../lib/location/nearbyAccounts';
import { useCurrentLocation } from '../components/useCurrentLocation';
import type { VisitFormAgencyOption } from './LogVisitForm';
import { VisitSubmitButton } from './VisitSubmitButton';
import { useVisitPhotoFormAction } from './clientPhotoUpload';

type TasterVisitFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  agencies: VisitFormAgencyOption[];
};

const normalize = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();
const withSelected = (items: VisitFormAgencyOption[], selected: VisitFormAgencyOption | undefined) =>
  selected && !items.some((item) => item.id === selected.id) ? [selected, ...items] : items;

const getAgencyMeta = (agency: VisitFormAgencyOption) =>
  [agency.agencyId, agency.city, agency.county].filter(Boolean).join(' • ');

const visitDateFormatter = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  timeZone: EASTERN_TIME_ZONE,
});
const reportDateFormatter = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const getLastVisitLabel = (value: string | null) =>
  value ? `Visited ${visitDateFormatter.format(new Date(value))}` : 'Not visited yet';
const getLastSaleLabel = (value: string | null) =>
  value ? `Last sold ${reportDateFormatter.format(new Date(value))}` : 'No recent sale';

export function TasterVisitForm({ action, agencies }: TasterVisitFormProps) {
  const [agencyId, setAgencyId] = useState('');
  const [selectedAgency, setSelectedAgency] = useState<VisitFormAgencyOption>();
  const [agencySearch, setAgencySearch] = useState('');
  const [agencySearchResults, setAgencySearchResults] = useState<VisitFormAgencyOption[]>([]);
  const [resolvedSearch, setResolvedSearch] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [nearbyAgencies, setNearbyAgencies] = useState<VisitFormAgencyOption[]>([]);
  const [isChangingAgency, setIsChangingAgency] = useState(true);
  const [agencyContext, setAgencyContext] = useState<AgencyVisitContext | null>(null);
  const [isContextLoading, setIsContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const { location: currentLocation, requestLocation, status: locationStatus } = useCurrentLocation();
  const { formAction, photoUploadError } = useVisitPhotoFormAction(action);
  const searchText = normalize(agencySearch);

  useEffect(() => {
    const query = agencySearch.trim();
    const searchKey = normalize(query);
    if (query.length < 2) {
      setAgencySearchResults([]);
      setResolvedSearch('');
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);
      try {
        const params = new URLSearchParams({ q: query, type: 'agency' });
        if (currentLocation) {
          params.set('latitude', String(currentLocation.latitude));
          params.set('longitude', String(currentLocation.longitude));
        }
        const response = await fetch(`/api/visits/account-search?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Agency search failed: ${response.status}`);
        const data = (await response.json()) as { results: VisitFormAgencyOption[] };
        setAgencySearchResults(data.results.slice(0, 8));
        setResolvedSearch(searchKey);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('Taster agency search failed', error);
        setSearchError('Agency search is unavailable. Try again.');
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [agencySearch, currentLocation]);

  useEffect(() => {
    if (!currentLocation) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      latitude: String(currentLocation.latitude),
      longitude: String(currentLocation.longitude),
      type: 'agency',
    });

    fetch(`/api/accounts/nearby?${params}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`Nearby lookup failed: ${response.status}`)))
      .then((data: { results: NearbyAccount[] }) => {
        setNearbyAgencies(data.results.slice(0, 8).map((agency) => ({
          agencyId: agency.agencyId ?? '',
          city: agency.city,
          county: agency.county,
          distanceMiles: agency.distanceMiles,
          id: agency.id,
          lastVisitAt: agency.lastVisitAt,
          name: agency.name,
          phone: agency.phone,
        })));
      })
      .catch((error) => {
        if (!controller.signal.aborted) console.error('Taster nearby agency lookup failed', error);
      });

    return () => controller.abort();
  }, [currentLocation]);

  useEffect(() => {
    if (!agencyId) {
      setAgencyContext(null);
      setContextError(null);
      setIsContextLoading(false);
      return;
    }

    const controller = new AbortController();
    setAgencyContext(null);
    setContextError(null);
    setIsContextLoading(true);
    fetch(`/api/visits/agency-context?agencyId=${encodeURIComponent(agencyId)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(`Agency context failed: ${response.status}`)))
      .then((context: AgencyVisitContext) => setAgencyContext(context))
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error('Taster agency context failed', error);
        setContextError('Inventory is temporarily unavailable. You can still log the visit.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsContextLoading(false);
      });

    return () => controller.abort();
  }, [agencyId]);

  const hasResolvedSearch = resolvedSearch === searchText;
  const visibleAgencies = useMemo(() => {
    const options = searchText.length >= 2
      ? hasResolvedSearch ? agencySearchResults : []
      : agencies.slice(0, 8);
    const nearbyIds = new Set(nearbyAgencies.map((agency) => agency.id));
    return withSelected(
      searchText.length >= 2 ? options : options.filter((agency) => !nearbyIds.has(agency.id)),
      selectedAgency,
    ).slice(0, 8);
  }, [agencies, agencySearchResults, hasResolvedSearch, nearbyAgencies, searchText, selectedAgency]);

  const selectAgency = (agency: VisitFormAgencyOption) => {
    setAgencyId(agency.id);
    setSelectedAgency(agency);
    setAgencySearch('');
    setIsChangingAgency(false);
  };

  return (
    <form action={formAction} className="visit-form field-visit-form taster-visit-form">
      <input name="locationType" readOnly type="hidden" value="agency" />
      <input name="agencyId" readOnly type="hidden" value={agencyId} />
      {photoUploadError ? <p className="toast-notice page-status" role="alert">{photoUploadError}</p> : null}

      <fieldset className="visit-step visit-account-step">
        <legend>1. Choose the retail liquor agency</legend>
        {!isChangingAgency && selectedAgency ? (
          <div className="selected-location-card">
            <div>
              <span>Selected agency</span>
              <strong>{selectedAgency.name}</strong>
              <small>{getAgencyMeta(selectedAgency)}</small>
            </div>
            <button className="secondary compact-btn" type="button" onClick={() => setIsChangingAgency(true)}>
              Change
            </button>
          </div>
        ) : (
          <div className="search-select taster-agency-picker">
            <label htmlFor="taster-agency-search">Find agency</label>
            <input
              aria-label="Search agencies"
              id="taster-agency-search"
              placeholder="Search name, agency ID, city, or county"
              type="search"
              value={agencySearch}
              onChange={(event) => setAgencySearch(event.target.value)}
            />
            {!searchText ? <p className="field-note">Use your location for the closest stores or search every agency.</p> : null}
            {searchText.length === 1 ? <p className="field-note">Enter one more character to search every agency.</p> : null}
            {isSearching ? <p aria-live="polite" className="field-note">Searching agencies…</p> : null}
            {searchError ? <p className="field-note danger-text" role="alert">{searchError}</p> : null}
            {searchText.length >= 2 && hasResolvedSearch && visibleAgencies.length === 0 ? (
              <p className="field-note">No agencies match “{agencySearch.trim()}”.</p>
            ) : null}

            {!searchText && locationStatus !== 'ready' ? (
              <div className="nearby-location-control visit-nearby-control">
                <button className="secondary compact-btn" disabled={locationStatus === 'loading'} onClick={requestLocation} type="button">
                  {locationStatus === 'loading' ? 'Finding nearby stores…' : 'Use my location to show nearby stores'}
                </button>
                {locationStatus === 'denied' || locationStatus === 'unavailable' ? (
                  <span className="field-note">Location unavailable. Search still works normally.</span>
                ) : null}
              </div>
            ) : null}

            {!searchText && nearbyAgencies.length > 0 ? (
              <>
                <div className="quick-picker-section-label">Nearby stores</div>
                <div className="quick-picker-list nearby-picker-list">
                  {nearbyAgencies.map((agency) => (
                    <button className="quick-picker taster-store-option" key={`nearby-${agency.id}`} type="button" onClick={() => selectAgency(agency)}>
                      <strong>{agency.name}</strong>
                      <span>{getAgencyMeta(agency)}</span>
                      <span className="quick-picker-last">
                        {agency.distanceMiles === undefined ? '' : `${currentLocation && currentLocation.accuracy > 1609 ? `${Math.round(agency.distanceMiles)} mi` : formatDistanceMiles(agency.distanceMiles)} • `}
                        {getLastVisitLabel(agency.lastVisitAt)}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            <div className="quick-picker-section-label">
              {searchText.length >= 2 ? 'Search results' : nearbyAgencies.length > 0 ? 'More stores' : 'Stores'}
            </div>
            <div className="quick-picker-list">
              {visibleAgencies.map((agency) => (
                <button
                  className={agency.id === agencyId ? 'quick-picker taster-store-option is-selected' : 'quick-picker taster-store-option'}
                  key={agency.id}
                  type="button"
                  onClick={() => selectAgency(agency)}
                >
                  <strong>{agency.name}</strong>
                  <span>{getAgencyMeta(agency)}</span>
                  <span className="quick-picker-last">{getLastVisitLabel(agency.lastVisitAt)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!isChangingAgency && selectedAgency ? (
          <section className="taster-inventory-panel" aria-label={`Echo inventory at ${selectedAgency.name}`}>
            <div className="section-heading taster-inventory-heading">
              <div>
                <span className="page-eyebrow">Store snapshot</span>
                <h2>Current Echo inventory</h2>
              </div>
              {agencyContext ? <span className="pill">{agencyContext.inventory.length} items</span> : null}
            </div>
            {isContextLoading ? <p aria-live="polite" className="field-note">Loading inventory and recent sales…</p> : null}
            {contextError ? <p className="field-note danger-text" role="alert">{contextError}</p> : null}
            {agencyContext?.asOfDate ? (
              <p className="field-note">On-hand and store sales as of {reportDateFormatter.format(new Date(agencyContext.asOfDate))}.</p>
            ) : null}
            {agencyContext && agencyContext.inventory.length > 0 ? (
              <div className="agency-current-inventory-list taster-inventory-list">
                {agencyContext.inventory.map((item) => (
                  <article className="agency-current-inventory-row" key={item.itemCode}>
                    <div className="ohlq-item-identity">
                      <div><span className="ohlq-item-code">{item.itemCode}</span><strong>{item.itemName}</strong></div>
                      <span className="muted">{[item.inventoryStatus, getLastSaleLabel(item.lastSaleDate)].filter(Boolean).join(' • ')}</span>
                    </div>
                    <div className="agency-inventory-metrics">
                      <span><strong>{item.onHand ?? '—'}</strong><small>on hand</small></span>
                      <span><strong>{item.retailSales7}</strong><small>7d sales</small></span>
                      <span><strong>{item.retailSales30}</strong><small>30d sales</small></span>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
            {agencyContext && agencyContext.inventory.length === 0 ? (
              <p className="muted activity-empty">No current Echo inventory is recorded for this store.</p>
            ) : null}
          </section>
        ) : null}
      </fieldset>

      <fieldset className="visit-step">
        <legend>2. Leave comments</legend>
        <label htmlFor="taster-comments">Visit comments</label>
        <textarea
          id="taster-comments"
          name="summary"
          placeholder="What happened during the tasting?"
          rows={4}
          required
        />
      </fieldset>

      <fieldset className="visit-step">
        <legend>3. Add a picture</legend>
        <label htmlFor="taster-photo">Visit picture</label>
        <input id="taster-photo" name="photoFile" type="file" accept="image/*" required />
        <input name="photoType" readOnly type="hidden" value="OTHER" />
        <input name="photoUrl" readOnly type="hidden" value="" />
        <input name="photoCaption" readOnly type="hidden" value="" />
        <p className="field-note">Take a new picture or choose one from your device. Photos are reduced before upload.</p>
      </fieldset>

      <div className="visit-submit-bar">
        <VisitSubmitButton disabled={!selectedAgency} label="Log agency visit" />
      </div>
    </form>
  );
}
