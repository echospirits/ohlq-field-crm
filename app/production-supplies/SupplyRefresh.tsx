'use client';
import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function SupplyRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || document.activeElement?.matches('input, select, textarea') || document.querySelector('.supplies-page details[open] .supply-edit-form')) return;
      startTransition(() => router.refresh());
    }, 120000);
    return () => window.clearInterval(timer);
  }, [router]);
  return <span className="sr-only" aria-live="polite">{pending ? 'Refreshing supply information…' : ''}</span>;
}
