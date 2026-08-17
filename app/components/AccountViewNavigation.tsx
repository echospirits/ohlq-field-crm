import Link from 'next/link';

const accountViews = [
  { key: 'overview', href: '/accounts', label: 'Overview' },
  { key: 'agencies', href: '/agencies', label: 'Agencies' },
  { key: 'wholesale', href: '/wholesale', label: 'Wholesale' },
  { key: 'tags', href: '/tags', label: 'Tags' },
] as const;

export type AccountView = (typeof accountViews)[number]['key'];

export function AccountViewNavigation({ active }: { active: AccountView }) {
  return (
    <nav aria-label="Account views" className="view-switcher account-view-switcher">
      {accountViews.map((view) => (
        <Link aria-current={active === view.key ? 'page' : undefined} href={view.href} key={view.key}>
          {view.label}
        </Link>
      ))}
    </nav>
  );
}
