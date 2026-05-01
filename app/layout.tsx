import './styles.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <aside>
          <h2>Echo Field CRM</h2>
          <a href="/">Dashboard</a>
          <a href="/agencies">Liquor Agencies</a>
          <a href="/wholesale">Wholesale Accounts</a>
          <a href="/visits">Visits</a>
          <a href="/alerts">Worklist</a>
        </aside>
        <main>{children}</main>
        <a className="fab" href="/visits/new" aria-label="Log Visit">
          ＋
        </a>
      </body>
    </html>
  );
}
