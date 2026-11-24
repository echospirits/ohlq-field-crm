'use client';

import { useEffect } from 'react';
import { isSampledVisitTimingId, visitTimingMaxMs } from '../../lib/visitTiming';
import { confirmVisitSaveTiming, sendVisitTiming } from './visitTimingClient';

function afterPaint(work: () => void) {
  let nextFrame = 0;
  const frame = requestAnimationFrame(() => { nextFrame = requestAnimationFrame(work); });
  return () => { cancelAnimationFrame(frame); cancelAnimationFrame(nextFrame); };
}

export function VisitSaveConfirmationTiming({ id }: { id?: string }) {
  useEffect(() => {
    if (!isSampledVisitTimingId(id)) return;
    return afterPaint(() => confirmVisitSaveTiming(id));
  }, [id]);
  return null;
}

export function VisitFormTiming({ id }: { id: string }) {
  useEffect(() => {
    if (!isSampledVisitTimingId(id)) return;
    return afterPaint(() => {
      const here = new URL(window.location.href);
      const matchesRoute = (entry: PerformanceEntry) => {
        const url = new URL(entry.name);
        url.searchParams.delete('_rsc');
        return url.origin === here.origin && url.pathname === here.pathname && String(url.searchParams) === String(here.searchParams);
      };
      const navigation = performance.getEntriesByType('navigation')[0];
      const route = performance.getEntriesByType('resource').filter(matchesRoute).at(-1);
      const source = route ?? (navigation && matchesRoute(navigation) ? navigation : null);
      if (!source) return;
      const elapsedMs = Math.round(performance.now() - source.startTime);
      if (elapsedMs <= visitTimingMaxMs) {
        sendVisitTiming({ id, action: 'form', outcome: 'success', elapsedMs, navigation: route ? 'route' : 'document' });
      }
    });
  }, [id]);
  return null;
}
