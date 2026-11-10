import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import { parseEnvironmentFile } from '../lib/environmentFile';

export const WAREHOUSE_INVENTORY_MIGRATION = '20261110010000_production_warehouse_inventory';
const tableNames = ['CurrentDcInventoryObservation', 'CurrentDcInventoryCheck'];
const argument = (args: readonly string[], name: string) => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);

/** Pure guards are separately tested; reading a target file never changes it. */
export function warehouseInventoryConfiguration(args: readonly string[], contents: string) {
  const expectedHost = argument(args, 'expected-host'), expectedTarget = argument(args, 'expected-target');
  if (!argument(args, 'env-file') || !expectedHost || !expectedTarget) throw new Error('Provide explicit env-file, expected-host and expected-target arguments.');
  const config = Object.fromEntries(parseEnvironmentFile(contents));
  if (config.APP_ENV === 'production' || config.DATABASE_ENVIRONMENT === 'production') throw new Error('Production is outside this TST-only operator.');
  if (config.APP_ENV !== 'test' || config.DATABASE_ENVIRONMENT !== 'test' || expectedTarget !== 'neon-neat-tst') throw new Error('Only an explicit test environment and neon-neat-tst target are allowed.');
  if (config.DATABASE_TARGET_ID !== expectedTarget || config.EXPECTED_DATABASE_HOST !== expectedHost || config.EXPECTED_DATABASE_TARGET && config.EXPECTED_DATABASE_TARGET !== expectedTarget) throw new Error('Configured target identity differs from the explicit operator arguments.');
  const configured = new URL(config.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(configured.protocol) || configured.hostname !== expectedHost || !expectedHost.endsWith('.neon.tech')) throw new Error('Connection host differs from the verified Neon target.');
  const connection = new URL(config.DIRECT_URL || config.DATABASE_URL);
  const directHost = expectedHost.replace('-pooler.', '.');
  if (!['postgres:', 'postgresql:'].includes(connection.protocol) || connection.hostname.replace('-pooler.', '.') !== directHost || connection.pathname !== configured.pathname || connection.username !== configured.username) throw new Error('Direct connection differs from the verified target or role.');
  connection.hostname = directHost;
  const mode = argument(args, 'mode') ?? 'check';
  if (!['migrate', 'check', 'ingest'].includes(mode)) throw new Error('Choose mode migrate, check or ingest.');
  return { config, connection, mode: mode as 'migrate' | 'check' | 'ingest', rehearsal: args.includes('--rehearsal'), target: expectedTarget, host: expectedHost };
}

export function warehouseMigrationStatements(sql: string) {
  const statements = sql.replace(/^\s*--.*$/gm, '').split(';').map(value => value.trim()).filter(Boolean);
  if (!statements.length || statements.some(statement => !/^(?:CREATE TABLE "CurrentDcInventory(?:Observation|Check)"|CREATE (?:UNIQUE )?INDEX "[a-z_]+" ON "CurrentDcInventory(?:Observation|Check)"|ALTER TABLE "CurrentDcInventory(?:Observation|Check)" ADD CONSTRAINT)/.test(statement))) throw new Error('The reviewed migration may affect only the two new inventory tables.');
  return statements;
}

export function warehouseMigrationState(tables: readonly string[], ledger: ReadonlyArray<{ checksum: string; finished_at: unknown; rolled_back_at: unknown }>, checksum: string) {
  if (!ledger.length && !tables.length) return 'unapplied' as const;
  if (tables.length !== 2 || !tableNames.every(name => tables.includes(name)) || ledger.length !== 1 || ledger[0].checksum !== checksum || !ledger[0].finished_at || ledger[0].rolled_back_at !== null) throw new Error('Inventory tables and own migration ledger do not match. No unrelated drift is reconciled.');
  return 'applied' as const;
}

