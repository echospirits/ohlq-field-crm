import { LiveFilterForm } from './LiveFilterForm';

export function GlobalSearchForm({ compact = false, defaultValue = '' }: { compact?: boolean; defaultValue?: string }) {
  return (
    <LiveFilterForm
      action="/search"
      className={compact ? 'global-search global-search-compact' : 'global-search'}
      label="Search accounts and work"
      role="search"
    >
      <label className="sr-only" htmlFor={compact ? 'global-search-sidebar' : 'global-search-page'}>
        Search accounts and work
      </label>
      <input
        autoComplete="off"
        defaultValue={defaultValue}
        id={compact ? 'global-search-sidebar' : 'global-search-page'}
        name="q"
        placeholder={compact ? 'Search everything...' : 'Account, ID, city, contact, or task'}
        type="search"
      />
      <button aria-label="Search" className="secondary" type="submit">Search</button>
    </LiveFilterForm>
  );
}
