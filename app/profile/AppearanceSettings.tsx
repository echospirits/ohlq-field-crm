'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { APPEARANCE_EVENT, applyAppearance } from '../components/AppearanceSync';

export function AppearanceSettings({ darkMode }: { darkMode: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(darkMode);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    setEnabled(darkMode);
    const changed = (event: Event) => setEnabled((event as CustomEvent<boolean>).detail);
    window.addEventListener(APPEARANCE_EVENT, changed);
    return () => window.removeEventListener(APPEARANCE_EVENT, changed);
  }, [darkMode]);

  const toggle = async () => {
    if (pending) return;
    setPending(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/user/appearance', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ darkMode: !enabled }),
      });
      const data = await response.json();
      if (!response.ok || typeof data.darkMode !== 'boolean') throw new Error(data.error || 'Could not save Dark mode. Please try again.');
      setEnabled(data.darkMode);
      applyAppearance(data.darkMode);
      setNotice(`Dark mode ${data.darkMode ? 'on' : 'off'}. Saved for all your devices.`);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save Dark mode. Please try again.');
    } finally {
      setPending(false);
    }
  };

  return <section className="appearance-section" aria-labelledby="appearance-heading">
    <h2 id="appearance-heading">Appearance</h2>
    <div className="appearance-setting">
      <div><strong id="dark-mode-label">Dark mode</strong><p id="dark-mode-help" className="muted">Use darker surfaces in low light. Saves automatically for your account on mobile and desktop.</p></div>
      <button type="button" className="appearance-switch secondary" role="switch" aria-checked={enabled} aria-labelledby="dark-mode-label" aria-describedby="dark-mode-help" aria-busy={pending} disabled={pending} onClick={toggle}>
        <span className="appearance-switch-track" aria-hidden="true"><span /></span><span>{pending ? 'Saving…' : enabled ? 'On' : 'Off'}</span>
      </button>
    </div>
    <p role="status" className="muted appearance-feedback">{notice}</p>
    {error ? <p role="alert" className="form-error">{error}</p> : null}
  </section>;
}
