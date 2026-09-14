'use client';

import { useId, useRef, useState } from 'react';

/** Search the complete supplied list; only the visible suggestions are limited. */
export function RecordPicker({ label, name, options }: { label: string; name: string; options: Array<{ value: string; label: string }> }) {
  const [value, setValue] = useState('');
  const [query, setQuery] = useState('');
  const details = useRef<HTMLDetailsElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const matches = options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()));
  const choose = (next: string) => {
    setValue(next);
    setQuery('');
    if (details.current) {
      details.current.open = false;
      details.current.querySelector('summary')?.focus();
    }
  };
  return <div className="record-picker">
    <span id={id}>{label}</span>
    <input name={name} type="hidden" value={value} />
    <details ref={details} onToggle={(event) => { if (event.currentTarget.open) search.current?.focus(); }} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); if (details.current) { details.current.open = false; details.current.querySelector('summary')?.focus(); } } }}>
      <summary aria-labelledby={id + ' ' + id + '-selection'}><span id={id + '-selection'}>{options.find((option) => option.value === value)?.label ?? 'Choose an account (optional)'}</span></summary>
      <div className="record-picker-results">
        <input aria-label={`Search ${label.toLowerCase()}`} ref={search} type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
        <button className="secondary" type="button" onClick={() => choose('')}>No account</button>
        <p className="field-note" aria-live="polite">{matches.length} matches{matches.length > 30 ? ' · Showing 30; keep typing to narrow' : ''}</p>
        {matches.slice(0, 30).map((option) => <button aria-pressed={value === option.value} className="secondary" key={option.value} type="button" onClick={() => choose(option.value)}>{option.label}</button>)}
      </div>
    </details>
  </div>;
}
