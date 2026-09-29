'use client';

import { useRouter } from 'next/navigation';
import { ActionForm } from '../../components/ActionForm';
import { SubmitButton } from '../../components/SubmitButton';
import { OPERATING_HOURS_DAYS, type OperatingHoursEntry } from '../../../lib/operatingHours';
import { researchAgencyOperatingHours, saveAgencyOperatingHours } from './actions';

export function AgencyOperatingHoursEditor({
  agencyId,
  schedule,
  sourceName,
  sourceUrl,
  researchedAt,
  researchAvailable,
}: {
  agencyId: string;
  schedule: OperatingHoursEntry[] | null;
  sourceName: string | null;
  sourceUrl: string | null;
  researchedAt: string | null;
  researchAvailable: boolean;
}) {
  const router = useRouter();
  const hoursByDay = new Map(schedule?.map((entry) => [entry.day, entry.hours] as const) ?? []);
  const scheduleKey = JSON.stringify(schedule ?? []);

  return <details className="account-hours-editor" id="account-hours">
    <summary>{schedule?.length ? 'Edit known operating hours' : 'Set known operating hours'}</summary>
    <p className="muted">Leave a day blank when its hours are unknown. Use “Closed” for a known closure. Agency tasks outside listed hours are marked red in My Schedule and the Worklist.</p>
    {sourceName ? <p className="account-hours-source">Source: {sourceUrl ? <a href={sourceUrl} rel="noreferrer" target="_blank">{sourceName}</a> : sourceName}{researchedAt ? ` · checked ${researchedAt.slice(0, 10)}` : ''}</p> : null}
    <ActionForm action={researchAgencyOperatingHours} className="account-hours-research-form" onSuccess={() => router.refresh()}>
      <input name="agencyId" type="hidden" value={agencyId} />
      <SubmitButton className="secondary" disabled={!researchAvailable} pendingLabel="Searching public sources…">Research public hours</SubmitButton>
      {!researchAvailable ? <small className="muted">Public lookup is unavailable in this environment; enter known hours below.</small> : <small className="muted">Searches OHLQ by agency number first, then checks other public sources against this address if needed. Results include a source link and can be edited below.</small>}
    </ActionForm>
    <ActionForm action={saveAgencyOperatingHours} className="account-hours-form" key={scheduleKey} onSuccess={() => router.refresh()}>
      <input name="agencyId" type="hidden" value={agencyId} />
      <div className="account-hours-fields">
        {OPERATING_HOURS_DAYS.map((day) => <label key={day}>{day}<input defaultValue={hoursByDay.get(day) ?? ''} maxLength={120} name={`hours.${day}`} placeholder="9:00 AM–5:00 PM or Closed" type="text" /></label>)}
      </div>
      <SubmitButton className="secondary" type="submit">Save hours</SubmitButton>
    </ActionForm>
  </details>;
}
