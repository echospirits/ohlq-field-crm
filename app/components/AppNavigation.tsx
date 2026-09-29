'use client';

import Link from 'next/link';
import { NavigationIcon } from './NavigationIcon';
import { usePathname } from 'next/navigation';
import {
  getAdministrationNavigationGroups,
  getIntelligenceNavigationItems,
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
      {useSectionMatch ? <NavigationIcon name={item.key} /> : null}<span>{useSectionMatch ? item.mobileLabel ?? item.label : item.label}</span>
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

function AdministrationMenu({ enabledFeatures, hasOrganizationAdminAccess, isPlatformAdmin, pathname }: { enabledFeatures: string[]; hasOrganizationAdminAccess: boolean; isPlatformAdmin: boolean; pathname: string }) {
  const groups = getAdministrationNavigationGroups(enabledFeatures, isPlatformAdmin, hasOrganizationAdminAccess);
  const items = groups.flatMap((group) => group.items);
  const isActive = items.some((item) => isActivePath(pathname, item));
  return <details className={`app-sidebar-administration${isActive ? ' is-active' : ''}`}>
    <summary className="app-nav-label"><span>Administration</span><span aria-hidden="true" className="app-sidebar-administration-arrow">›</span></summary>
    <div className="app-sidebar-administration-links">
      {items.map((item) => <NavLink item={item} key={item.href} pathname={pathname} />)}
    </div>
  </details>;
}

function IntelligenceMenu({ enabledFeatures, isAdmin, isPlatformAdmin, pathname }: { enabledFeatures: string[]; isAdmin: boolean; isPlatformAdmin: boolean; pathname: string }) {
  const items = getIntelligenceNavigationItems(enabledFeatures, isAdmin, isPlatformAdmin);
  if (!items.length) return null;
  return <NavGroupLinks group={{ label: 'Intelligence', items }} pathname={pathname} />;
}

export function AppSidebarNavigation({ enabledFeatures, isAdmin, isPlatformAdmin, isTaster }: { enabledFeatures: string[]; isAdmin: boolean; isPlatformAdmin: boolean; isTaster: boolean }) {
  const pathname = usePathname();
  const workItems = getNavigationItems('work', enabledFeatures);
  const accountItems = getNavigationItems('accounts', enabledFeatures);

  if (isTaster) {
    return (
      <nav aria-label="Primary navigation" className="app-sidebar-nav">
        <Link aria-current="page" className="app-nav-link app-nav-primary" href="/visits/new">
          Log Visit
        </Link>
        <NavLink item={{ href: '/admin/data-status', key: 'data-health', label: 'Data Status', section: 'utility' }} pathname={pathname} />
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

      <NavGroupLinks group={{ label: 'My Work', items: workItems }} pathname={pathname} />
      <NavGroupLinks group={{ label: 'Accounts', items: accountItems }} pathname={pathname} />
      <IntelligenceMenu enabledFeatures={enabledFeatures} isAdmin={isAdmin} isPlatformAdmin={isPlatformAdmin} pathname={pathname} />
      {!isAdmin && !isPlatformAdmin ? <NavLink item={{ href: '/admin/data-status', key: 'data-health', label: 'Data Status', section: 'utility' }} pathname={pathname} /> : null}

      {isAdmin || isPlatformAdmin ? <AdministrationMenu enabledFeatures={enabledFeatures} hasOrganizationAdminAccess={isAdmin} isPlatformAdmin={isPlatformAdmin} pathname={pathname} /> : null}
    </nav>
  );
}

type BreadcrumbItem = { href: string; label: string };

const getBreadcrumbs = (pathname: string): BreadcrumbItem[] => {
  if (pathname === '/') return [];

  const home = { href: '/', label: 'Home' };
  const routeMap: Array<{ prefix: string; crumbs: BreadcrumbItem[] }> = [
    { prefix: '/analytics', crumbs: [{ href: '/analytics', label: 'Analytics' }] },
    { prefix: '/visits/new', crumbs: [{ href: '/visits/new', label: 'Log Visit' }] },
    { prefix: '/visits/confirmed', crumbs: [{ href: '/visits', label: 'Visits' }, { href: pathname, label: 'Confirmed' }] },
    { prefix: '/visits', crumbs: [{ href: '/visits', label: 'Visit History' }] },
    { prefix: '/alerts', crumbs: [{ href: '/alerts', label: 'Worklist' }] },
    { prefix: '/opportunities', crumbs: [{ href: '/opportunities', label: 'Wholesale Opportunities' }] },
    { prefix: '/agency-focus', crumbs: [{ href: '/agency-focus', label: 'Agency Intelligence' }] },
    { prefix: '/my-week', crumbs: [{ href: '/alerts', label: 'My Work' }, { href: '/?view=week', label: 'My Schedule' }] },
    { prefix: '/agencies/', crumbs: [{ href: '/search', label: 'Accounts' }, { href: '/agencies', label: 'Agencies' }, { href: pathname, label: 'Agency' }] },
    { prefix: '/agencies', crumbs: [{ href: '/search', label: 'Accounts' }, { href: '/agencies', label: 'Agencies' }] },
    { prefix: '/wholesale-orders', crumbs: [{ href: '/search', label: 'Accounts' }, { href: '/wholesale-orders', label: 'Wholesale Orders' }] },
    { prefix: '/wholesale/', crumbs: [{ href: '/search', label: 'Accounts' }, { href: '/wholesale', label: 'Wholesale' }, { href: pathname, label: 'Account' }] },
    { prefix: '/wholesale', crumbs: [{ href: '/search', label: 'Accounts' }, { href: '/wholesale', label: 'Wholesale' }] },
    { prefix: '/tags', crumbs: [{ href: '/search', label: 'Accounts' }, { href: '/tags', label: 'Tags' }] },
    { prefix: '/search', crumbs: [{ href: '/search', label: 'Accounts' }] },
    { prefix: '/accounts', crumbs: [{ href: '/search', label: 'Accounts' }] },
    { prefix: '/users', crumbs: [{ href: '/users', label: 'Administration' }, { href: '/users', label: 'Users' }] },
    { prefix: '/admin/account-research', crumbs: [{ href: pathname, label: 'Account Research' }] },
    { prefix: '/admin/organization', crumbs: [{ href: '/users', label: 'Administration' }, { href: pathname, label: 'Organization Setup' }] },
    { prefix: '/admin/data-status', crumbs: [{ href: '/users', label: 'Administration' }, { href: pathname, label: 'Data Health' }] },
    { prefix: '/admin/weekly-digest', crumbs: [{ href: '/users', label: 'Administration' }, { href: pathname, label: 'Weekly Digest' }] },
    { prefix: '/admin/opportunity-performance', crumbs: [{ href: pathname, label: 'Opportunity Performance' }] },
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
      <details className="mobile-more" key={pathname} onClick={(event) => { if ((event.target as HTMLElement).closest("a")) event.currentTarget.open = false; }}>
        <summary><NavigationIcon name="more" /><span>More</span></summary>
        <div className="mobile-more-menu">
          <IntelligenceMenu enabledFeatures={enabledFeatures} isAdmin={isAdmin} isPlatformAdmin={isPlatformAdmin} pathname={pathname} />
          {moreItems.map((item) => (
            <NavLink item={item} key={item.key} pathname={pathname} />
          ))}
        </div>
      </details>
    </nav>
  );
}