type Db = PrismaClient | Prisma.TransactionClient;
async function migrationState(db: Db, checksum: string) {
  const relation = await db.$queryRaw<Array<{ name: string | null }>>`SELECT to_regclass('public._prisma_migrations')::text AS name`;
  if (!relation[0]?.name) throw new Error('Existing migration ledger is required.');
  const [tables, ledger] = await Promise.all([
    db.$queryRaw<Array<{ name: string }>>`SELECT tablename AS name FROM pg_tables WHERE schemaname='public' AND tablename IN ('CurrentDcInventoryObservation','CurrentDcInventoryCheck')`,
    db.$queryRaw<Array<{ checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>>`SELECT checksum,finished_at,rolled_back_at FROM "_prisma_migrations" WHERE migration_name=${WAREHOUSE_INVENTORY_MIGRATION}`,
  ]);
  return warehouseMigrationState(tables.map(table => table.name), ledger, checksum);
}

async function checkConstraints(db: Db) {
  const constraints = await db.$queryRaw<Array<{ name: string; valid: boolean }>>`SELECT c.conname AS name,c.convalidated AS valid FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname IN ('CurrentDcInventoryObservation','CurrentDcInventoryCheck') AND c.contype IN ('c','f')`;
  const expected = ['dc_inventory_scope_check', 'dc_inventory_date_check', 'dc_inventory_quantity_check', 'dc_inventory_check_scope_check', 'dc_inventory_check_status_check', 'CurrentDcInventoryObservation_organizationId_fkey', 'CurrentDcInventoryObservation_product_fkey', 'CurrentDcInventoryCheck_organizationId_fkey', 'CurrentDcInventoryCheck_product_fkey', 'CurrentDcInventoryCheck_observation_fkey'];
  assert(expected.every(name => constraints.some(constraint => constraint.name === name && constraint.valid)), 'Reviewed inventory constraints are missing or not validated.');
  const indexes = await db.$queryRaw<Array<{ name: string }>>`SELECT indexname AS name FROM pg_indexes WHERE schemaname='public' AND tablename IN ('CurrentDcInventoryObservation','CurrentDcInventoryCheck')`;
  assert(['dc_inventory_tenant_product_location_day_key', 'dc_inventory_tenant_id_key', 'dc_inventory_history_idx', 'dc_inventory_check_tenant_product_location_day_key', 'dc_inventory_check_history_idx'].every(name => indexes.some(index => index.name === name)), 'Reviewed inventory indexes are missing.');
  return { validatedConstraints: expected.length, reviewedIndexes: 5 };
}

async function baseline(db: Db) {
  const organizationId = 'org_echo_spirits';
  const [products, currentInventoryRows, inventoryHistoryRows, retailSalesRows, wholesaleSalesRows, forecastSnapshots, demandObservations] = await Promise.all([
    db.organizationProduct.findMany({ where: { organizationId }, orderBy: { id: 'asc' }, select: { id: true, externalItemCode: true, market: true, status: true, active: true, discontinued: true } }),
    db.ohlqAgencyInventoryCurrent.count({ where: { organizationId } }),
    db.ohlqAgencyInventorySnapshot.count({ where: { organizationId } }),
    db.ohlqAnnualSalesRow.count(), db.ohlqAnnualSalesByWholesaleRow.count(),
    db.productionForecastSnapshot.count({ where: { organizationId } }),
    db.currentDemandObservation.count({ where: { organizationId } }),
  ]);
  const target = products.find(product => product.market === 'OH' && product.externalItemCode === '3150B');
  const targetInventoryRows = await Promise.all([db.ohlqAgencyInventoryCurrent.count({ where: { organizationId, itemCode: '3150B' } }), db.ohlqAgencyInventorySnapshot.count({ where: { organizationId, itemCode: '3150B' } })]);
  return { productCount: products.length, activeProducts: products.filter(product => product.active).length, salesEligibleProducts: products.filter(product => product.active && ['OWNED', 'REPRESENTED'].includes(product.status)).length, productStateHash: createHash('sha256').update(JSON.stringify(products)).digest('hex'), targetStatus: target?.status ?? null, targetActive: target?.active ?? null, targetSharedInventoryRows: targetInventoryRows, currentInventoryRows, inventoryHistoryRows, retailSalesRows, wholesaleSalesRows, forecastSnapshots, demandObservations };
}

/** The two deliberately invalid transactions must roll back in an explicitly
 * isolated rehearsal. No synthetic business rows are retained. */
async function rehearseTenantConstraints(db: PrismaClient) {
  const owner = await db.organizationProduct.findFirstOrThrow({ where: { organizationId: 'org_echo_spirits', market: 'OH' }, select: { id: true, externalItemCode: true } });
  for (const test of ['product', 'observation'] as const) {
    const foreignId = `qa_dc_${randomUUID().replaceAll('-', '')}`;
    let verified = false;
    try {
      await db.$transaction(async tx => {
        await tx.organization.create({ data: { id: foreignId, name: foreignId, slug: foreignId, displayName: foreignId } });
        const data = { market: 'OH', itemCode: owner.externalItemCode, locationCode: 'GPT', businessDate: new Date('1900-01-01'), sourceBusinessDate: new Date('1900-01-01'), sourceObservedAt: new Date('1900-01-01T12:00:00Z'), sourceUpdatedAt: null, source: 'OHLQ_POWER_BI_DC_INVENTORY', reportId: '6b07a165-c515-4f63-bef4-471ef64e3e96', adapterVersion: 'rehearsal-only', quantityCases: 0, pickedCases: 0, inventoryCases: 0, evidence: {} };
        if (test === 'product') await tx.currentDcInventoryObservation.create({ data: { ...data, organizationId: foreignId, productId: owner.id } });
        else {
          const observation = await tx.currentDcInventoryObservation.create({ data: { ...data, organizationId: 'org_echo_spirits', productId: owner.id } });
          const foreignProduct = await tx.organizationProduct.create({ data: { organizationId: foreignId, externalItemCode: 'QA', market: 'OH', status: 'EXCLUDED', active: false } });
          await tx.currentDcInventoryCheck.create({ data: { organizationId: foreignId, productId: foreignProduct.id, locationCode: 'GPT', businessDate: data.businessDate, checkedAt: data.sourceObservedAt, status: 'AVAILABLE', observationId: observation.id } });
        }
        throw new Error('Expected composite tenant foreign key to reject.');
      }, { timeout: 30000 });
    } catch (error) { verified = typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2003'; }
    assert(verified, 'Composite tenant constraint did not reject the forged relation.');
    assert.equal(await db.organization.count({ where: { id: foreignId } }), 0, 'Rehearsal transaction was not rolled back.');
  }
  return { crossTenantProductRejected: true, crossTenantObservationRejected: true, rehearsalRowsRolledBack: true };
}

let phase = 'configuration';
async function main() {
  const args = process.argv.slice(2), envFile = argument(args, 'env-file');
  if (!envFile) throw new Error('Provide an explicit env-file.');
  const context = warehouseInventoryConfiguration(args, readFileSync(path.resolve(envFile), 'utf8'));
  const sql = readFileSync(path.join(process.cwd(), 'prisma/migrations', WAREHOUSE_INVENTORY_MIGRATION, 'migration.sql'), 'utf8').replace(/\r\n/g, '\n');
  const checksum = createHash('sha256').update(sql).digest('hex'), statements = warehouseMigrationStatements(sql);
  const apply = args.includes('--apply'), verifyConstraints = args.includes('--verify-constraints');
  if ((context.mode !== 'check' || verifyConstraints) && apply && argument(args, 'checksum') !== checksum) throw new Error('The exact reviewed migration checksum is required.');
  if (context.mode === 'migrate' && !apply) { console.log(JSON.stringify({ migration: WAREHOUSE_INVENTORY_MIGRATION, checksum, target: context.target, host: context.host, rehearsal: context.rehearsal, applied: false })); return; }
  if (context.mode === 'ingest' && (!apply || !argument(args, 'csv-file') || !argument(args, 'business-date'))) throw new Error('Ingest requires apply, csv-file and business-date.');
  if (verifyConstraints && (!context.rehearsal || !apply)) throw new Error('Constraint rehearsals require explicit rehearsal and apply flags.');
  Object.assign(process.env, context.config, { DATABASE_URL: context.connection.toString(), EXPECTED_DATABASE_HOST: context.connection.hostname });
  const db = new PrismaClient({ datasourceUrl: context.connection.toString() });
  try {
    phase = 'read-only-baseline';
    const identity = await db.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
    assert.equal(identity[0].database, decodeURIComponent(context.connection.pathname.slice(1)), 'Database identity mismatch.');
    const before = await baseline(db);
    assert.equal(before.targetStatus, 'EXCLUDED', '3150B must stay excluded from sales.');
    assert.deepEqual(before.targetSharedInventoryRows, [0, 0], '3150B must stay absent from shared inventory.');
    let state = await migrationState(db, checksum), alreadyApplied = state === 'applied';
    if (context.mode === 'migrate') {
      phase = 'reviewed-additive-migration';
      await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('production-warehouse-inventory-migration'))`;
        state = await migrationState(tx, checksum); alreadyApplied = state === 'applied';
        if (state === 'applied') { await checkConstraints(tx); return; }
        for (const statement of statements) await tx.$executeRawUnsafe(statement);
        await checkConstraints(tx);
        await tx.$executeRaw`INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count) VALUES (${randomUUID()},${checksum},${WAREHOUSE_INVENTORY_MIGRATION},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,1)`;
      }, { maxWait: 20000, timeout: 60000 });
      state = 'applied';
    }
    if (context.mode === 'ingest') {
      phase = 'forecast-inventory-only-ingestion';
      assert.equal(state, 'applied', 'Exact inventory migration must already be applied.');
      await checkConstraints(db);
      const { ingestDcInventory } = await import('../lib/productionForecasting/operationalSignals/dcInventoryIngestion');
      const now = new Date(), observedAt = argument(args, 'observed-at') ?? now.toISOString(), businessDate = argument(args, 'business-date')!;
      const result = await ingestDcInventory({ organizationId: 'org_echo_spirits', businessDate, download: { status: 'ok', csv: readFileSync(path.resolve(argument(args, 'csv-file')!), 'utf8'), observedAt, reportDate: businessDate }, db, now });
      console.log(JSON.stringify({ mode: 'ingest', available: result.available, unavailable: result.unavailable, failed: result.failed, reused: result.reused, productWarehousePairs: result.results.length }));
      assert.equal(result.failed, 0, 'Inventory source has failed pairs.');
    }
    phase = 'read-only-postcheck';
    const constraints = state === 'applied' ? await checkConstraints(db) : null;
    const rehearsal = verifyConstraints ? await rehearseTenantConstraints(db) : null;
    const after = await baseline(db);
    assert.deepEqual(after, before, 'An existing sales, inventory, product, forecast or demand baseline changed.');
    const inventoryRows = state === 'applied' ? await db.currentDcInventoryObservation.count({ where: { organizationId: 'org_echo_spirits' } }) : 0;
    console.log(JSON.stringify({ mode: context.mode, migration: WAREHOUSE_INVENTORY_MIGRATION, checksum, target: context.target, host: context.host, rehearsal: context.rehearsal, migrationState: state, alreadyApplied, constraints, constraintRehearsal: rehearsal, inventoryObservationRows: inventoryRows, existingDataPreserved: true, baseline: after }));
  } finally { await db.$disconnect(); }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/production-warehouse-inventory.ts')) main().catch(() => { console.error(JSON.stringify({ operation: 'warehouse-inventory', status: 'failed', phase })); process.exitCode = 1; });
