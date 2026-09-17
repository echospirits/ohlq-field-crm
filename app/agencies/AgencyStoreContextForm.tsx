'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buyingOptions, emptyStoreContext, formatOptions, nearbyOptions, ownershipOptions, settingOptions, type StoreContext, type StoreContextInput } from '../../lib/agencyStoreContext';

export function AgencyStoreContextForm({ agencyId, context }: { agencyId: string; context: StoreContext | null }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [saved, setSaved] = useState(context);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const defaults = saved ?? emptyStoreContext();
  const valueAt = (key: string) => key.split('.').reduce<unknown>((value, part) => value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined, defaults);
  const error = (key: string) => fields[key] ? <small className="store-field-error" id={`error-${key}`}>{fields[key]}</small> : null;
  const input = (key: string, label: string, type = 'text', maxLength = 160) => <label>{label}<input name={key} type={type} defaultValue={String(valueAt(key) ?? '')} maxLength={maxLength} min={type === 'number' ? key.endsWith('year') ? 2000 : 0 : undefined} max={key.endsWith('year') ? new Date().getFullYear() : type === 'date' ? new Date().toISOString().slice(0, 10) : undefined} aria-invalid={Boolean(fields[key])} aria-describedby={fields[key] ? `error-${key}` : undefined} />{error(key)}</label>;
  const select = (key: string, label: string, options: readonly string[]) => <label>{label}<select name={key} defaultValue={String(valueAt(key))}>{options.map((option) => <option key={option}>{option}</option>)}</select>{error(key)}</label>;
  const source = (key: string) => <div className="store-form-grid store-form-wide">
    {input(`${key}.source.name`, 'Source / who confirmed this', 'text', 200)}
    {input(`${key}.source.observedOn`, 'Observed on', 'date')}
    <div className="store-form-wide">{input(`${key}.source.url`, 'Source URL (optional except demographics)', 'url', 1000)}</div>
  </div>;
  const note = (key: string) => <label className="store-form-wide">Supporting notes (optional)<textarea name={`${key}.notes`} defaultValue={String(valueAt(`${key}.notes`))} maxLength={1000} rows={2} /></label>;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const read = (key: string) => String(data.get(key) ?? '').trim();
    const number = (key: string) => read(key) === '' ? null : Number(read(key));
    const evidence = (key: string) => ({ name: read(`${key}.source.name`), url: read(`${key}.source.url`), observedOn: read(`${key}.source.observedOn`) });
    const input = {
      store: { ownership: read('store.ownership'), chainName: read('store.chainName'), format: read('store.format'), buying: read('store.buying'), notes: read('store.notes'), source: evidence('store') },
      area: { setting: read('area.setting'), neighborhood: read('area.neighborhood'), nearby: data.getAll('area.nearby'), notes: read('area.notes'), source: evidence('area') },
      demographics: { geography: read('demographics.geography'), year: number('demographics.year'), medianHouseholdIncome: number('demographics.medianHouseholdIncome'), adultPopulation: number('demographics.adultPopulation'), source: evidence('demographics') },
    } as StoreContextInput;
    setPending(true); setMessage(''); setFields({});
    try {
      const response = await fetch(`/api/agencies/${encodeURIComponent(agencyId)}/store-context`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: input, expectedVersion: saved?.savedAt ?? null }) });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error || 'Unable to save. Your entries are still here.');
        setFields(result.fields ?? {});
        const firstField = Object.keys(result.fields ?? {})[0];
        const element = firstField ? formRef.current?.elements.namedItem(firstField) : null;
        if (element instanceof HTMLElement) { element.closest('details')?.setAttribute('open', ''); element.focus(); }
      } else { setSaved(result.context); setMessage('Store context saved.'); router.refresh(); }
    } catch { setMessage('Unable to save. Check your connection and try again; your entries are still here.'); }
    finally { setPending(false); }
  }
  return <details className="nested-details store-context-editor"><summary>{saved ? 'Edit store context' : 'Add store context'}</summary>
    <form ref={formRef} onSubmit={submit} className="store-context-form" aria-busy={pending}>
      <p className="muted">Record facts for your team. Leave unknown fields blank or marked Unknown. Add a source and observation date to each completed section.</p>
      <fieldset disabled={pending}><legend>Store & buying decisions</legend><div className="store-form-grid">
        {select('store.ownership', 'Ownership', ownershipOptions)}{input('store.chainName', 'Chain / ownership group (if applicable)')}
        {select('store.format', 'Store format', formatOptions)}{select('store.buying', 'Buying decisions', buyingOptions)}{note('store')}{source('store')}
      </div></fieldset>
      <details className="nested-details"><summary>Neighborhood & nearby businesses</summary><fieldset disabled={pending}><legend className="sr-only">Neighborhood & nearby businesses</legend><div className="store-form-grid">
        {select('area.setting', 'Area type', settingOptions)}{input('area.neighborhood', 'Neighborhood (optional)')}
        <fieldset className="store-form-wide store-nearby-options"><legend>Nearby business mix</legend>{nearbyOptions.map((option) => <label className="checkbox-label" key={option}><input type="checkbox" name="area.nearby" value={option} defaultChecked={defaults.area.nearby.includes(option)} />{option}</label>)}</fieldset>
        {note('area')}{source('area')}
      </div></fieldset></details>
      <details className="nested-details"><summary>Area demographics</summary><fieldset disabled={pending}><legend className="sr-only">Area demographics</legend><p className="muted">Use a published area statistic. These describe the area, not this store’s actual shoppers.</p><div className="store-form-grid">
        {input('demographics.geography', 'Area / census geography', 'text', 200)}{input('demographics.year', 'Data year', 'number')}
        {input('demographics.medianHouseholdIncome', 'Median household income ($)', 'number')}{input('demographics.adultPopulation', 'Adult population (18+)', 'number')}{source('demographics')}
      </div></fieldset></details>
      {message ? <p role="status" className={message === 'Store context saved.' ? 'toast-notice' : 'store-field-error'}>{message}</p> : null}
      <button type="submit" className="btn" disabled={pending}>{pending ? 'Saving…' : 'Save store context'}</button>
    </form>
  </details>;
}
