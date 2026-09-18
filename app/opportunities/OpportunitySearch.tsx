'use client';

import { useEffect, useRef } from 'react';
import { LiveFilterForm } from '../components/LiveFilterForm';
import { StateField } from '../components/StateField';

export function OpportunitySearch({ value, state = '' }: { value: string; state?: string }) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (input.current && document.activeElement !== input.current) input.current.value = value;
  }, [value]);

  return <LiveFilterForm className="opportunity-search" label="Search wholesale opportunities" role="search">
    <label htmlFor="opportunity-search">Find an account or recommendation</label>
    <input ref={input} defaultValue={value} id="opportunity-search" name="q" placeholder="Account, city, county, or recommendation" type="search" />
    <StateField defaultValue={state} required={false} />
  </LiveFilterForm>;
}
