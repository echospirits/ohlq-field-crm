import { getCurrentUser, getUserDisplayName } from '../lib/auth';
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
              <a href="/">Dashboard</a>
              <a href="/agencies">Liquor Agencies</a>
              <a href="/wholesale">Wholesale Accounts</a>
              <a href="/recipes">Recipe Database</a>
              <a href="/tags">Tags</a>
              <a href="/visits">Visits</a>
              <a href="/my-week">My Week</a>
              <a href="/alerts">Worklist</a>
              <a href="/profile">Profile</a>
              {user.role === 'ADMIN' ? <a href="/users">Users</a> : null}
              {user.role === 'ADMIN' ? <a href="/admin/weekly-digest">Weekly Digest</a> : null}
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
            <nav className="mobile-tabbar" aria-label="Quick field actions">
              <a href="/my-week">My Week</a>
              <a href="/alerts">Worklist</a>
              <a href="/agencies">Agencies</a>
              <a href="/wholesale">Wholesale</a>
              <a href="/recipes">Recipes</a>
            </nav>
          </>
        ) : (
          <main className="public-main">{children}</main>
        )}
      </body>
    </html>
  );
}
