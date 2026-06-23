'use client';

import { usePathname } from 'next/navigation';

type NavItem = {
  href: string;
  isPrimary?: boolean;
  label: string;
};

const fieldNavItems: NavItem[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/visits/new', isPrimary: true, label: 'Log Visit' },
  { href: '/alerts', label: 'Worklist' },
  { href: '/agencies', label: 'Agencies' },
  { href: '/wholesale', label: 'Wholesale' },
];

const secondaryNavItems: NavItem[] = [
  { href: '/tags', label: 'Tags' },
  { href: '/visits', label: 'Visits' },
  { href: '/my-week', label: 'My Week' },
  { href: '/profile', label: 'Profile' },
];

const adminNavItems: NavItem[] = [
  { href: '/users', label: 'Users' },
  { href: '/admin/data-status', label: 'Data Status' },
  { href: '/admin/weekly-digest', label: 'Weekly Digest' },
];

const isActivePath = (pathname: string, href: string) => {
  if (href === '/') return pathname === '/';
  if (href === '/visits/new') return pathname === href;
  if (href === '/visits') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
};

function NavLink({
  item,
  pathname,
}: {
  item: NavItem;
  pathname: string;
}) {
  const isActive = isActivePath(pathname, item.href);

  return (
    <a
      aria-current={isActive ? 'page' : undefined}
      className={[
        'app-nav-link',
        isActive ? 'is-active' : '',
        item.isPrimary ? 'is-primary' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      href={item.href}
    >
      {item.label}
    </a>
  );
}

export function AppSidebarNavigation({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const items = [...fieldNavItems, ...secondaryNavItems, ...(isAdmin ? adminNavItems : [])];

  return (
    <nav aria-label="Primary navigation" className="app-sidebar-nav">
      {items.map((item) => (
        <NavLink item={item} key={item.href} pathname={pathname} />
      ))}
    </nav>
  );
}

export function MobileTabbar() {
  const pathname = usePathname();

  return (
    <nav className="mobile-tabbar" aria-label="Quick field actions">
      {fieldNavItems.map((item) => (
        <NavLink item={item} key={item.href} pathname={pathname} />
      ))}
    </nav>
  );
}
