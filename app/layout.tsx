import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import { getCurrentUser, getUserDisplayName } from '../lib/auth';
import { APP_COMPANY, APP_DESCRIPTION, APP_NAME } from '../lib/appBrand';
import { isAdminRole, isTasterRole } from '../lib/userAccess';
import { getOrganizationContext, getOrganizationFeatures } from '../lib/organizations';
import Link from 'next/link';
import { AppBreadcrumbs, AppSidebarNavigation, MobileTabbar } from './components/AppNavigation';
import { GlobalSearchForm } from './components/GlobalSearchForm';
import './styles.css';
import { getAppEnvironment, getEnvironmentLabel } from '../lib/appEnvironment';

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: {
    default: APP_NAME,
    template: `%s | ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  appleWebApp: {
    capable: true,
    title: APP_NAME,
  },
  openGraph: {
    title: APP_NAME,
    description: APP_DESCRIPTION,
    siteName: APP_NAME,
    type: 'website',
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const appEnvironment = getAppEnvironment();
  const user = await getCurrentUser();
  const isTaster = user ? isTasterRole(user.role) : false;
  const organizationContext = user ? await getOrganizationContext(user) : null;
  const enabledFeatures = organizationContext ? [...await getOrganizationFeatures(organizationContext.organizationId)] : [];
  const isPlatformAdmin = user?.role === 'PLATFORM_ADMIN';
  const isAdmin = Boolean(user && isAdminRole(user.role) && (!isPlatformAdmin || organizationContext));
  const tenantAppName = organizationContext?.organization.appName || APP_NAME;
  const tenantCompany = organizationContext?.organization.displayName || APP_COMPANY;
  const tenantTheme = organizationContext
    ? ({
        '--accent': organizationContext.organization.brandPrimaryColor,
        '--accent-hover': `color-mix(in oklab, ${organizationContext.organization.brandPrimaryColor} 82%, black)`,
        '--accent-2': organizationContext.organization.brandAccentColor,
      } as CSSProperties)
    : undefined;

  return (
    <html lang="en">
      <body className={appEnvironment !== 'production' ? 'has-environment-banner' : undefined} style={tenantTheme}>
        {appEnvironment !== 'production' ? (
          <div className="environment-banner" role="status">
            {APP_NAME} — {getEnvironmentLabel().toUpperCase()} ENVIRONMENT
          </div>
        ) : null}
        {user ? (
          <>
            <aside>
              <div className="app-brand" aria-label={`${tenantAppName} for ${tenantCompany}`}>
                <strong>{tenantAppName}</strong>
                <span>{tenantCompany}</span>
              </div>
              {!isTaster ? <GlobalSearchForm compact /> : null}
              <AppSidebarNavigation enabledFeatures={enabledFeatures} isAdmin={isAdmin} isPlatformAdmin={isPlatformAdmin} isTaster={isTaster} />
              <div className="user-card">
                <span className="muted">Signed in as</span>
                <strong>{getUserDisplayName(user)}</strong>
                {organizationContext ? <span className="muted">{organizationContext.organization.displayName}</span> : null}
                <span className="pill">{isPlatformAdmin ? 'Platform Admin' : user.role === 'ADMIN' ? 'Admin' : isTaster ? 'Taster' : 'User'}</span>
                <Link className="user-card-profile" href="/profile">Profile &amp; preferences</Link>
                <form action="/api/auth/logout" method="post">
                  <button className="secondary" type="submit">
                    Sign out
                  </button>
                </form>
              </div>
            </aside>
            <main>
              {organizationContext?.isSupportView ? <div className="support-view-banner"><strong>Viewing Neat as {organizationContext.organization.displayName}</strong><form action="/platform/support-view/exit" method="post"><button className="secondary" type="submit">Exit Support View</button></form></div> : null}
              <AppBreadcrumbs isTaster={isTaster} />
              {children}
            </main>
            <Link className="fab" href="/visits/new" aria-label="Log Visit">
              +
            </Link>
            <MobileTabbar enabledFeatures={enabledFeatures} isAdmin={isAdmin} isPlatformAdmin={isPlatformAdmin} isTaster={isTaster} />
          </>
        ) : (
          <main className="public-main">{children}</main>
        )}
      </body>
    </html>
  );
}
