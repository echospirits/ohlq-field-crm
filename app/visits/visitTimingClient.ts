import { isSampledVisitTimingId, visitTimingMaxMs, visitTimingPath, type VisitTimingOutcome } from '../../lib/visitTiming';

export type VisitTiming = {
  action: 'search' | 'save';
  id: string;
  startedAt: number;
  responseMs?: number;
  retried?: boolean;
};

const pendingSaveKey = 'neat.visit.pending-timing';
const now = () => performance.timeOrigin + performance.now();

export function sendVisitTiming(measurement: {
  id: string;
  action: 'form' | 'search' | 'save';
  outcome: VisitTimingOutcome;
  elapsedMs: number;
  responseMs?: number;
  navigation?: 'document' | 'route' | 'restored';
}) {
  void fetch(visitTimingPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(measurement),
    keepalive: true,
  }).catch(() => {});
}

export function beginVisitTiming(action: VisitTiming['action']): VisitTiming | null {
  const id = globalThis.crypto?.randomUUID?.();
  return isSampledVisitTimingId(id) ? { action, id, startedAt: now() } : null;
}

function readPendingSave(): VisitTiming | null {
  try {
    const pending = sessionStorage.getItem(pendingSaveKey);
    if (!pending) return null;
    const timing: VisitTiming = JSON.parse(pending);
    return timing.action === 'save' && isSampledVisitTimingId(timing.id) && Number.isFinite(timing.startedAt) ? timing : null;
  } catch { return null; }
}

function storePendingSave(timing: VisitTiming | null) {
  try {
    if (timing) sessionStorage.setItem(pendingSaveKey, JSON.stringify(timing));
    else sessionStorage.removeItem(pendingSaveKey);
  } catch { /* Timing is optional when storage is unavailable. */ }
}

export function markVisitResponse(timing: VisitTiming | null) {
  if (!timing || timing.responseMs !== undefined) return;
  timing.responseMs = Math.max(0, Math.round(now() - timing.startedAt));
  if (timing.action === 'save' && readPendingSave()?.id === timing.id) storePendingSave(timing);
}

export function finishVisitTiming(timing: VisitTiming | null, outcome: VisitTimingOutcome) {
  if (!timing) return;
  const { id, action, responseMs } = timing;
  const elapsedMs = Math.round(now() - timing.startedAt);
  if (elapsedMs >= 0 && elapsedMs <= visitTimingMaxMs) {
    sendVisitTiming({ id, action, outcome, elapsedMs, responseMs });
  }
}

export function beginVisitSave(formData: FormData, retried = false): VisitTiming | null {
  const timing = beginVisitTiming('save');
  if (timing && retried) timing.retried = true;
  storePendingSave(timing);
  if (timing) formData.set('visitTimingId', timing.id);
  return timing;
}

export function failVisitSave(timing: VisitTiming | null) {
  if (timing && readPendingSave()?.id === timing.id) storePendingSave(null);
  finishVisitTiming(timing, 'failed');
}

export function confirmVisitSaveTiming(id: string | undefined) {
  const timing = readPendingSave();
  if (!timing || timing.id !== id) return;
  storePendingSave(null);
  finishVisitTiming(timing, timing.retried ? 'retry' : 'success');
}
