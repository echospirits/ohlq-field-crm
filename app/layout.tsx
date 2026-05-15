import { getCurrentUser, getUserDisplayName } from '../lib/auth';
import { AppSidebarNavigation, MobileTabbar } from './components/AppNavigation';
import './styles.css';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  return (
    <html lang="en">
      <body>
        {user ? (
          <>
            <aside>
              <h2>Echo Spirits Distilling Co.</h2>
              <AppSidebarNavigation isAdmin={user.role === 'ADMIN'} />
              <div className="user-card">
                <span className="muted">Signed in as</span>
                <strong>{getUserDisplayName(user)}</strong>
                <span className="pill">{user.role === 'ADMIN' ? 'Admin' : 'User'}</span>
                <form action="/api/auth/logout" method="post">
                  <button className="secondary" type="submit">
                    Sign out
                  </button>
                </form>
              </div>
            </aside>
            <main>{children}</main>
            <a className="fab" href="/visits/new" aria-label="Log Visit">
              +
            </a>
            <MobileTabbar />
          </>
        ) : (
          <main className="public-main">{children}</main>
        )}
      </body>
    </html>
  );
}
