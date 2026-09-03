import Link from 'next/link';

export function WorkViewNavigation({ active, showPursuing = true }: { active: 'all' | 'week' | 'pursuing'; showPursuing?: boolean }) {
  return (
    <nav aria-label="Work views" className="view-switcher">
      <Link aria-current={active === 'all' ? 'page' : undefined} href="/alerts">All Work</Link>
      <Link aria-current={active === 'week' ? 'page' : undefined} href="/my-week">My Week</Link>
      {showPursuing ? <Link aria-current={active === 'pursuing' ? 'page' : undefined} href="/alerts?view=pursuing">Pursuing</Link> : null}
    </nav>
  );
}
