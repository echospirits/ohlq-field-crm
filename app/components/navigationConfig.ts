export type NavigationSection = 'work' | 'accounts' | 'production' | 'intelligence' | 'admin' | 'utility';

export type NavigationItem = {
  adminGroup?: 'Echo' | 'Data & insights' | 'System';
  adminOnly?: boolean;
  featureKey?: FeatureKey;
  href: string;
  key: string;
  label: string;
  matchPrefixes?: string[];
  mobileLabel?: string;
  mobileOrder?: number;
  moreOrder?: number;
  platformAdminOnly?: boolean;
  section: NavigationSection;
};

export const navigationItems: NavigationItem[] = [
  { key: 'home', href: '/', label: 'My Schedule', mobileLabel: 'Schedule', section: 'work', mobileOrder: 1 },
  { key: 'worklist', href: '/alerts', label: 'Worklist', mobileLabel: 'Work', section: 'work', mobileOrder: 2 },
  { key: 'production-supplies', href: '/production-supplies', label: 'Supplies', section: 'production', moreOrder: 0.6, featureKey: 'PRODUCTION_SUPPLIES' },
  { key: 'opportunities', href: '/opportunities', label: 'Restaurant Opportunities', section: 'intelligence', featureKey: 'WHOLESALE_OPPORTUNITIES' },
  { key: 'agency-intelligence', href: '/agency-focus', label: 'Retail Intelligence', section: 'intelligence', featureKey: 'AGENCY_INTELLIGENCE' },
  { key: 'visits', href: '/visits', label: 'Visit History', mobileLabel: 'Visits', section: 'work', mobileOrder: 4 },
  { key: 'analytics', href: '/analytics', label: 'Analytics', section: 'work', moreOrder: 1, featureKey: 'ANALYTICS' },
  { key: 'production-forecasting', href: '/analytics/production', label: 'Forecasting', section: 'production', moreOrder: 1.1, featureKey: 'PRODUCTION_FORECASTING' },
  {
    key: 'accounts',
    href: '/search',
    label: 'Account Search',
    mobileLabel: 'Accounts',
    section: 'accounts',
    mobileOrder: 3,
    matchPrefixes: ['/search', '/accounts', '/agencies', '/wholesale', '/wholesale-orders', '/tags'],
  },
  { key: 'agencies', href: '/agencies', label: 'Retail', section: 'accounts', moreOrder: 2 },
  { key: 'wholesale', href: '/wholesale', label: 'Restaurants', section: 'accounts', moreOrder: 3 },
  { key: 'wholesale-orders', href: '/wholesale-orders', label: 'Wholesale Orders', section: 'accounts', moreOrder: 4, featureKey: 'OHIO_DIRECT_WHOLESALE_ORDERS' },
  { key: 'pipeline', href: '/pipeline', label: 'Pipeline', section: 'accounts', moreOrder: 5, featureKey: 'ACCOUNT_SALES_STATUS' },
  { key: 'tags', href: '/tags', label: 'Tags', section: 'utility', moreOrder: 5 },
  { key: 'profile', href: '/profile', label: 'Profile', section: 'utility', moreOrder: 6 },
  { key: 'users', href: '/users', label: 'Users', section: 'admin', adminGroup: 'Echo', adminOnly: true, moreOrder: 7 },
  { key: 'user-activity', href: '/admin/user-activity', label: 'User activity', section: 'admin', adminGroup: 'Echo', adminOnly: true, moreOrder: 9 },
  { key: 'organization-setup', href: '/admin/organization', label: 'Echo Settings', section: 'admin', adminGroup: 'Echo', adminOnly: true, moreOrder: 7.1 },
  { key: 'weekly-digest', href: '/admin/weekly-digest', label: 'Weekly Digest', section: 'admin', adminGroup: 'Echo', adminOnly: true },
  { key: 'data-health', href: '/admin/data-status', label: 'Data Status', section: 'utility', adminGroup: 'Data & insights', moreOrder: 8 },
  { key: 'account-research', href: '/admin/account-research', label: 'Account Research', section: 'intelligence', adminOnly: true, featureKey: 'ADVANCED_INTELLIGENCE' },
  { key: 'opportunity-performance', href: '/admin/opportunity-performance', label: 'Opportunity Performance', section: 'intelligence', adminOnly: true, featureKey: 'WHOLESALE_OPPORTUNITIES' },
  { key: 'environment', href: '/admin/environment', label: 'Environment Diagnostics', section: 'admin', adminGroup: 'System', adminOnly: true },
];

const featureVisible = (item: NavigationItem, enabledFeatures?: readonly string[], isPlatformAdmin = false) =>
  !item.featureKey || !enabledFeatures || enabledFeatures.includes(item.featureKey);

export const getNavigationItems = (section: NavigationSection, enabledFeatures?: readonly string[], isPlatformAdmin = false) =>
  navigationItems.filter((item) => item.section === section && featureVisible(item, enabledFeatures, isPlatformAdmin) && (!item.platformAdminOnly || isPlatformAdmin));

export const getIntelligenceNavigationItems = (enabledFeatures: readonly string[], isAdmin: boolean, isPlatformAdmin: boolean) =>
  getNavigationItems('intelligence', enabledFeatures, isPlatformAdmin)
    .filter((item) => !item.adminOnly || isAdmin);

export const getMobileNavigationItems = () =>
  navigationItems
    .filter((item) => item.mobileOrder !== undefined)
    .sort((left, right) => (left.mobileOrder ?? 99) - (right.mobileOrder ?? 99));

const administrationGroupOrder = ['Echo', 'Data & insights', 'System'] as const;

export const getAdministrationNavigationGroups = (enabledFeatures?: readonly string[], isPlatformAdmin = false, hasOrganizationAdminAccess = true) =>
  administrationGroupOrder
    .map((label) => ({
      label,
      items: navigationItems.filter((item) =>
        item.adminGroup === label &&
        featureVisible(item, enabledFeatures) &&
        (!item.platformAdminOnly || isPlatformAdmin) &&
        hasOrganizationAdminAccess
      ),
    }))
    .filter((group) => group.items.length > 0);

export const getMoreNavigationItems = (isAdmin: boolean, enabledFeatures?: readonly string[], isPlatformAdmin = false) =>
  navigationItems
    .filter((item) => item.moreOrder !== undefined && (!item.adminOnly || isAdmin) && featureVisible(item, enabledFeatures, isPlatformAdmin) && (!item.platformAdminOnly || isPlatformAdmin))
    .sort((left, right) => (left.moreOrder ?? 99) - (right.moreOrder ?? 99));
import type { FeatureKey } from '../../lib/featureRegistry';
