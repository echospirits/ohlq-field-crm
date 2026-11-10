import { mkdtempSync, rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import path from 'node:path';
import { validateRuntimeEnvironment } from '../lib/appEnvironment';

const expectedMigrationChecksum = '72acb58b0a75e871aa6f290745403864212dc9b48db7309aa48b069eed753bda';
const expectedRepository = 'echospirits/ohlq-field-crm';
const expectedRef = 'refs/heads/codex/forecast-warehouse-acceptance';

async function protectedBaseline(db: PrismaClient) {
  const organizationId = 'org_echo_spirits';
  const [products, vendors, organization, credentials, currentInventoryRows, inventoryHistoryRows, retailSalesRows, wholesaleSalesRows, forecastSnapshots, historicalDemandRows, guidanceRows, sourceImports, deliveryRows, deliveryChecks, targetCurrentRows, targetHistoricalRows] = await Promise.all([
    db.organizationProduct.findMany({ where: { organizationId }, orderBy: { id: 'asc' }, select: { id: true, externalItemCode: true, market: true, status: true, active: true, discontinued: true } }),
    db.organizationVendorIdentifier.findMany({ where: { organizationId }, orderBy: { id: 'asc' }, select: { id: true, market: true, vendorId: true, active: true } }),
    db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true, enabledStates: true } }),
    db.organizationOperationalCredential.findMany({ where: { organizationId }, orderBy: { id: 'asc' }, select: { id: true, configuredAt: true, updatedAt: true } }),
    db.ohlqAgencyInventoryCurrent.count({ where: { organizationId } }), db.ohlqAgencyInventorySnapshot.count({ where: { organizationId } }),
    db.ohlqAnnualSalesRow.count(), db.ohlqAnnualSalesByWholesaleRow.count(),
    db.productionForecastSnapshot.count({ where: { organizationId } }), db.productionDemandObservation.count({ where: { organizationId } }),
    db.productionGuidanceObservation.count({ where: { organizationId } }), db.productionSourceImport.count({ where: { organizationId } }),
    db.deliveryAvailabilityObservation.count({ where: { organizationId } }), db.deliveryAvailabilityCheck.count({ where: { organizationId } }),
    db.ohlqAgencyInventoryCurrent.count({ where: { organizationId, itemCode: '3150B' } }), db.ohlqAgencyInventorySnapshot.count({ where: { organizationId, itemCode: '3150B' } }),
  ]);
  assert.equal(products.find(product => product.market === 'OH' && product.externalItemCode === '3150B')?.status, 'EXCLUDED');
  assert.equal(targetCurrentRows, 0); assert.equal(targetHistoricalRows, 0);
  return {
    productStateHash: createHash('sha256').update(JSON.stringify(products)).digest('hex'),
    configurationHash: createHash('sha256').update(JSON.stringify({ vendors, organization, credentials })).digest('hex'),
    productCount: products.length, currentInventoryRows, inventoryHistoryRows, retailSalesRows, wholesaleSalesRows,
    forecastSnapshots, historicalDemandRows, guidanceRows, sourceImports, deliveryRows, deliveryChecks,
    targetSalesExcluded: true, targetSharedInventoryRows: 0,
  };
}

/** Isolated production acceptance branch only. Only new inventory and pending
 * current-demand facts/checks may change; broad import/operations runners are
 * never invoked. Root verifies Vercel deployment provenance before publishing. */
