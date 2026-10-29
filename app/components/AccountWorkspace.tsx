'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export type AccountWorkspacePanel = { id: string; label: string; content: ReactNode };

/** Keep account sections mounted so switching tabs never discards an unsaved form. */
export function AccountWorkspace({ panels, initialSection = 'overview' }: { panels: AccountWorkspacePanel[]; initialSection?: string }) {
  const [active, setActive] = useState(() => panels.some((panel) => panel.id === initialSection) ? initialSection : panels[0]?.id ?? 'overview');
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    const reveal = () => {
      let hash: string;
      try { hash = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
      if (!hash) { setActive(panels.some((panel) => panel.id === initialSection) ? initialSection : panels[0]?.id ?? 'overview'); return; }
      const target = document.getElementById(hash);
      const panel = panels.find((entry) => entry.id === hash || (target && root.current?.querySelector(`[data-panel="${entry.id}"]`)?.contains(target)));
      if (panel) {
        setActive(panel.id);
        frame = window.requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ block: 'start' }));
      }
    };
    reveal();
    window.addEventListener('hashchange', reveal);
    window.addEventListener('popstate', reveal);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('hashchange', reveal); window.removeEventListener('popstate', reveal); };
  }, [panels, initialSection]);

  const select = (id: string) => {
    setActive(id);
    if (window.location.hash !== `#${id}`) window.history.pushState(null, '', `#${id}`);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLAnchorElement>, index: number) => {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % panels.length;
    else if (event.key === 'ArrowLeft') next = (index + panels.length - 1) % panels.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = panels.length - 1;
    else return;
    event.preventDefault();
    select(panels[next].id);
    root.current?.querySelector<HTMLAnchorElement>(`#account-tab-${panels[next].id}`)?.focus();
  };

  return <div className="account-workspace" ref={root}>
    <nav aria-label="Account sections" className="account-section-tabs" role="tablist">
      {panels.map((panel, index) => <a
        aria-controls={panel.id} aria-selected={active === panel.id}
        href={`#${panel.id}`} id={`account-tab-${panel.id}`} key={panel.id}
        onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); select(panel.id); }}
        onKeyDown={(event) => onKeyDown(event, index)} role="tab" tabIndex={active === panel.id ? 0 : -1}
      >{panel.label}</a>)}
    </nav>
    {panels.map((panel) => <section aria-labelledby={`account-tab-${panel.id}`} className="account-workspace-panel" data-panel={panel.id} hidden={active !== panel.id} id={panel.id} key={panel.id} role="tabpanel" tabIndex={0}>{panel.content}</section>)}
    <noscript><style>{'.account-workspace-panel[hidden] { display: block !important; }'}</style></noscript>
  </div>;
}
