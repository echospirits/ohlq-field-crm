// One-off operator acceptance only. Publish on the isolated acceptance branch
// as scripts/verify-forecast-vendor.ts; the workflow copies it to app/tmp/.
// This script does not run the inventory importer or the annual sales workflow.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Prisma, PrismaClient } from '@prisma/client';

const organizationId = 'org_echo_spirits';
const targetCode = '3150B';
let phase = 'environment-and-source-identity';
let db: PrismaClient | undefined;
let privateDirectory: string | undefined;
const silent = { log: () => undefined, error: () => undefined };

function record(value: unknown): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Expected existing structured inventory diagnostics.');
  return value as Record<string, unknown>;
}

async function main() {
  const environment = process.env.APP_ENV;
  assert(environment === 'test' || environment === 'production', 'Explicit environment required.');
  const expectedRepository = environment === 'test' ? 'echospirits/neat-tst' : 'echospirits/ohlq-field-crm';
  const expectedTarget = environment === 'test' ? 'neon-neat-tst' : 'neon-ohlq-field-crm-prod';
  assert.equal(process.env.GITHUB_REPOSITORY, expectedRepository, 'Repository/environment mismatch.');
  const expectedSha = process.env.ACCEPTANCE_EXPECTED_APP_SHA ?? '';
  assert.match(expectedSha, /^[0-9a-f]{40}$/);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), expectedSha, 'Application candidate mismatch.');
  execFileSync('git', ['diff', '--quiet', '--', 'app', 'lib', 'prisma', 'package.json', 'package-lock.json']);
  assert.equal(process.env.DATABASE_TARGET_ID, expectedTarget, 'Unexpected database target.');
  for (const key of ['DATABASE_URL', 'EXPECTED_DATABASE_HOST', 'OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY', 'OHLQ_MICROSOFT_USERNAME', 'OHLQ_MICROSOFT_PASSWORD']) {
    assert(process.env[key]?.trim(), 'Required isolated runtime configuration is absent.');
  }
  const { assertSideEffectEnabled, validateRuntimeEnvironment } = await import('../lib/appEnvironment');
  assert.equal(validateRuntimeEnvironment().appEnvironment, environment);
  assertSideEffectEnabled('ohlqImport');
  const { PrismaClient } = await import('@prisma/client');
  db = new PrismaClient();
  const client = db;
  const { forecastAccess } = await import('../lib/productionForecasting/import');
  const { getOrganizationTenantConfig } = await import('../lib/tenantConfig');
  const { getOrganizationOhlqCredentials } = await import('../lib/ohlqTenantCredentials');
  const { downloadOhlqAgencyInventoryReport, getOhlqAgencyInventoryObservationDate } = await import('../lib/ohlqAnnualSalesReport');
  const { parseOhlqAgencyInventoryCsv } = await import('../lib/ohlqAgencyInventoryImport');
  const { syncProductionSources } = await import('../lib/productionForecasting/sourceWorkflow');
  const { getProductionDashboard, getProductionProduct } = await import('../lib/productionForecasting/service');

  phase = 'read-only-scope-preflight';
  const organization = await forecastAccess(client, organizationId);
  assert(organization.enabledStates.includes('OH'), 'Ohio forecasting is unavailable.');
  const beforeProduct = await client.organizationProduct.findUniqueOrThrow({
    where: { organizationId_market_externalItemCode: { organizationId, market: 'OH', externalItemCode: targetCode } },
    select: { id: true, active: true, status: true, discontinued: true, displayName: true },
  });
  assert.equal(beforeProduct.status, 'EXCLUDED', 'Target must remain sales-excluded.');
  assert.equal(beforeProduct.discontinued, false, 'Target is discontinued.');
  const beforeConfig = await getOrganizationTenantConfig(organizationId, client);
  assert.equal(beforeConfig.productFilter.mode, 'item-list', 'Expected explicit sales portfolio.');
  assert.equal(beforeConfig.productFilter.itemCodes.includes(targetCode), false, 'Target is included in sales.');
  const beforeInventory = await Promise.all([
    client.ohlqAgencyInventoryCurrent.count({ where: { organizationId, itemCode: targetCode } }),
    client.ohlqAgencyInventorySnapshot.count({ where: { organizationId, itemCode: targetCode } }),
  ]);
  assert.deepEqual(beforeInventory, [0, 0], 'Target already exists in shared inventory.');
  const beforeStatus = await client.ohlqTenantInventoryImportStatus.findFirstOrThrow({
    where: { organizationId, status: 'COMPLETED' }, orderBy: { reportDate: 'desc' },
    select: { id: true, completedAt: true, updatedAt: true, diagnostics: true },
  });
  assert(beforeStatus.completedAt, 'Completed inventory provenance is required.');
  const beforeDiagnostics = record(beforeStatus.diagnostics);
  const activeVendors = await client.organizationVendorIdentifier.findMany({
    where: { organizationId, market: 'OH', active: true }, select: { vendorId: true }, orderBy: { vendorId: 'asc' },
  });
  assert(activeVendors.length, 'No active Ohio vendor.');
  const vendorIds = new Set(activeVendors.map(row => row.vendorId));
  const credentials = await getOrganizationOhlqCredentials(organizationId, client);
  assert(credentials, 'Existing tenant credentials are unavailable.');

  phase = 'read-only-vendor-inventory-export';
  privateDirectory = await mkdtemp(path.join(os.tmpdir(), 'forecast-vendor-acceptance-'));
  const observedOn = getOhlqAgencyInventoryObservationDate();
  const download = await downloadOhlqAgencyInventoryReport({
    headless: true, returnBuffer: true, partnerCredentials: credentials, reportDate: observedOn,
    debugDir: path.join(privateDirectory, 'debug'), downloadDir: path.join(privateDirectory, 'download'),
    logger: silent, useServerlessChromium: false,
  });
  assert(download.csvBuffer && download.reportDate === observedOn, 'Current complete inventory export required.');
  const parsed = parseOhlqAgencyInventoryCsv(download.csvBuffer, observedOn, { config: beforeConfig });
  const forecastBailmentProducts = parsed.stats.forecastBailmentProducts.filter(product => vendorIds.has(product.vendorId));
  assert(forecastBailmentProducts.some(product => product.itemCode === targetCode), 'Target lacks current vendor A3A BAIL evidence.');
  // Do not pass parsed.rows to any importer. Only the two planning metadata
  // fields below may change on the existing completed provenance record.
  const mergedDiagnostics = { ...beforeDiagnostics, forecastBailmentProducts, forecastCatalogObservedOn: observedOn };

  phase = 'forecast-catalog-metadata-only-update';
  await client.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`production-forecast:${organizationId}`}))`;
    await forecastAccess(tx, organizationId);
    const currentVendors = await tx.organizationVendorIdentifier.findMany({
      where: { organizationId, market: 'OH', active: true }, select: { vendorId: true }, orderBy: { vendorId: 'asc' },
    });
    assert.deepEqual(currentVendors, activeVendors, 'Vendor scope changed during export.');
    const latest = await tx.ohlqTenantInventoryImportStatus.findFirstOrThrow({
      where: { organizationId, status: 'COMPLETED' }, orderBy: { reportDate: 'desc' }, select: { id: true },
    });
    assert.equal(latest.id, beforeStatus.id, 'Latest completed inventory changed during export.');
    const updated = await tx.ohlqTenantInventoryImportStatus.updateMany({
      where: {
        id: beforeStatus.id, organizationId, status: 'COMPLETED', completedAt: beforeStatus.completedAt,
        updatedAt: beforeStatus.updatedAt, diagnostics: { equals: beforeStatus.diagnostics as Prisma.InputJsonValue },
      },
      data: { diagnostics: mergedDiagnostics as Prisma.InputJsonValue },
    });
    assert.equal(updated.count, 1, 'Inventory provenance changed; no metadata merged.');
  }, { timeout: 30000 });

  phase = 'forecast-source-refresh';
  if (!process.env.PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY?.trim()) delete process.env.PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY;
  let sourceCounts: Awaited<ReturnType<typeof syncProductionSources>>;
  try {
    // This canonical focused runner imports forecasting sources, refreshes
    // predictions and collects the tool's existing operational signals only.
    sourceCounts = await syncProductionSources({ db: client, logger: silent });
  } finally {
    // Verify the boundary even when an upstream forecasting source fails.
    const afterProduct = await client.organizationProduct.findUniqueOrThrow({ where: { id: beforeProduct.id }, select: { id: true, active: true, status: true, discontinued: true, displayName: true } });
    assert.deepEqual(afterProduct, beforeProduct, 'Sales product decision changed.');
    const afterConfig = await getOrganizationTenantConfig(organizationId, client);
    assert.deepEqual(afterConfig, beforeConfig, 'Sales portfolio changed.');
    assert.deepEqual(await Promise.all([
      client.ohlqAgencyInventoryCurrent.count({ where: { organizationId, itemCode: targetCode } }),
      client.ohlqAgencyInventorySnapshot.count({ where: { organizationId, itemCode: targetCode } }),
    ]), beforeInventory, 'Shared inventory changed.');
  }

  phase = 'persisted-forecast-acceptance';
  assert.equal(sourceCounts.configuredOrganizations, 1);
  assert.equal(sourceCounts.importedSources, 2);
  const afterStatus = await client.ohlqTenantInventoryImportStatus.findUniqueOrThrow({
    where: { id: beforeStatus.id }, select: { completedAt: true, diagnostics: true },
  });
  assert.deepEqual(afterStatus.completedAt, beforeStatus.completedAt, 'Inventory completion clock changed.');
  const afterDiagnostics = record(afterStatus.diagnostics);
  const omitCatalog = ({ forecastBailmentProducts: _products, forecastCatalogObservedOn: _observedOn, ...other }: Record<string, unknown>) => other;
  assert.deepEqual(omitCatalog(afterDiagnostics), omitCatalog(beforeDiagnostics), 'Unrelated inventory diagnostics changed.');
  assert.deepEqual(afterDiagnostics.forecastBailmentProducts, forecastBailmentProducts);
  assert.equal(afterDiagnostics.forecastCatalogObservedOn, observedOn);
  const dashboard = await getProductionDashboard(organizationId, client);
  assert(dashboard.rows.some(row => row.product.id === beforeProduct.id && row.product.code === targetCode), 'Target is missing from the forecast table.');
  const detail = await getProductionProduct(organizationId, beforeProduct.id, client);
  assert(detail?.forecast, 'Target has no saved forecast detail after refresh.');
  const targetSourceRows = await client.productionDemandObservation.count({ where: { organizationId, market: 'OH', itemCode: targetCode } });
  assert(targetSourceRows > 0, 'Target has no persisted forecasting source coverage.');
  console.log(JSON.stringify({
    acceptance: 'passed', environment, applicationSha: expectedSha, databaseTarget: expectedTarget,
    forecastCatalogObservedOn: observedOn, forecastCatalogProducts: forecastBailmentProducts.length,
    forecastRows: dashboard.rows.length, importedForecastSources: sourceCounts.importedSources,
    targetForecastVisible: true, targetDetailAvailable: true, targetSourceRows,
    targetSalesExcluded: true, targetSharedInventoryRows: 0, existingInventoryProvenancePreserved: true,
  }));
}

main().catch(() => {
  // No provider error text, source rows, filenames or credentials in CI logs.
  console.error(JSON.stringify({ acceptance: 'failed', phase }));
  process.exitCode = 1;
}).finally(async () => {
  await db?.$disconnect();
  if (privateDirectory) {
    const resolved = path.resolve(privateDirectory), temporaryRoot = path.resolve(os.tmpdir());
    assert(path.dirname(resolved) === temporaryRoot && path.basename(resolved).startsWith('forecast-vendor-acceptance-'));
    await rm(resolved, { recursive: true, force: true });
  }
});

