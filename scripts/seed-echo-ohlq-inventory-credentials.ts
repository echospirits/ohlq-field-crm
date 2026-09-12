import { loadLocalEnvironmentFile } from '../lib/environmentFile';

async function main() {
  const envFile = process.argv[2];
  if (!envFile) throw new Error('Usage: seed-echo-ohlq-inventory-credentials <env-file>.');
  loadLocalEnvironmentFile(envFile, { expandEscapedNewlines: true, preserveExisting: 'non-empty' });
  const [{ validateRuntimeEnvironment }, { saveOrganizationOhlqCredentials }, { prisma }] = await Promise.all([
    import('../lib/appEnvironment'),
    import('../lib/ohlqTenantCredentials'),
    import('../lib/prisma'),
  ]);
  validateRuntimeEnvironment();
  const username = process.env.OHLQ_OPS_USERNAME?.trim();
  const password = process.env.OHLQ_OPS_PASSWORD;
  if (!username || !password) throw new Error('OHLQ_OPS_USERNAME and OHLQ_OPS_PASSWORD are required.');
  await saveOrganizationOhlqCredentials({ organizationId: 'org_echo_spirits', password, username });
  console.log('Echo Spirits tenant inventory credentials configured.');
  await prisma.$disconnect();
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
