const paths: Record<string, string> = {
  home: 'M3 10 12 3l9 7v10H15v-6H9v6H3Z',
  worklist: 'M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1',
  accounts: 'M5 21V3h14v18M3 21h18M9 7h1m4 0h1M9 11h1m4 0h1M10 21v-6h4v6',
  visits: 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM7 3v4m10-4v4M3 11h18',
  more: 'M4 12h.01M12 12h.01M20 12h.01',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6',
  plus: 'M12 4v16M4 12h16',
  down: 'm6 9 6 6 6-6',
  analytics: 'M4 20V10M11 20V4M18 20v-8M2 21h20',
  'production-forecasting': 'm3 17 6-7 5 3 7-10M16 3h5v5',
  pipeline: 'M4 5h4v15H4ZM10 10h4v10h-4ZM16 3h4v17h-4Z',
  'wholesale-orders': 'M5 3h14v18H5ZM8 8h8M8 12h8M8 16h5',
  support: 'M12 3a9 9 0 0 0-9 9v5h4v-6H3m18 0h-4v6h4v-5a9 9 0 0 0-9-9m9 14v2a2 2 0 0 1-2 2h-7',
};

export function NavigationIcon({ name }: { name: string }) {
  return <svg aria-hidden="true" className="navigation-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={name === 'more' ? 3 : 1.6} strokeLinecap="round" strokeLinejoin="round"><path d={paths[name] ?? paths.accounts} /></svg>;
}
