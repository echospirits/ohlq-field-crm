export default function ImportPage() {
  return (
    <>
      <h1>Data Imports</h1>
      <div className="card">
        <h2>Initial supported imports</h2>
        <p>OHLQ Account Master, Partner Agencies, Annual Sales Summary monthly files, Item Coverage files, Eventbrite events, and recipes CSV.</p>
        <pre>npm run import:sample</pre>
        <a className="btn" href="/accounts" style={{ marginTop: 12 }}>
          Import agencies/accounts CSV
        </a>
      </div>
    </>
  );
}