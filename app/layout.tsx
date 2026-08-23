import type { Metadata } from 'next';
import { getCurrentUser, getUserDisplayName } from '../lib/auth';
import { APP_COMPANY, APP_DESCRIPTION, APP_NAME } from '../lib/appBrand';
import { isTasterRole } from '../lib/userAccess';
import Link from 'next/link';
import { AppBreadcrumbs, AppSidebarNavigation, MobileTabbar } from './components/AppNavigation';
import { GlobalSearchForm } from './components/GlobalSearchForm';
import './styles.css';

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
  const user = await getCurrentUser();
  const isTaster = user ? isTasterRole(user.role) : false;

  return (
    <html lang="en">
      <body>
        {user ? (
          <>
            <aside>
              <div className="app-brand" aria-label={`${APP_NAME} by ${APP_COMPANY}`}>
                <strong>{APP_NAME}</strong>
                <span>{APP_COMPANY}</span>
              </div>
              {!isTaster ? <GlobalSearchForm compact /> : null}
              <AppSidebarNavigation isAdmin={user.role === 'ADMIN'} isTaster={isTaster} />
              <div className="user-card">
                <span className="muted">Signed in as</span>
                <strong>{getUserDisplayName(user)}</strong>
                <span className="pill">{user.role === 'ADMIN' ? 'Admin' : isTaster ? 'Taster' : 'User'}</span>
                <Link className="user-card-profile" href="/profile">Profile &amp; preferences</Link>
                <form action="/api/auth/logout" method="post">
                  <button className="secondary" type="submit">
                    Sign out
                  </button>
                </form>
              </div>
            </aside>
            <main>
              <AppBreadcrumbs isTaster={isTaster} />
              {children}
            </main>
            <Link className="fab" href="/visits/new" aria-label="Log Visit">
              +
            </Link>
            <MobileTabbar isAdmin={user.role === 'ADMIN'} isTaster={isTaster} />
          </>
        ) : (
          <main className="public-main">{children}</main>
        )}
      </body>
    </html>
  );
}
