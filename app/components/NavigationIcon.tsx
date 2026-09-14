const paths: Record<string, string> = {
  home: 'M3 10 12 3l9 7v10H15v-6H9v6H3Z',
  worklist: 'M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1',
  accounts: 'M5 21V3h14v18M3 21h18M9 7h1m4 0h1M9 11h1m4 0h1M10 21v-6h4v6',
  visits: 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM7 3v4m10-4v4M3 11h18',
  more: 'M4 12h.01M12 12h.01M20 12h.01',
};

export function NavigationIcon({ name }: { name: string }) {
  return <svg aria-hidden="true" className="navigation-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={name === 'more' ? 3 : 1.6} strokeLinecap="round" strokeLinejoin="round"><path d={paths[name] ?? paths.accounts} /></svg>;
}
