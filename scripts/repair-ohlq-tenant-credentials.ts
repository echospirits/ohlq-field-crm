import { assertSideEffectEnabled, validateRuntimeEnvironment } from '../lib/appEnvironment';
import { loadLocalEnvironmentFile } from '../lib/environmentFile';
import { requireEnv } from '../lib/ohlqAnnualSalesReport';
import { saveOrganizationOhlqCredentials } from '../lib/ohlqTenantCredentials';
import { prisma } from '../lib/prisma';

const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() ?? '' : '';
};

async function main() {
  loadLocalEnvironmentFile('.env.local');
  loadLocalEnvironmentFile('.env');
  const environment = arg('--environment');
  const organizationId = arg('--organization');
  if (!['test', 'production'].includes(environment)) throw new Error('Pass --environment test or --environment production.');
  if (!organizationId) throw new Error('Pass the exact organization ID with --organization.');
  if (!process.argv.includes('--apply')) throw new Error('Pass --apply to confirm this credential repair.');

  const runtime = validateRuntimeEnvironment();
  if (runtime.appEnvironment !== environment) throw new Error(`Requested ${environment}, but APP_ENV=${runtime.appEnvironment}.`);
  assertSideEffectEnabled('ohlqImport');

  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { displayName: true, id: true } });
  if (!organization) throw new Error(`Organization ${organizationId} does not exist in the selected database.`);

  const saved = await saveOrganizationOhlqCredentials({
    organizationId,
    password: requireEnv('OHLQ_OPS_PASSWORD'),
    username: requireEnv('OHLQ_OPS_USERNAME'),
  });
  console.log(`Re-encrypted OHLQ credentials for ${organization.displayName} (${saved.organizationId}) as ${saved.usernameHint}.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
