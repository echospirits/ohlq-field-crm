import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile(fileName: string) {
  const envPath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || line.trim().startsWith('#') || process.env[match[1]]?.trim()) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value.replace(/\\n/g, '\n');
  }
}

async function main() {
  const envFile = process.argv[2];
  const phase = process.argv[3];
  if (!envFile || !['pre', 'post'].includes(phase)) throw new Error('Usage: audit-tenant-inventory-migration <env-file> <pre|post>.');
  loadEnvFile(envFile);
  const [{ Prisma }, { validateRuntimeEnvironment }, { prisma }] = await Promise.all([
    import('@prisma/client'),
    import('../lib/appEnvironment'),
    import('../lib/prisma'),
  ]);
  const runtime = validateRuntimeEnvironment();
  const echo = await prisma.organization.count({ where: { id: 'org_echo_spirits' } });
  if (echo !== 1) throw new Error('Expected org_echo_spirits before inventory ownership backfill.');
  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>(Prisma.sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('OrganizationOhlqCredentials', 'OhlqTenantInventoryImportStatus')
    ORDER BY table_name
  `);
  const columns = await prisma.$queryRaw<Array<{ column_name: string; table_name: string }>>(Prisma.sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('OhlqAgencyInventoryCurrent', 'OhlqAgencyInventorySnapshot')
      AND column_name = 'organizationId'
    ORDER BY table_name
  `);
  const counts = await prisma.$queryRaw<Array<{ current_rows: bigint; snapshot_rows: bigint }>>(Prisma.sql`
    SELECT
      (SELECT COUNT(*) FROM "OhlqAgencyInventoryCurrent") AS current_rows,
      (SELECT COUNT(*) FROM "OhlqAgencyInventorySnapshot") AS snapshot_rows
  `);
  if (phase === 'post') {
    if (tables.length !== 2 || columns.length !== 2) throw new Error('Tenant inventory schema is incomplete after migration.');
    const invalid = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS count FROM (
        SELECT "organizationId" FROM "OhlqAgencyInventoryCurrent" WHERE "organizationId" IS NULL OR "organizationId" <> 'org_echo_spirits'
        UNION ALL
        SELECT "organizationId" FROM "OhlqAgencyInventorySnapshot" WHERE "organizationId" IS NULL OR "organizationId" <> 'org_echo_spirits'
      ) invalid
    `);
    if (Number(invalid[0]?.count ?? 0) !== 0) throw new Error('Legacy inventory rows were not assigned exclusively to Echo Spirits.');
  }
  console.log(JSON.stringify({ appEnvironment: runtime.appEnvironment, columns: columns.length, currentRows: Number(counts[0]?.current_rows ?? 0), phase, snapshotRows: Number(counts[0]?.snapshot_rows ?? 0), tables: tables.length }));
  await prisma.$disconnect();
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
