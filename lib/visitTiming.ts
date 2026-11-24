export const visitTimingPath = '/api/visits/timing';
export const visitTimingMaxMs = 180_000;

export function isSampledVisitTimingId(value: unknown): value is string {
  // The prefix selects 1 in 32 randomly generated UUIDs. The rest is opaque correlation data.
  return typeof value === 'string' && /^0[0-7][0-9a-f]{6}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

export type VisitTimingOutcome = 'success' | 'failed' | 'retry' | 'cancelled';
