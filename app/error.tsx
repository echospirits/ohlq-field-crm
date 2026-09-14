'use client';

export default function WorkspaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section className="empty-state" role="alert">
    <div><h2>This view couldn’t load</h2><p className="muted">Try again. If you were saving a record, check its history before submitting it again.</p></div>
    <button onClick={reset} type="button">Try again</button>
  </section>;
}
