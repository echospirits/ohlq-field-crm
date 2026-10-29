'use client';

import { useEffect, useRef } from 'react';
import { LiveFilterForm } from '../components/LiveFilterForm';
import { StateField } from '../components/StateField';

export function OpportunitySearch({ value, state = '', rating, mode, territory }: { value: string; state?: string; rating?: string; mode?: string; territory?: string }) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (input.current && document.activeElement !== input.current) input.current.value = value;
  }, [value]);

  return <LiveFilterForm className="opportunity-search" label="Search restaurant opportunities" role="search">
    <input type="hidden" name="page" value="1" />
    {rating ? <input type="hidden" name="rating" value={rating} /> : null}
    {mode ? <input type="hidden" name="mode" value={mode} /> : null}
    {territory ? <input type="hidden" name="territory" value={territory} /> : null}
    <label htmlFor="opportunity-search">Find a restaurant account</label>
    <input ref={input} defaultValue={value} id="opportunity-search" name="q" placeholder="Account, city, or commercial evidence" type="search" />
    <StateField defaultValue={state} required={false} />
  </LiveFilterForm>;
}
