'use client';

import { useEffect, useState } from 'react';

export function ActionNotice() {
  const [message, setMessage] = useState('');
  useEffect(() => {
    const show = (event: Event) => setMessage((event as CustomEvent<string>).detail);
    window.addEventListener('neat-action-success', show);
    return () => window.removeEventListener('neat-action-success', show);
  }, []);
  return <div role="status" aria-live="polite" className={message ? 'notice action-notice' : undefined}>{message}{message ? <button type="button" className="secondary compact-btn" onClick={() => setMessage('')} aria-label="Dismiss confirmation">Close</button> : null}</div>;
}
