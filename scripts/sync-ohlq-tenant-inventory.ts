import { assertSideEffectEnabled, validateRuntimeEnvironment } from '../lib/appEnvironment';
import { loadLocalEnvironmentFile } from '../lib/environmentFile';
import { runOhlqTenantInventoryWorkflow } from '../lib/ohlqTenantInventoryWorkflow';
import { prisma } from '../lib/prisma';

const arg = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] ?? '' : ''; };

async function main() {
  loadLocalEnvironmentFile('.env.local'); loadLocalEnvironmentFile('.env');
  const environment = arg('--environment');
  if (!['test', 'production'].includes(environment)) throw new Error('Pass --environment test or --environment production.');
  const runtime = validateRuntimeEnvironment();
  if (runtime.appEnvironment !== environment) throw new Error(`Requested ${environment}, but APP_ENV=${runtime.appEnvironment}.`);
  assertSideEffectEnabled('ohlqImport');
  await runOhlqTenantInventoryWorkflow();
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
