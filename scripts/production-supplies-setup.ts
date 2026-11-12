import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
import { parseEnvironmentFile } from '../lib/environmentFile';
import { readAccountConfiguration } from '../lib/crm/accountConfiguration';

const argument = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
export const SUPPLY_MIGRATION_NAME = '20261112010000_production_supplies';
export function supplyMigrationConfiguration() {
  const envFile = argument('env-file'), expectedHost = argument('expected-host'), expectedTarget = argument('expected-target');
  if (!envFile || !expectedHost || !expectedTarget) throw new Error('Provide --env-file, --expected-host and --expected-target.');
  const config = Object.fromEntries(parseEnvironmentFile(readFileSync(path.resolve(envFile), 'utf8')));
  const rehearsal = process.argv.includes('--rehearsal');
  if (config.APP_ENV === 'production' || config.DATABASE_ENVIRONMENT === 'production') throw new Error('Production is outside this TST feature command.');
  if (rehearsal ? expectedTarget !== 'supplies-rehearsal' || config.APP_ENV !== 'development' : expectedTarget !== 'neon-neat-tst' || config.APP_ENV !== 'test' || config.DATABASE_ENVIRONMENT !== 'test') throw new Error('Only an explicitly identified supplies rehearsal or neat-tst target is allowed.');
  if (config.DATABASE_TARGET_ID !== expectedTarget || config.EXPECTED_DATABASE_HOST !== expectedHost) throw new Error('Environment identity does not match the explicit target.');
  const connection = new URL(config.DATABASE_URL);
  if (connection.hostname !== expectedHost || !connection.hostname.endsWith('.neon.tech')) throw new Error('Database host does not match the verified Neon target.');
  connection.hostname = connection.hostname.replace('-pooler.', '.');
  return { config, connection, rehearsal, target: expectedTarget, host: expectedHost };
}
async function main() {
  const context = supplyMigrationConfiguration();
  const sql = readFileSync(path.join(process.cwd(), 'prisma/migrations', SUPPLY_MIGRATION_NAME, 'migration.sql'), 'utf8').replace(/\r\n/g, '\n');
  const checksum = createHash('sha256').update(sql).digest('hex');
  if (!process.argv.includes('--apply')) { console.log(JSON.stringify({ migration: SUPPLY_MIGRATION_NAME, checksum, target: context.target, host: context.host, rehearsal: context.rehearsal, applied: false })); return; }
  if (argument('checksum') !== checksum) throw new Error('Provide the exact reviewed migration --checksum.');
  const db = new PrismaClient({ datasourceUrl: context.connection.toString() });
  try {
    await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('production-supplies-migration'))`;
      const previous = await tx.$queryRaw<Array<{ checksum: string; finished_at: Date | null }>>`SELECT checksum, finished_at FROM "_prisma_migrations" WHERE migration_name=${SUPPLY_MIGRATION_NAME} AND rolled_back_at IS NULL`;
      if (previous.length) { if (previous.length !== 1 || previous[0].checksum !== checksum || !previous[0].finished_at) throw new Error('Own migration ledger mismatch. Unrelated drift will not be reconciled.'); return; }
      const tables = await tx.$queryRaw<Array<{ name: string }>>`SELECT tablename AS name FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'Supply%'`;
      if (tables.length) throw new Error('Supply tables exist without the exact migration receipt. Review manually.');
      for (const statement of sql.replace(/^\s*--.*$/gm, '').split(';').map(value => value.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
      await tx.$executeRaw`INSERT INTO "_prisma_migrations" (id,checksum,migration_name,started_at,finished_at,applied_steps_count) VALUES (${randomUUID()},${checksum},${SUPPLY_MIGRATION_NAME},CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,1)`;
    }, { maxWait: 20_000, timeout: 90_000 });
    if (process.argv.includes('--echo-setup')) {
      const result = await db.$transaction(async tx => {
        const organizationId = 'org_echo_spirits';
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crm-settings:${organizationId}`},0))`;
        const org = await tx.organization.findFirst({ where: { id: organizationId, active: true }, select: { crmPreferences: true } });
        if (!org) throw new Error('Verified Echo organization is unavailable.');
        const candidates = await tx.user.findMany({ where: { organizationId, isActive: true, OR: [{ firstName: { equals: 'Joe', mode: 'insensitive' }, lastName: { equals: 'Bidinger', mode: 'insensitive' } }, { firstName: { equals: 'Karl', mode: 'insensitive' }, lastName: { equals: 'Dick', mode: 'insensitive' } }, { firstName: { equals: 'Nikhil', mode: 'insensitive' }, lastName: { equals: 'Sharoff', mode: 'insensitive' } }] }, select: { id: true, firstName: true, lastName: true } });
        const expected = [['Joe','Bidinger'],['Karl','Dick'],['Nikhil','Sharoff']];
        const resolved = expected.map(([first,last]) => ({ name: `${first} ${last}`, users: candidates.filter(person => person.firstName?.toLowerCase() === first.toLowerCase() && person.lastName?.toLowerCase() === last.toLowerCase()) }));
        const memberIds = resolved.filter(person => person.users.length === 1).map(person => person.users[0].id);
        const config = readAccountConfiguration(org.crmPreferences);
        const existing = config.teams.find(team => team.name.toLowerCase() === 'production');
        const team = existing ?? { id: randomUUID(), name: 'Production', memberIds: [] as string[] };
        const teams = [...config.teams.filter(t => t.id !== team.id), { ...team, memberIds: [...new Set([...team.memberIds, ...memberIds])] }];
        const preferences = org.crmPreferences as Prisma.JsonObject;
        const currentSettings = (preferences.productionSupplies ?? {}) as Prisma.JsonObject;
        await tx.organization.update({ where: { id: organizationId }, data: { crmPreferences: { ...preferences, accountConfiguration: { ...config, version: config.version + 1, teams }, productionSupplies: { historyDays: 90, pollMinutes: 15, includeSent: true, ...currentSettings, productionTeamId: team.id, viewerUserIds: [...new Set([...(Array.isArray(currentSettings.viewerUserIds) ? currentSettings.viewerUserIds as string[] : []), ...memberIds])], managerUserIds: [...new Set([...(Array.isArray(currentSettings.managerUserIds) ? currentSettings.managerUserIds as string[] : []), ...memberIds])] } } } });
        await tx.organizationFeature.upsert({ where: { organizationId_featureKey: { organizationId, featureKey: 'PRODUCTION_SUPPLIES' } }, create: { organizationId, featureKey: 'PRODUCTION_SUPPLIES', enabled: true }, update: { enabled: true } });
        const raisin = await tx.supplyCatalogItem.findFirst({ where: { organizationId, normalizedName: 'raisins' } });
        if (!raisin) await tx.supplyCatalogItem.create({ data: { organizationId, name: 'Raisins', normalizedName: 'raisins', category: 'Ingredient', departments: ['PRODUCTION'], productAssociation: 'Used in Echo Spiced Rum', sharedUse: true, confirmed: true, aliases: { create: [{ alias: 'raisins' }] } } });
        await tx.supplyAudit.create({ data: { organizationId, action: 'ECHO_PILOT_SETUP', detail: { resolved: resolved.filter(p => p.users.length === 1).map(p => p.name), unresolved: resolved.filter(p => p.users.length !== 1).map(p => p.name), catalogAssociation: 'Raisins used in Spiced Rum; purchase purpose remains reviewable; no SKU or pack size seeded.' } } });
        for (const userId of memberIds) await tx.supplyMailboxSync.upsert({ where: { organizationId_userId: { organizationId, userId } }, create: { organizationId, userId, status: 'CONNECTION_REQUIRED' }, update: {} });
        return { resolved: resolved.filter(p => p.users.length === 1).map(p => p.name), unresolved: resolved.filter(p => p.users.length !== 1).map(p => p.name), enabledOrganization: organizationId };
      });
      console.log(JSON.stringify(result));
    }
    console.log(JSON.stringify({ migration: SUPPLY_MIGRATION_NAME, checksum, target: context.target, host: context.host, appliedOrVerified: true }));
  } finally { await db.$disconnect(); }
}
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/production-supplies-setup.ts')) main().catch(error => { console.error(error instanceof Error ? error.message : 'Production Supplies setup failed.'); process.exitCode = 1; });
