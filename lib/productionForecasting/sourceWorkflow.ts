import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../prisma';
import { ECHO_ORGANIZATION_ID } from '../echoAccess';
import { getOrganizationOhlqCredentials } from '../ohlqTenantCredentials';
import { downloadOhlqBailmentInvoices, downloadOhlqPartnerDc } from '../ohlqAnnualSalesReport';
import { formatDateInputValue } from '../dateTime';
import { importProductionSource, type ImportOptions, type SourceKind } from './import';
import { shift } from './model';
import { ohioSourceConfiguration } from './sourceConfiguration';
import { refreshProductionForecast } from './service';
import { syncOperationalSignals } from './operationalSignals/workflow';
import type { ForecastRefreshStage } from './refreshState';

const defaults = { credentials: getOrganizationOhlqCredentials, bailment: downloadOhlqBailmentInvoices, dc: downloadOhlqPartnerDc, importCsv: importProductionSource, refresh: refreshProductionForecast, operations: syncOperationalSignals };
type ProductionSourceServices = Omit<typeof defaults, 'operations'> & { operations?: (options: Parameters<typeof syncOperationalSignals>[0]) => Promise<{ failed: number }> };
export type ProductionSourceOutcome = { configuredOrganizations: number; importedSources: number; refreshedForecasts: number; failedSources: Array<'BAILMENT_PO_INVOICE' | 'DISTRIBUTION_CENTER' | 'FORECAST' | 'OPERATIONS'> };
export { ohioSourceConfiguration } from './sourceConfiguration';

/** Uses the existing OHLQ scheduled job and each enrolled tenant's credentials.
 * Sources and tenants fail independently; logs contain operational counts only. */
export async function syncProductionSources({ db = prisma, services = defaults, logger = console, now = new Date(), onStage, onResult, refreshInventory = false }: { db?: PrismaClient; services?: ProductionSourceServices; logger?: Pick<Console, 'log' | 'error'>; now?: Date; refreshInventory?: boolean; onStage?: (stage: ForecastRefreshStage) => Promise<void>; onResult?: (result: ProductionSourceOutcome) => void } = {}) {
  const organizations = await db.organization.findMany({ where: { id: ECHO_ORGANIZATION_ID, active: true, accountStatus: { notIn: ['SUSPENDED', 'CANCELLED'] }, enabledStates: { has: 'OH' }, ohlqCredentials: { isNot: null }, features: { some: { featureKey: 'PRODUCTION_FORECASTING', enabled: true } } }, orderBy: { id: 'asc' }, select: { id: true, settings: true, timezone: true } });
  const failures: string[] = [];
  const failedSources: ProductionSourceOutcome['failedSources'] = [];
  let importedSources = 0;
  let refreshedForecasts = 0;
  for (const organization of organizations) {
    if (organization.id !== ECHO_ORGANIZATION_ID) continue;
    const today = formatDateInputValue(now, organization.timezone), end = shift(today, -1), config = ohioSourceConfiguration(organization.settings);
    const credentials = await services.credentials(organization.id, db).catch(() => null);
    for (const source of ['BAILMENT_PO_INVOICE', 'DISTRIBUTION_CENTER'] as SourceKind[]) {
      await onStage?.(source === 'BAILMENT_PO_INVOICE' ? 'BAILMENT' : 'GUIDANCE');
      let phase: 'credentials' | 'configuration' | 'download' | 'validation' = 'credentials';
      const options: ImportOptions = { organizationId: organization.id, market: 'OH', source, start: source === 'BAILMENT_PO_INVOICE' ? config.historyStart ?? end : today, end: source === 'BAILMENT_PO_INVOICE' ? end : today, observedOn: today, complete: true };
      try {
        if (!credentials) throw new Error('Tenant credentials unavailable.');
        phase = 'configuration';
        if (source === 'BAILMENT_PO_INVOICE' && (!config.historyStart || !config.directInvoices || config.historyStart > end)) throw new Error('Complete history start and direct invoice policy must be configured.');
        const downloadOptions = { headless: true, returnBuffer: true, partnerCredentials: credentials, reportDate: today, debugDir: path.join(os.tmpdir(), 'ohlq-private', organization.id, 'playwright'), downloadDir: path.join(os.tmpdir(), 'ohlq-private', organization.id, 'downloads'), logger: { log: () => undefined, error: () => undefined }, useServerlessChromium: process.env.VERCEL === '1' };
        phase = 'download';
        const download = source === 'BAILMENT_PO_INVOICE' ? await services.bailment({ ...downloadOptions, fromDate: config.historyStart! }) : await services.dc(downloadOptions);
        phase = 'validation';
        if (!download.csvBuffer || download.reportDate !== today) throw new Error('A current complete source export is required.');
        if (source === 'BAILMENT_PO_INVOICE') options.nativeHistory = { fullPortfolio: true, directInvoices: config.directInvoices! };
        const result = await services.importCsv(download.csvBuffer.toString('utf8'), options, db);
        importedSources++;
        logger.log(JSON.stringify({ organizationId: organization.id, source, status: result.replay ? 'replayed' : 'imported', rows: result.rowCount, excludedRows: result.excludedRows, reportDate: today }));
      } catch (error) {
        failures.push(`${organization.id}:${source}`);
        failedSources.push(source);
        // No provider error text, rows, credentials, or filenames in CI metadata.
        const contentHash = createHash('sha256').update(JSON.stringify({ ...options, attempt: 'scheduled-download-failure' })).digest('hex');
        const detail = error instanceof Error ? error.message : '';
        const reason = phase === 'download' && /incorrect username or password|returned to login|sign.in.*(failed|timeout)/i.test(detail) ? 'upstream-authentication' : phase === 'download' && /render|parameters did not load/i.test(detail) ? 'upstream-report-unavailable' : phase;
        await db.productionSourceImport.upsert({ where: { organizationId_market_source_contentHash: { organizationId: organization.id, market: 'OH', source, contentHash } }, create: { organizationId: organization.id, market: 'OH', source, contentHash, status: 'FAILED', coverageStart: new Date(options.start), coverageEnd: new Date(options.end), observedOn: new Date(today), summary: { issue: 'Source attempt failed; no source facts were changed.', reason } }, update: {} }).catch(() => undefined);
        logger.error(JSON.stringify({ organizationId: organization.id, source, status: 'failed', reason, reportDate: today }));
      }
    }
    await onStage?.('FORECAST');
    try { await services.refresh(organization.id, db, now); refreshedForecasts++; }
    catch { failures.push(`${organization.id}:REFRESH`); failedSources.push('FORECAST'); logger.error(JSON.stringify({ organizationId: organization.id, status: 'refresh-failed' })); }
  }
  if (services.operations) {
    await onStage?.('OPERATIONS');
    // Run even when a source failed; its clock reflects actual retrieval time.
    try { const result = await services.operations({ db, logger, refreshInventory }); if (result.failed) { failures.push('OPERATIONAL_SIGNALS'); failedSources.push('OPERATIONS'); } }
    catch { failures.push('OPERATIONAL_SIGNALS'); failedSources.push('OPERATIONS'); logger.error(JSON.stringify({ source: 'OPERATIONAL_SIGNALS', status: 'failed' })); }
  }
  onResult?.({ configuredOrganizations: organizations.filter(organization => organization.id === ECHO_ORGANIZATION_ID).length, importedSources, refreshedForecasts, failedSources });
  if (failures.length) throw new Error(`Production source failures: ${failures.join(', ')}.`);
  return { configuredOrganizations: organizations.length, importedSources };
}
