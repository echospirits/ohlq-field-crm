'use client';

import { useEffect, useRef, type ReactNode } from 'react';

export function AnchoredDetails({ id, className, summary, children, initialOpen = false }: { id: string; className?: string; summary: ReactNode; children: ReactNode; initialOpen?: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const reveal = () => {
      if (window.location.hash === `#${id}` && ref.current) {
        ref.current.open = true;
        ref.current.scrollIntoView({ block: 'start' });
      }
    };
    const onClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a') : null;
      if (link?.hash === `#${id}` && link.pathname === window.location.pathname && ref.current) ref.current.open = true;
    };
    reveal();
    window.addEventListener('hashchange', reveal);
    document.addEventListener('click', onClick);
    return () => { window.removeEventListener('hashchange', reveal); document.removeEventListener('click', onClick); };
  }, [id]);
  return <details className={className} id={id} open={initialOpen} ref={ref}><summary>{summary}</summary>{children}</details>;
}