async function main() {
  const runtime = validateRuntimeEnvironment();
  if (runtime.appEnvironment !== 'production' || process.env.DATABASE_ENVIRONMENT !== 'production'
    || process.env.DATABASE_TARGET_ID !== 'neon-ohlq-field-crm-prod'
    || process.env.GITHUB_REPOSITORY !== expectedRepository || process.env.GITHUB_REF !== expectedRef
    || process.env.GITHUB_EVENT_NAME !== 'push') throw new Error('target');
  assert.equal(new URL(process.env.DATABASE_URL!).hostname.replace('-pooler.', '.'),
    'ep-proud-recipe-amosj8m9.c-5.us-east-1.aws.neon.tech', 'Acceptance must use the independently verified live production host.');
  const expectedSha = process.env.PRODUCTION_ACCEPTANCE_DEPLOYED_MAIN_SHA ?? '';
  assert.match(expectedSha, /^[0-9a-f]{40}$/);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), expectedSha, 'Application candidate differs from reviewed deployed main.');
  execFileSync('git', ['diff', '--quiet', '--', 'app', 'lib', 'prisma', 'package.json', 'package-lock.json']);
  assert(process.env.GITHUB_TOKEN, 'Read-only repository token is required.');
  const reference = await fetch(`https://api.github.com/repos/${expectedRepository}/git/ref/heads/main`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000) });
  assert(reference.ok, 'Could not verify current main.');
  const mainReference = await reference.json() as { object?: { sha?: string } };
  assert.equal(mainReference.object?.sha, expectedSha, 'Main moved after reviewed deployment; stop for a fresh release audit.');
  const healthResponse = await fetch('https://crm.echospirits.com/api/health', { signal: AbortSignal.timeout(30000) });
  assert(healthResponse.ok, 'Production health is unavailable.');
  const health = await healthResponse.json() as { ok?: boolean; database?: string; databaseTarget?: string; environment?: string };
  assert.equal(health.ok, true); assert.equal(health.database, 'connected'); assert.equal(health.environment, 'production');
  assert.equal(health.databaseTarget, 'ohlq-field-crm', 'Deployment health identity differs from the separately named CI database resource.');
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp || !path.isAbsolute(runnerTemp)) throw new Error('storage');
  const temporaryRoot = path.resolve(runnerTemp);
  const directory = mkdtempSync(path.join(temporaryRoot, 'neat-production-dc-inventory-'));
  if (!directory.startsWith(`${temporaryRoot}${path.sep}`)) throw new Error('storage');
  const { PrismaClient } = await import('@prisma/client');
  const { ECHO_ORGANIZATION_ID } = await import('../lib/echoAccess');
  const { forecastAccess } = await import('../lib/productionForecasting/import');
  const { getOrganizationOhlqCredentials } = await import('../lib/ohlqTenantCredentials');
  const { downloadOhlqDcInventory, downloadOhlqCurrentDemand } = await import('../lib/ohlqAnnualSalesReport');
  const { ingestDcInventory } = await import('../lib/productionForecasting/operationalSignals/dcInventoryIngestion');
  const { currentDemandProducts, getCurrentDemandSignals, ingestCurrentDemand } = await import('../lib/productionForecasting/operationalSignals/demandIngestion');
  const { calculateCurrentDemand } = await import('../lib/productionForecasting/operationalSignals/demand');
  const { getWarehouseBalanceSignals } = await import('../lib/productionForecasting/operationalSignals/warehouseBalance');
  const { formatDateInputValue } = await import('../lib/dateTime');
  const db = new PrismaClient();
  let phase = 'access';
  let before: Awaited<ReturnType<typeof protectedBaseline>> | undefined;
  try {
    const ledger = await db.$queryRaw<Array<{ checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>>`SELECT checksum,finished_at,rolled_back_at FROM "_prisma_migrations" WHERE migration_name='20261110010000_production_warehouse_inventory'`;
    assert.equal(ledger.length, 1); assert.equal(ledger[0].checksum, expectedMigrationChecksum);
    assert(ledger[0].finished_at && !ledger[0].rolled_back_at, 'Exact reviewed additive migration is not complete.');
    before = await protectedBaseline(db);
    const organization = await forecastAccess(db, ECHO_ORGANIZATION_ID);
    const credentials = await getOrganizationOhlqCredentials(ECHO_ORGANIZATION_ID, db);
    if (!credentials || !organization.enabledStates.includes('OH')) throw new Error('credentials');
    const today = formatDateInputValue(new Date(), organization.timezone);
    phase = 'download';
    const download = await downloadOhlqDcInventory({ headless: true, returnBuffer: true, partnerCredentials: credentials,
      reportDate: today, downloadDir: path.join(directory, 'downloads'), debugDir: path.join(directory, 'screenshots'),
      useServerlessChromium: false, logger: { log: () => undefined, error: () => undefined },
      onDiagnostic: diagnostic => console.log(JSON.stringify({ source: 'DC_INVENTORY', phase: diagnostic.stage,
        ...Object.fromEntries(['frame', 'fromDateControls', 'vendorControls', 'brandControls', 'renderError'].flatMap(key => typeof diagnostic[key] === 'number' || typeof diagnostic[key] === 'boolean' ? [[key, diagnostic[key]]] : [])),
      })),
    });
    if (!download.csvBuffer) throw new Error('empty-export');
    phase = 'ingest';
    const now = new Date();
    const result = await ingestDcInventory({ organizationId: ECHO_ORGANIZATION_ID, businessDate: today, db, now,
      download: { status: 'ok', csv: download.csvBuffer.toString('utf8'), reportDate: download.reportDate, observedAt: now.toISOString() } });
    phase = 'demand-scope';
    const demandStartedAt = new Date(), demandDay = formatDateInputValue(demandStartedAt, organization.timezone);
    const [products, previousDemand] = await Promise.all([
      currentDemandProducts(ECHO_ORGANIZATION_ID, db), getCurrentDemandSignals(ECHO_ORGANIZATION_ID, db, demandStartedAt),
    ]);
    const completed = new Set(previousDemand.rows.filter(row => row.status === 'AVAILABLE' && !row.stale && row.businessDate === demandDay && row.sourceFreshness === 'CURRENT').map(row => row.productId));
    const pending = products.filter(product => !completed.has(product.id));
    let demandResult = { available: 0, unavailable: 0, failed: 0, reused: completed.size };
    let demandInvalidResponses = 0;
    if (pending.length) {
      phase = 'demand-download';
      const demandDownload = await downloadOhlqCurrentDemand({ headless: true, partnerCredentials: credentials, itemCodes: pending.map(product => product.code),
        downloadDir: path.join(directory, 'current-demand', 'downloads'), debugDir: path.join(directory, 'current-demand', 'screenshots'),
        useServerlessChromium: false, logger: { log: () => undefined, error: () => undefined },
      });
      const malformed = new Set(['INVALID_RESPONSE', 'INCOMPLETE_SOURCE', 'MISSING_CASE_PACK', 'MISSING_QUANTITY', 'INVALID_QUANTITY', 'CONFLICTING_AGENCY_ROWS']);
      for (const product of pending) {
        const responses = demandDownload.products.filter(response => response.itemCode === product.code);
        const response = responses[0];
        if (responses.length !== 1 || !response || response.status === 'failed') { demandInvalidResponses++; continue; }
        const calculated = calculateCurrentDemand(product.code, response.payload);
        if (calculated.status === 'unavailable' && malformed.has(calculated.reason)) demandInvalidResponses++;
      }
      phase = 'demand-ingest';
      const demandCompletedAt = new Date();
      demandResult = await ingestCurrentDemand({ organizationId: ECHO_ORGANIZATION_ID, businessDate: formatDateInputValue(demandCompletedAt, organization.timezone), db, now: demandCompletedAt, download: demandDownload });
    }
    phase = 'verify';
    const balances = await getWarehouseBalanceSignals(ECHO_ORGANIZATION_ID, db, new Date());
    const warehouses = ['GPT', 'GRN'] as const;
    const currentPairs = balances.rows.reduce((total, row) => total + warehouses.filter(warehouse => row.warehouses[warehouse].status === 'AVAILABLE').length, 0);
    const inventoryPairs = balances.rows.reduce((total, row) => total + warehouses.filter(warehouse => row.inventory.warehouses[warehouse].status === 'AVAILABLE' && !row.inventory.warehouses[warehouse].stale).length, 0);
    const shortfalls = Object.fromEntries(warehouses.map(warehouse => [warehouse, balances.rows.filter(row => {
      const balance = row.warehouses[warehouse];
      return balance.status === 'AVAILABLE' && balance.balanceCases !== null && balance.balanceCases < 0;
    }).length]));
    const invalidInventoryReasons = new Set(['INVALID_QUANTITY', 'INVALID_SOURCE_DATE', 'CONFLICTING_PRODUCT_ROWS']);
    const inventoryInvalidPairs = result.results.filter(row => row.reason !== null && invalidInventoryReasons.has(row.reason)).length;
    const failed = result.failed > 0 || inventoryInvalidPairs > 0 || demandResult.failed > 0 || demandInvalidResponses > 0 || currentPairs === 0 || inventoryPairs !== balances.rows.length * 2;
    console.log(JSON.stringify({ status: failed ? 'failed' : 'verified', phase, environment: 'production', databaseTarget: 'neon-ohlq-field-crm-prod', applicationSha: expectedSha,
      businessDate: balances.today, eligibleProducts: balances.rows.length, currentWarehousePairs: currentPairs, currentInventoryPairs: inventoryPairs, shortfalls,
      available: result.available, reused: result.reused, unavailable: result.unavailable, failed: result.failed,
      inventoryInvalidPairs, demandRequested: pending.length, demandAvailable: demandResult.available, demandReused: demandResult.reused, demandUnavailable: demandResult.unavailable, demandFailed: demandResult.failed, demandInvalidResponses }));
    if (failed) process.exitCode = 1;
  } catch {
    console.error(JSON.stringify({ status: 'failed', source: 'DC_INVENTORY', phase }));
    process.exitCode = 1;
  } finally {
    try {
      if (before) {
        assert.deepEqual(await protectedBaseline(db), before, 'Existing business data or provider configuration changed.');
        console.log(JSON.stringify({ scope: 'forecasting-inventory-and-current-demand-only', existingDataPreserved: true, targetSalesExcluded: true, targetSharedInventoryRows: 0 }));
      }
    } finally {
      try { await db.$disconnect(); }
      finally {
        // Exact generated child was checked against RUNNER_TEMP before use.
        assert(path.dirname(directory) === temporaryRoot && path.basename(directory).startsWith('neat-production-dc-inventory-'));
        rmSync(directory, { recursive: true, force: true });
      }
    }
  }
}
main().catch(() => { console.error(JSON.stringify({ status: 'failed', phase: 'setup' })); process.exitCode = 1; });
