import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../prisma';
import { ECHO_ORGANIZATION_ID } from '../../echoAccess';
import { formatDateInputValue } from '../../dateTime';
import { getOrganizationOhlqCredentials } from '../../ohlqTenantCredentials';
import { downloadOhlqCurrentDemand, downloadOhlqDcInventory, type OhlqAnnualSalesDownloadOptions } from '../../ohlqAnnualSalesReport';
import { currentDemandProducts, ingestCurrentDemand } from './demandIngestion';
import { dcInventoryAlreadyObservedToday, ingestDcInventory } from './dcInventoryIngestion';
import { DC_INVENTORY_SOURCE, type DcInventoryDownload } from './dcInventory';
import { getOrganizationOperationalCredentials, openDockConfiguration } from './credentials';
import { OpenDockReadClient } from './opendock';
import { deliveryAlreadyObservedToday, recordDeliveryAvailability } from './persistence';
import { isTemporaryOpenDockFailure, reportOpenDockLookupWarning } from './warnings';
import type { DeliveryAvailabilityResult, OpenDockLocationConfig } from './types';

const defaults = {
  deliveryCredentials: getOrganizationOperationalCredentials,
  deliveryClient: (credentials: { email: string; password: string }): Pick<OpenDockReadClient, 'availability'> => new OpenDockReadClient(credentials),
  deliveryObserved: deliveryAlreadyObservedToday,
  recordDelivery: recordDeliveryAvailability,
  products: currentDemandProducts,
  opsCredentials: getOrganizationOhlqCredentials,
  downloadDemand: downloadOhlqCurrentDemand,
  ingestDemand: ingestCurrentDemand,
  inventoryObserved: dcInventoryAlreadyObservedToday,
  downloadInventory: async (options: OhlqAnnualSalesDownloadOptions): Promise<DcInventoryDownload> => {
    const result = await downloadOhlqDcInventory({ ...options, returnBuffer: true });
    const observedAt = new Date().toISOString();
    return result.csvBuffer
      ? { status: 'ok', csv: result.csvBuffer.toString('utf8'), reportDate: result.reportDate, observedAt }
      : { status: 'failed', reason: 'invalid-response', observedAt };
  },
  ingestInventory: ingestDcInventory,
};
export type OperationalSignalServices = typeof defaults;
function unavailable(location: OpenDockLocationConfig, at: Date, status: 'AUTH_FAILED' | 'UNAVAILABLE' | 'NOT_CONFIGURED', diagnosticCode: string): DeliveryAvailabilityResult {
  return { market: location.market, locationCode: location.locationCode, locationName: location.locationName, warehouseId: location.warehouseId, loadTypeId: location.loadTypeId, timezone: location.timezone, source: 'OPENDOCK', observedAt: at.toISOString(), status, earliestAvailableAt: null, calendarDays: null, businessDays: null, businessDayMethod: null, checkedThrough: null, diagnosticCode };
}

/** Scheduled runs reuse complete daily facts; an authorized manual refresh
 * re-observes warehouse stock. Signals and warehouses fail independently. */
