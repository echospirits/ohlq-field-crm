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
              <a href="/visits">Visits</a>
              <a href="/alerts">Worklist</a>
              <div className="user-card">
                <span className="muted">Signed in as</span>
                <strong>{getUserDisplayName(user)}</strong>
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
          </>
        ) : (
          <main className="public-main">{children}</main>
        )}
      </body>
    </html>
  );
}
