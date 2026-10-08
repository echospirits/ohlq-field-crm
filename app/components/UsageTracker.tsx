'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

// Only foreground navigation and interaction count. Background polling and idle
// open tabs do not create active days. The server supplies identity and the day.
export function UsageTracker({ userId }: { userId: string }) {
  const pathname = usePathname();
  const recordedDay = useRef('');
  const lastAttempt = useRef(0);
  useEffect(() => {
    recordedDay.current = '';
    lastAttempt.current = 0;
  }, [userId]);
  useEffect(() => {
    let pending = false;
    const record = async () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      const today = new Date().toISOString().slice(0, 10);
      if (recordedDay.current === today || pending || Date.now() - lastAttempt.current < 60_000) return;
      pending = true;
      lastAttempt.current = Date.now();
      try {
        const response = await fetch('/api/user/activity', { method: 'POST', cache: 'no-store' });
        if (response.ok) recordedDay.current = (await response.json()).day;
      } catch {
        // Retry on a later interaction; network failures must not interrupt work.
      } finally {
        pending = false;
      }
    };
    void record();
    window.addEventListener('focus', record);
    document.addEventListener('visibilitychange', record);
    document.addEventListener('pointerdown', record, { passive: true });
    document.addEventListener('keydown', record);
    document.addEventListener('scroll', record, { passive: true });
    return () => {
      window.removeEventListener('focus', record);
      document.removeEventListener('visibilitychange', record);
      document.removeEventListener('pointerdown', record);
      document.removeEventListener('keydown', record);
      document.removeEventListener('scroll', record);
    };
  }, [pathname]);
  return null;
}
