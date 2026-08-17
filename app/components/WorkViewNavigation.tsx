import Link from 'next/link';

export function WorkViewNavigation({ active }: { active: 'all' | 'week' | 'pursuing' }) {
  return (
    <nav aria-label="Work views" className="view-switcher">
      <Link aria-current={active === 'all' ? 'page' : undefined} href="/alerts">All Work</Link>
      <Link aria-current={active === 'week' ? 'page' : undefined} href="/my-week">My Week</Link>
      <Link aria-current={active === 'pursuing' ? 'page' : undefined} href="/alerts?view=pursuing">Pursuing</Link>
    </nav>
  );
}
