export type NavigationSection = 'work' | 'accounts' | 'admin' | 'utility';

export type NavigationItem = {
  adminOnly?: boolean;
  featureKey?: FeatureKey;
  href: string;
  key: string;
  label: string;
  matchPrefixes?: string[];
  mobileLabel?: string;
  mobileOrder?: number;
  moreOrder?: number;
  section: NavigationSection;
};

export const navigationItems: NavigationItem[] = [
  { key: 'home', href: '/', label: 'Home', section: 'work', mobileOrder: 1 },
  { key: 'worklist', href: '/alerts', label: 'Worklist', mobileLabel: 'Work', section: 'work', mobileOrder: 2 },
  { key: 'opportunities', href: '/opportunities', label: 'Opportunities', section: 'work', moreOrder: 1, featureKey: 'WHOLESALE_OPPORTUNITIES' },
  { key: 'my-week', href: '/my-week', label: 'My Week', section: 'work', moreOrder: 2 },
  { key: 'visits', href: '/visits', label: 'Visit History', mobileLabel: 'Visits', section: 'work', mobileOrder: 4 },
  {
    key: 'accounts',
    href: '/accounts',
    label: 'Accounts Overview',
    mobileLabel: 'Accounts',
    section: 'accounts',
    mobileOrder: 3,
    matchPrefixes: ['/accounts', '/agencies', '/wholesale', '/tags'],
  },
  { key: 'agencies', href: '/agencies', label: 'Agencies', section: 'accounts', moreOrder: 2 },
  { key: 'wholesale', href: '/wholesale', label: 'Wholesale', section: 'accounts', moreOrder: 3 },
  { key: 'tags', href: '/tags', label: 'Tags', section: 'utility', moreOrder: 5 },
  { key: 'search', href: '/search', label: 'Search', section: 'utility', moreOrder: 0 },
  { key: 'profile', href: '/profile', label: 'Profile', section: 'utility', moreOrder: 6 },
  { key: 'users', href: '/users', label: 'Users', section: 'admin', adminOnly: true, moreOrder: 7 },
  { key: 'account-research', href: '/admin/account-research', label: 'Account Research', section: 'admin', adminOnly: true },
  { key: 'data-health', href: '/admin/data-status', label: 'Data Health', section: 'admin', adminOnly: true },
  { key: 'environment', href: '/admin/environment', label: 'Environment', section: 'admin', adminOnly: true },
  { key: 'weekly-digest', href: '/admin/weekly-digest', label: 'Weekly Digest', section: 'admin', adminOnly: true },
  { key: 'opportunity-performance', href: '/admin/opportunity-performance', label: 'Opportunity Performance', section: 'admin', adminOnly: true },
];

const featureVisible = (item: NavigationItem, enabledFeatures?: readonly string[]) =>
  !item.featureKey || !enabledFeatures || enabledFeatures.includes(item.featureKey);

export const getNavigationItems = (section: NavigationSection, enabledFeatures?: readonly string[]) =>
  navigationItems.filter((item) => item.section === section && featureVisible(item, enabledFeatures));

export const getMobileNavigationItems = () =>
  navigationItems
    .filter((item) => item.mobileOrder !== undefined)
    .sort((left, right) => (left.mobileOrder ?? 99) - (right.mobileOrder ?? 99));

export const getMoreNavigationItems = (isAdmin: boolean, enabledFeatures?: readonly string[]) =>
  navigationItems
    .filter((item) => item.moreOrder !== undefined && (!item.adminOnly || isAdmin) && featureVisible(item, enabledFeatures))
    .sort((left, right) => (left.moreOrder ?? 99) - (right.moreOrder ?? 99));
import type { FeatureKey } from '../../lib/featureRegistry';
