import { isSampledVisitTimingId } from './visitTiming';

export function startVisitServerTiming(id: unknown, action: 'search' | 'form') {
  if (!isSampledVisitTimingId(id)) return null;
  const startedAt = performance.now();
  const stages: Partial<Record<'authenticated' | 'loaded', number>> = {};
  const elapsed = () => Math.round(performance.now() - startedAt);

  return {
    mark(stage: 'authenticated' | 'loaded') { stages[stage] = elapsed(); },
    finish(outcome: 'success' | 'failed') {
      console.info(JSON.stringify({ event: 'visit.timing.server', id, action, outcome, elapsedMs: elapsed(), stages }));
    },
  };
}