export async function syncOperationalSignals({ db = prisma, services: overrides = {}, logger = console, now: injectedNow, refreshInventory = false }: {
  db?: PrismaClient; services?: Partial<OperationalSignalServices>; logger?: Pick<Console, 'log' | 'error'>; now?: Date; refreshInventory?: boolean;
} = {}) {
  const services = { ...defaults, ...overrides };
  const now = injectedNow ?? new Date();
  const inventoryClock = () => injectedNow ?? new Date();
  const organizations = await db.organization.findMany({
    where: { id: ECHO_ORGANIZATION_ID, active: true, accountStatus: { notIn: ['SUSPENDED', 'CANCELLED'] }, enabledStates: { has: 'OH' }, features: { some: { featureKey: 'PRODUCTION_FORECASTING', enabled: true } } },
    select: { id: true, settings: true, timezone: true }, orderBy: { id: 'asc' },
  });
  let deliveryObserved = 0, demandObserved = 0, reused = 0, skipped = 0, failed = 0, unavailableDemand = 0, warnings = 0;
  let inventoryObserved = 0, unavailableInventory = 0, inventorySkipped = 0;
  for (const organization of organizations) {
    if (organization.id !== ECHO_ORGANIZATION_ID) continue;
    let opsCredentialsPromise: ReturnType<OperationalSignalServices['opsCredentials']> | undefined;
    const opsCredentials = () => opsCredentialsPromise ??= services.opsCredentials(organization.id, db).catch(() => null);
    const configuration = openDockConfiguration(organization.settings);
    if (!configuration.configured) {
      skipped++;
      logger.log(JSON.stringify({ organizationId: organization.id, source: 'OPENDOCK', status: 'NOT_CONFIGURED' }));
    } else {
      let credentials: { email: string; password: string } | null = null, credentialFailure = false;
      try { credentials = await services.deliveryCredentials(organization.id, 'OPENDOCK', db); } catch { credentialFailure = true; }
      let client: Pick<OpenDockReadClient, 'availability'> | null = null;
      if (credentials) {
        try { client = services.deliveryClient(credentials); } catch { credentialFailure = true; }
      }
      for (const location of configuration.locations) {
        try {
          if (await services.deliveryObserved(organization.id, location, now, db)) { reused++; continue; }
          const result = client
            ? await client.availability(location, now.toISOString())
            : unavailable(location, now, credentialFailure ? 'AUTH_FAILED' : 'NOT_CONFIGURED', credentialFailure ? 'CREDENTIALS_UNAVAILABLE' : 'CREDENTIALS_NOT_CONFIGURED');
          await services.recordDelivery(organization.id, result, db);
          if (result.status === 'SUCCESS' || result.status === 'NO_AVAILABILITY') deliveryObserved++;
          else if (result.status === 'NOT_CONFIGURED') skipped++;
          else if (isTemporaryOpenDockFailure(result)) {
            reportOpenDockLookupWarning(result, message => logger.log(message));
            warnings++;
          }
          else failed++;
          const log = result.status === 'SUCCESS' || result.status === 'NO_AVAILABILITY' || result.status === 'NOT_CONFIGURED' || isTemporaryOpenDockFailure(result) ? logger.log : logger.error;
          log(JSON.stringify({ organizationId: organization.id, source: 'OPENDOCK', locationCode: location.locationCode, status: result.status, diagnosticCode: result.diagnosticCode, severity: isTemporaryOpenDockFailure(result) ? 'warning' : undefined }));
        } catch {
          failed++;
          // A malformed provider response must not stop the other warehouse.
          try { await services.recordDelivery(organization.id, unavailable(location, now, 'UNAVAILABLE', 'INGESTION_FAILED'), db); } catch { /* Retain the last good observation even if status storage is unavailable. */ }
          logger.error(JSON.stringify({ organizationId: organization.id, source: 'OPENDOCK', locationCode: location.locationCode, status: 'UNAVAILABLE', reason: 'INGESTION_FAILED' }));
        }
      }
    }

    // Inventory has its own completion/retry state. Run before demand's early
    // exits so an already observed demand estimate cannot suppress this source.
    try {
      const startedAt = inventoryClock();
      if (!refreshInventory && await services.inventoryObserved(organization.id, db, startedAt)) {
        inventorySkipped++;
      } else {
        const credentials = await opsCredentials();
        if (!credentials) {
          inventorySkipped++;
          if (refreshInventory) failed++;
          logger.log(JSON.stringify({ organizationId: organization.id, source: DC_INVENTORY_SOURCE, status: 'NOT_CONFIGURED' }));
        } else {
          let download: DcInventoryDownload;
          try {
            download = await services.downloadInventory({
              headless: true, partnerCredentials: credentials, reportDate: formatDateInputValue(startedAt, organization.timezone), returnBuffer: true,
              debugDir: path.join(os.tmpdir(), 'ohlq-private', organization.id, 'dc-inventory', 'playwright'),
              downloadDir: path.join(os.tmpdir(), 'ohlq-private', organization.id, 'dc-inventory', 'downloads'),
              logger: { log: () => undefined, error: () => undefined }, useServerlessChromium: process.env.VERCEL === '1',
            });
          } catch (error) {
            const authentication = error instanceof Error && /incorrect username or password|returned to login|sign.in.*(failed|timeout)/i.test(error.message);
            download = { status: 'failed', observedAt: inventoryClock().toISOString(), reason: authentication ? 'upstream-authentication' : 'upstream-unavailable' };
          }
          // Use actual completion time after the provider wait. Fixed clocks are
          // explicit test/operator inputs; the report's own As_of_Date remains
          // independently required by ingestion before any current balance.
          const checkedAt = inventoryClock();
          const result = await services.ingestInventory({ organizationId: organization.id, businessDate: formatDateInputValue(checkedAt, organization.timezone), download: { ...download, observedAt: checkedAt.toISOString() }, db, now: checkedAt, refresh: refreshInventory });
          inventoryObserved += result.available;
          unavailableInventory += result.unavailable;
          // A deliberate refresh must report incomplete stock as partial. Native
          // status30 is an expected exclusion; missing/stale/malformed data is not.
          const sourceIneligible = result.results.filter(row => row.status === 'unavailable' && row.reason === 'SOURCE_INELIGIBLE').length;
          const unavailableFailures = refreshInventory ? Math.max(0, result.unavailable - sourceIneligible) : 0;
          const inventoryFailures = result.failed + unavailableFailures;
          failed += inventoryFailures;
          const log = inventoryFailures ? logger.error : logger.log;
          log(JSON.stringify({ organizationId: organization.id, source: DC_INVENTORY_SOURCE, status: inventoryFailures ? 'PARTIAL_FAILURE' : result.unavailable ? 'DATA_UNAVAILABLE' : 'COMPLETE', available: result.available, unavailable: result.unavailable, failed: result.failed, unavailableFailures, reused: result.reused }));
        }
      }
    } catch {
      failed++;
      logger.error(JSON.stringify({ organizationId: organization.id, source: DC_INVENTORY_SOURCE, status: 'UNAVAILABLE', reason: 'INGESTION_FAILED' }));
    }

    // OPS case demand is independent of delivery setup, source import success and
    // whether a tenant's OPS credential relation was present in another query.
    try {
      const businessDate = formatDateInputValue(now, organization.timezone);
      const products = await services.products(organization.id, db);
      const existing = products.length ? await db.currentDemandObservation.findMany({ where: { organizationId: organization.id, productId: { in: products.map(product => product.id) }, businessDate: new Date(businessDate) }, select: { productId: true } }) : [];
      const completed = new Set(existing.map(row => row.productId));
      const pending = products.filter(product => !completed.has(product.id));
      reused += products.length - pending.length;
      if (!pending.length) continue;
      const credentials = await opsCredentials();
      if (!credentials) {
        skipped += pending.length;
        logger.log(JSON.stringify({ organizationId: organization.id, source: 'OPS_OHLQ_ITEM_COVERAGE', status: 'NOT_CONFIGURED', products: pending.length }));
        continue;
      }
      const download = await services.downloadDemand({
        headless: true, partnerCredentials: credentials, itemCodes: pending.map(product => product.code),
        debugDir: path.join(os.tmpdir(), 'ohlq-private', organization.id, 'current-demand', 'playwright'),
        downloadDir: path.join(os.tmpdir(), 'ohlq-private', organization.id, 'current-demand', 'downloads'),
        logger: { log: () => undefined, error: () => undefined }, useServerlessChromium: process.env.VERCEL === '1',
      });
      const result = await services.ingestDemand({ organizationId: organization.id, businessDate, download, db, now });
      demandObserved += result.available;
      unavailableDemand += result.unavailable;
      failed += result.failed;
      logger.log(JSON.stringify({ organizationId: organization.id, source: 'OPS_OHLQ_ITEM_COVERAGE', status: result.failed ? 'PARTIAL_FAILURE' : result.unavailable ? 'DATA_UNAVAILABLE' : 'COMPLETE', available: result.available, unavailable: result.unavailable, failed: result.failed, reused: result.reused }));
    } catch {
      failed++;
      logger.error(JSON.stringify({ organizationId: organization.id, source: 'OPS_OHLQ_ITEM_COVERAGE', status: 'UNAVAILABLE', reason: 'INGESTION_FAILED' }));
    }
  }
  return { configuredOrganizations: organizations.length, deliveryObserved, demandObserved, inventoryObserved, unavailableInventory, inventorySkipped, reused, skipped, failed, unavailableDemand, warnings };
}
