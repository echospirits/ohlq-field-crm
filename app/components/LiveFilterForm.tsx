'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, type ReactNode, useRef, useTransition } from 'react';

type LiveFilterFormProps = {
  children: ReactNode;
  className?: string;
  debounceMs?: number;
  label?: string;
};

const shouldDebounce = (target: EventTarget | null) =>
  target instanceof HTMLInputElement && ['search', 'text'].includes(target.type);

export function LiveFilterForm({ children, className, debounceMs = 250, label }: LiveFilterFormProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const timeoutRef = useRef<number | null>(null);
  const [, startTransition] = useTransition();

  const syncFilters = (form: HTMLFormElement) => {
    const params = new URLSearchParams(searchParams.toString());
    const fieldNames = Array.from(form.elements)
      .map((element) => (element instanceof HTMLInputElement || element instanceof HTMLSelectElement ? element.name : ''))
      .filter(Boolean);

    fieldNames.forEach((name) => params.delete(name));

    for (const [name, value] of new FormData(form).entries()) {
      const normalizedValue = String(value ?? '').trim();

      if (normalizedValue) {
        params.append(name, normalizedValue);
      }
    }

    const query = params.toString();

    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  };

  const scheduleSync = (form: HTMLFormElement, immediate: boolean) => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }

    if (immediate) {
      syncFilters(form);
      return;
    }

    timeoutRef.current = window.setTimeout(() => syncFilters(form), debounceMs);
  };

  const handleInput = (event: FormEvent<HTMLFormElement>) => {
    scheduleSync(event.currentTarget, !shouldDebounce(event.target));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    scheduleSync(event.currentTarget, true);
  };

  return (
    <form
      aria-label={label}
      className={className}
      method="get"
      onChange={handleInput}
      onInput={handleInput}
      onSubmit={handleSubmit}
    >
      {children}
    </form>
  );
}
