'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  getMobileNavigationItems,
  getMoreNavigationItems,
  getNavigationItems,
  type NavigationItem,
} from './navigationConfig';

type NavGroup = {
  items: NavigationItem[];
  label: string;
};

const mobileItems = getMobileNavigationItems();

const isActivePath = (pathname: string, item: NavigationItem, useSectionMatch = false) => {
  if (item.href === '/') return pathname === '/';
  if (item.href === '/visits') return pathname === item.href;
  if (useSectionMatch && item.matchPrefixes) {
    return item.matchPrefixes.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
};

function NavLink({
  item,
  pathname,
  useSectionMatch = false,
}: {
  item: NavigationItem;
  pathname: string;
  useSectionMatch?: boolean;
}) {
  const isActive = isActivePath(pathname, item, useSectionMatch);

  return (
    <Link
      aria-current={isActive ? 'page' : undefined}
      className={isActive ? 'app-nav-link is-active' : 'app-nav-link'}
      href={item.href}
    >
      {useSectionMatch ? item.mobileLabel ?? item.label : item.label}
    </Link>
  );
}

function NavGroupLinks({ group, pathname }: { group: NavGroup; pathname: string }) {
  return (
    <section className="app-nav-group">
      <p className="app-nav-label">{group.label}</p>
      {group.items.map((item) => (
        <NavLink item={item} key={item.href} pathname={pathname} />
      ))}
    </section>
  );
}

export function AppSidebarNavigation({ enabledFeatures, isAdmin, isPlatformAdmin, isTaster }: { enabledFeatures: string[]; isAdmin: boolean; isPlatformAdmin: boolean; isTaster: boolean }) {
  const pathname = usePathname();
  const workItems = getNavigationItems('work', enabledFeatures);
  const accountItems = getNavigationItems('accounts', enabledFeatures);
  const adminItems = getNavigationItems('admin', enabledFeatures, isPlatformAdmin);

  if (isTaster) {
    return (
      <nav aria-label="Primary navigation" className="app-sidebar-nav">
        <Link aria-current="page" className="app-nav-link app-nav-primary" href="/visits/new">
          Log Visit
        </Link>
      </nav>
    );
  }

  return (
    <nav aria-label="Primary navigation" className="app-sidebar-nav">
      <Link
        aria-current={pathname === '/visits/new' ? 'page' : undefined}
        className="app-nav-link app-nav-primary"
        href="/visits/new"
      >
        <span aria-hidden="true">＋</span>
        Log Visit
      </Link>

      <NavGroupLinks group={{ label: 'My work', items: workItems }} pathname={pathname} />
      <NavGroupLinks group={{ label: 'Accounts', items: accountItems }} pathname={pathname} />

      {isAdmin ? (
        <details
          className="app-nav-disclosure"
          open={pathname === '/users' || pathname.startsWith('/admin/') ? true : undefined}
        >
          <summary>Administration</summary>
          <div className="app-nav-disclosure-links">
            {adminItems.map((item) => (
              <NavLink item={item} key={item.href} pathname={pathname} />
            ))}
          </div>
        </details>
      ) : null}
      {isPlatformAdmin ? <Link className="app-nav-link" href="/platform">Platform administration</Link> : null}
    </nav>
  );
}

type BreadcrumbItem = { href: string; label: string };

const getBreadcrumbs = (pathname: string): BreadcrumbItem[] => {
  if (pathname === '/') return [];

  const home = { href: '/', label: 'Home' };
  const routeMap: Array<{ prefix: string; crumbs: BreadcrumbItem[] }> = [
    { prefix: '/visits/new', crumbs: [{ href: '/visits/new', label: 'Log Visit' }] },
    { prefix: '/visits/confirmed', crumbs: [{ href: '/visits', label: 'Visits' }, { href: pathname, label: 'Confirmed' }] },
    { prefix: '/visits', crumbs: [{ href: '/visits', label: 'Visit History' }] },
    { prefix: '/alerts', crumbs: [{ href: '/alerts', label: 'Worklist' }] },
    { prefix: '/opportunities', crumbs: [{ href: '/opportunities', label: 'Opportunities' }] },
    { prefix: '/my-week', crumbs: [{ href: '/alerts', label: 'My Work' }, { href: '/my-week', label: 'My Week' }] },
    { prefix: '/agencies/', crumbs: [{ href: '/accounts', label: 'Accounts' }, { href: '/agencies', label: 'Agencies' }, { href: pathname, label: 'Agency' }] },
    { prefix: '/agencies', crumbs: [{ href: '/accounts', label: 'Accounts' }, { href: '/agencies', label: 'Agencies' }] },
    { prefix: '/wholesale/', crumbs: [{ href: '/accounts', label: 'Accounts' }, { href: '/wholesale', label: 'Wholesale' }, { href: pathname, label: 'Account' }] },
    { prefix: '/wholesale', crumbs: [{ href: '/accounts', label: 'Accounts' }, { href: '/wholesale', label: 'Wholesale' }] },
    { prefix: '/tags', crumbs: [{ href: '/accounts', label: 'Accounts' }, { href: '/tags', label: 'Tags' }] },
    { prefix: '/search', crumbs: [{ href: '/search', label: 'Search' }] },
    { prefix: '/accounts', crumbs: [{ href: '/accounts', label: 'Accounts' }] },
    { prefix: '/users', crumbs: [{ href: '/users', label: 'Administration' }, { href: '/users', label: 'Users' }] },
    { prefix: '/admin/account-research', crumbs: [{ href: '/users', label: 'Administration' }, { href: pathname, label: 'Account Research' }] },
    { prefix: '/admin/organization', crumbs: [{ href: '/users', label: 'Administration' }, { href: pathname, label: 'Organization Setup' }] },
    { prefix: '/admin/data-status', crumbs: [{ href: '/users', label: 'Administration' }, { href: pathname, label: 'Data Health' }] },
    { prefix: '/admin/weekly-digest', crumbs: [{ href: '/users', label: 'Administration' }, { href: pathname, label: 'Weekly Digest' }] },
    { prefix: '/admin/opportunity-performance', crumbs: [{ href: '/users', label: 'Administration' }, { href: pathname, label: 'Opportunity Performance' }] },
    { prefix: '/settings/calendar', crumbs: [{ href: '/profile', label: 'Profile' }, { href: '/settings/calendar', label: 'Calendar' }] },
    { prefix: '/profile', crumbs: [{ href: '/profile', label: 'Profile' }] },
  ];
  const match = routeMap.find((route) => pathname === route.prefix || pathname.startsWith(route.prefix));

  return [home, ...(match?.crumbs ?? [])];
};

export function AppBreadcrumbs({ isTaster }: { isTaster: boolean }) {
  const pathname = usePathname();
  const breadcrumbs = isTaster ? [] : getBreadcrumbs(pathname);

  if (breadcrumbs.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="app-breadcrumbs">
      {breadcrumbs.map((item, index) => {
        const isLast = index === breadcrumbs.length - 1;
        return (
          <span key={`${item.href}-${index}`}>
            {index > 0 ? <span aria-hidden="true">/</span> : null}
            {isLast ? <strong aria-current="page">{item.label}</strong> : <Link href={item.href}>{item.label}</Link>}
          </span>
        );
      })}
    </nav>
  );
}

export function MobileTabbar({ enabledFeatures, isAdmin, isPlatformAdmin, isTaster }: { enabledFeatures: string[]; isAdmin: boolean; isPlatformAdmin: boolean; isTaster: boolean }) {
  const pathname = usePathname();
  const moreItems = getMoreNavigationItems(isAdmin, enabledFeatures, isPlatformAdmin);

  if (isTaster) return null;

  return (
    <nav className="mobile-tabbar" aria-label="Quick field actions">
      {mobileItems.map((item) => (
        <NavLink item={item} key={item.href} pathname={pathname} useSectionMatch />
      ))}
      <details className="mobile-more">
        <summary>More</summary>
        <div className="mobile-more-menu">
          {moreItems.map((item) => (
            <NavLink item={item} key={item.key} pathname={pathname} />
          ))}
        </div>
      </details>
    </nav>
  );
}
