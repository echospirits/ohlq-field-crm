export default function Loading() {
  return <section aria-busy="true" aria-label="Loading workspace" className="workspace-loading">
    <p role="status">Loading your workspace…</p>
    <div aria-hidden="true" className="loading-placeholder" />
    <div aria-hidden="true" className="loading-placeholder" />
  </section>;
}
