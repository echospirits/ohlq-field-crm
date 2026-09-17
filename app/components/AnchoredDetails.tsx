'use client';

import { useEffect, useRef, type ReactNode } from 'react';

export function AnchoredDetails({ id, className, summary, children, initialOpen = false }: { id: string; className?: string; summary: ReactNode; children: ReactNode; initialOpen?: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const containsAnchor = (hash: string) => {
      const target = hash ? document.getElementById(hash.slice(1)) : null;
      return target && ref.current?.contains(target);
    };
    const reveal = () => {
      if (containsAnchor(window.location.hash) && ref.current) {
        ref.current.open = true;
        document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: 'start' });
      }
    };
    const onClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a') : null;
      if (link?.origin === window.location.origin && link.pathname === window.location.pathname && containsAnchor(link.hash) && ref.current) ref.current.open = true;
    };
    reveal();
    window.addEventListener('hashchange', reveal);
    document.addEventListener('click', onClick);
    return () => { window.removeEventListener('hashchange', reveal); document.removeEventListener('click', onClick); };
  }, [id]);
  return <details className={className} id={id} open={initialOpen} ref={ref}><summary>{summary}</summary>{children}</details>;
}
