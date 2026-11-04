// Server-only manual capture: no caller-selected tenant, provider, or credentials.
import type { UserRole } from '@prisma/client';
import { requireAdmin } from '../../auth';
import { requireOrganizationContext } from '../../organizations';
import { prisma } from '../../prisma';
import { isAdminRole } from '../../userAccess';
import { getOrganizationOperationalCredentials, openDockConfiguration, requireOperationalSignalOrganization } from './credentials';
import { OpenDockReadClient, type OpenDockCredentials } from './opendock';
import { deliveryAlreadyObservedToday, recordDeliveryAvailability } from './persistence';
import type { DeliveryAvailabilityResult, DeliveryRetrievalStatus, OpenDockLocationConfig } from './types';

type Actor = { id: string; organizationId: string | null; role: UserRole };
export type ManualDeliveryServices = {
  admin: () => Promise<Actor>;
  context: (actor: Actor) => Promise<{ organizationId: string }>;
  organization: (organizationId: string) => Promise<{ settings: unknown }>;
  credentials: (organizationId: string) => Promise<OpenDockCredentials | null>;
  observed: (organizationId: string, location: OpenDockLocationConfig, now: Date) => Promise<boolean>;
  client: (credentials: OpenDockCredentials) => Pick<OpenDockReadClient, 'availability'>;
  record: (organizationId: string, result: DeliveryAvailabilityResult) => Promise<unknown>;
};
const defaults: ManualDeliveryServices = {
  admin: requireAdmin,
  context: requireOrganizationContext,
  organization: organizationId => requireOperationalSignalOrganization(organizationId, prisma),
  credentials: organizationId => getOrganizationOperationalCredentials(organizationId, 'OPENDOCK'),
  observed: (organizationId, location, now) => deliveryAlreadyObservedToday(organizationId, location, now),
  client: credentials => new OpenDockReadClient(credentials, { timeoutMs: 8_000, totalTimeoutMs: 45_000 }),
  record: (organizationId, result) => recordDeliveryAvailability(organizationId, result),
};
export type ManualDeliveryResult = {
  status: 'complete' | 'partial' | 'failed' | 'not-configured';
  observed: number;
  reused: number;
  warehouses: { locationCode: string; status: DeliveryRetrievalStatus | 'REUSED' }[];
};
function failedResult(location: OpenDockLocationConfig, at: Date, status: 'AUTH_FAILED' | 'UNAVAILABLE' | 'NOT_CONFIGURED', diagnosticCode: string): DeliveryAvailabilityResult {
  return { market: location.market, locationCode: location.locationCode, locationName: location.locationName,
    warehouseId: location.warehouseId, loadTypeId: location.loadTypeId, timezone: location.timezone,
    observedAt: at.toISOString(), source: 'OPENDOCK', status, diagnosticCode,
    earliestAvailableAt: null, calendarDays: null, businessDays: null, businessDayMethod: null, checkedThrough: null };
}
const successful = (status: DeliveryRetrievalStatus | 'REUSED') => ['SUCCESS', 'NO_AVAILABILITY', 'REUSED'].includes(status);

/** Reuses the morning observation contract; never runs OPS imports or forecasts. */
export async function checkManualDeliveryAvailability({ services: overrides = {}, now = () => new Date() }: {
  services?: Partial<ManualDeliveryServices>; now?: () => Date;
} = {}): Promise<ManualDeliveryResult> {
  const services = { ...defaults, ...overrides };
  // Keep guards outside provider catches so redirects/denials are not swallowed.
  const actor = await services.admin();
  if (!isAdminRole(actor.role)) throw new Error('Administrator access required.');
  const { organizationId } = await services.context(actor);
  const organization = await services.organization(organizationId);
  const configuration = openDockConfiguration(organization.settings);
  if (!configuration.configured) return { status: 'not-configured', observed: 0, reused: 0, warehouses: [] };

  const pending = await Promise.all(configuration.locations.map(async location => {
    try { return { location, state: await services.observed(organizationId, location, now()) ? 'reused' as const : 'pending' as const }; }
    catch { return { location, state: 'failed' as const }; }
  }));
  let client: Pick<OpenDockReadClient, 'availability'> | null = null;
  let missingCredentials = false;
  if (pending.some(value => value.state === 'pending')) {
    try {
      const credentials = await services.credentials(organizationId);
      missingCredentials = credentials === null;
      if (credentials) client = services.client(credentials);
    } catch { /* Persist a safe authentication check for each pending warehouse. */ }
  }
  const warehouses = await Promise.all(pending.map(async ({ location, state }) => {
    if (state === 'reused') return { locationCode: location.locationCode, status: 'REUSED' as const };
    try {
      const at = now();
      const result = state === 'failed'
        ? failedResult(location, at, 'UNAVAILABLE', 'OPENDOCK_DAILY_LOOKUP_FAILED')
        : client
          ? await client.availability(location, at)
          : failedResult(location, at, missingCredentials ? 'NOT_CONFIGURED' : 'AUTH_FAILED', missingCredentials ? 'OPENDOCK_CREDENTIALS_NOT_CONFIGURED' : 'OPENDOCK_CREDENTIALS_UNAVAILABLE');
      await services.record(organizationId, result);
      return { locationCode: location.locationCode, status: result.status };
    } catch {
      // A provider or persistence failure must not suppress the other warehouse.
      try { await services.record(organizationId, failedResult(location, now(), 'UNAVAILABLE', 'OPENDOCK_MANUAL_CHECK_FAILED')); } catch { /* Earlier good facts remain intact. */ }
      return { locationCode: location.locationCode, status: 'UNAVAILABLE' as const };
    }
  }));
  const good = warehouses.filter(value => successful(value.status)).length;
  return {
    status: good === warehouses.length ? 'complete' : good ? 'partial' : missingCredentials ? 'not-configured' : 'failed',
    observed: warehouses.filter(value => value.status === 'SUCCESS' || value.status === 'NO_AVAILABILITY').length,
    reused: warehouses.filter(value => value.status === 'REUSED').length,
    warehouses,
  };
}
