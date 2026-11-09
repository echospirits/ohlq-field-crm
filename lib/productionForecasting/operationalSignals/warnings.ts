import { appendFileSync } from 'node:fs';
import type { DeliveryAvailabilityResult } from './types';

const temporaryCodes = new Set([
  'OPENDOCK_TIMEOUT',
  'OPENDOCK_NETWORK_OR_TIMEOUT',
  'OPENDOCK_UPSTREAM_UNAVAILABLE',
  'OPENDOCK_RATE_LIMITED',
]);

/** Persistence, authentication and unrecognized failures must still fail the job. */
export function isTemporaryOpenDockFailure(result: Pick<DeliveryAvailabilityResult, 'status' | 'diagnosticCode'>) {
  return result.status === 'UNAVAILABLE' && temporaryCodes.has(result.diagnosticCode ?? '');
}

export function reportOpenDockLookupWarning(
  result: DeliveryAvailabilityResult,
  log: (message: string) => void,
  env: Record<string, string | undefined> = process.env,
) {
  if (!isTemporaryOpenDockFailure(result)) throw new Error('Only temporary OpenDock lookup failures can be warnings.');
  // Use fixed labels and allowlisted codes; no provider text, tenant settings or credentials enter annotations.
  const location = result.locationCode === 'GRN' ? 'Green' : result.locationCode === 'GPT' ? 'Groveport' : 'warehouse';
  const message = `OpenDock ${location} delivery lookup is temporarily unavailable (${result.diagnosticCode}). Previous successful observations retained; current availability is unknown. The next load can retry this lookup.`;
  log(env.GITHUB_ACTIONS === 'true' ? `::warning::${message}` : `Warning: ${message}`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `\n### OpenDock lookup warning\n\n${message}\n`);
}
