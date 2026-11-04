import path from 'node:path';
import { loadEnvironmentFile } from '../lib/environmentFile';

const argument = (key: string) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const envFile = argument('env-file');
if (!envFile) throw new Error('Provide an explicit --env-file path.');
loadEnvironmentFile(path.resolve(envFile));

async function main() {
  const { validateRuntimeEnvironment } = await import('../lib/appEnvironment');
  const { appEnvironment } = validateRuntimeEnvironment();
  if (appEnvironment !== 'test' || process.env.DATABASE_TARGET_ID !== 'neon-neat-tst') throw new Error('This configuration command is restricted to verified neat-tst.');
  const organizationId = argument('organization'), userId = argument('user-id'), actorUserId = argument('actor-user-id');
  if (!organizationId || !actorUserId || (!userId && !process.argv.includes('--clear'))) throw new Error('Provide --organization, --actor-user-id and --user-id (or --clear).');
  const { PrismaClient } = await import('@prisma/client');
  const { configureDefaultReactivationAssignee, readDefaultReactivationAssigneeUserId } = await import('../lib/reactivationAssignment');
  const db = new PrismaClient();
  try {
    const organization = await db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { id: true, displayName: true, settings: true } });
    const assignee = userId ? await db.user.findFirst({ where: { id: userId, organizationId, isActive: true, role: { notIn: ['TASTER', 'PLATFORM_ADMIN'] } }, select: { id: true, name: true, email: true } }) : null;
    if (userId && !assignee) throw new Error('The requested user is not an active assignable member of this organization.');
    console.log(JSON.stringify({ target: process.env.DATABASE_TARGET_ID, organization: { id: organization.id, name: organization.displayName }, previousAssigneeUserId: readDefaultReactivationAssigneeUserId(organization.settings), requestedAssignee: assignee, apply: process.argv.includes('--apply') }));
    if (process.argv.includes('--apply')) {
      await db.$transaction(tx => configureDefaultReactivationAssignee({ db: tx, organizationId, userId: userId ?? null, actorUserId }));
      console.log(JSON.stringify({ saved: true, organizationId, assignedToUserId: assignee?.id ?? null }));
    }
  } finally { await db.$disconnect(); }
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Reactivation configuration failed.'); process.exitCode = 1; });
