'use client';

import { useEffect } from 'react';

export const APPEARANCE_EVENT = 'neat-appearance-changed';

export function applyAppearance(darkMode: boolean) {
  document.documentElement.dataset.theme = darkMode ? 'dark' : 'light';
  window.dispatchEvent(new CustomEvent(APPEARANCE_EVENT, { detail: darkMode }));
}

export function AppearanceSync({ darkMode }: { darkMode: boolean }) {
  useEffect(() => {
    applyAppearance(darkMode);
    let controller: AbortController | undefined;
    const cancel = () => controller?.abort();
    const sync = async () => {
      if (document.visibilityState !== 'visible') return;
      cancel();
      controller = new AbortController();
      try {
        const response = await fetch('/api/user/appearance', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json();
        if (typeof data.darkMode === 'boolean' && document.documentElement.dataset.theme !== (data.darkMode ? 'dark' : 'light')) {
          applyAppearance(data.darkMode);
        }
      } catch {
        // A temporary network failure keeps the last confirmed preference.
      }
    };
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener(APPEARANCE_EVENT, cancel);
    const interval = window.setInterval(sync, 60_000);
    return () => {
      cancel();
      window.clearInterval(interval);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener(APPEARANCE_EVENT, cancel);
    };
  }, [darkMode]);
  return null;
}
