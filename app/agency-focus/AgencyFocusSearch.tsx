'use client';

import { useEffect, useRef } from 'react';
import { LiveFilterForm } from '../components/LiveFilterForm';

export function AgencyFocusSearch({ value }: { value: string }) {
  const input = useRef<HTMLInputElement>(null);
  // Clear/back navigation updates the field without interrupting an in-flight keystroke.
  useEffect(() => {
    if (input.current && document.activeElement !== input.current) input.current.value = value;
  }, [value]);
  return <LiveFilterForm className="agency-focus-search" label="Search agency intelligence" role="search">
    <input name="page" type="hidden" value="1" />
    <label htmlFor="agency-focus-search">Find an agency or product</label>
    <input ref={input} defaultValue={value} id="agency-focus-search" name="q" placeholder="Agency, city, product, or item code" type="search" />
  </LiveFilterForm>;
}
