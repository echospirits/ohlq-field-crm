import { timingSafeEqual } from 'node:crypto';

/** Native cron keeps its existing key; an external scheduler can use a dedicated key. */
export function isSupplyJobAuthorized(authorization: string | null, env: Record<string, string | undefined> = process.env): boolean {
  if (!authorization) return false;
  const actual = new TextEncoder().encode(authorization);
  let authorized = false;
  for (const secret of [env.CRON_SECRET, env.SUPPLY_JOB_SECRET]) {
    if (!secret) continue;
    const expected = new TextEncoder().encode(`Bearer ${secret}`);
    // Both configured credentials are checked; never compare secret strings directly.
    const matches = expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
    authorized = matches || authorized;
  }
  return authorized;
}
