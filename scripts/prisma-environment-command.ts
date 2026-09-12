import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { loadEnvironmentFile } from '../lib/environmentFile';

const root = path.resolve(__dirname, '..');
loadEnvironmentFile(path.join(root, '.env'));
loadEnvironmentFile(path.join(root, '.env.local'));

async function main() {
  const { assertDestructiveDatabaseOperationAllowed, logEnvironmentEvent, parseBooleanEnvironmentValue, validateRuntimeEnvironment } = await import('../lib/appEnvironment');
  const command = process.argv[2];
  const expectedEnvironment = process.argv[3];
  const runtime = validateRuntimeEnvironment();

  if (expectedEnvironment && runtime.appEnvironment !== expectedEnvironment) {
    throw new Error(`This command requires APP_ENV=${expectedEnvironment}; current APP_ENV=${runtime.appEnvironment}.`);
  }

  let prismaArgs: string[];
  if (command === 'migrate') {
    prismaArgs = ['prisma', 'migrate', 'deploy'];
  } else if (command === 'reset') {
    assertDestructiveDatabaseOperationAllowed();
    prismaArgs = ['prisma', 'migrate', 'reset', '--force', '--skip-seed'];
  } else if (command === 'push') {
    if (runtime.appEnvironment === 'production') throw new Error('prisma db push is forbidden in production; deploy tested migrations instead.');
    if (parseBooleanEnvironmentValue(process.env.ALLOW_SCHEMA_PUSH, 'ALLOW_SCHEMA_PUSH') !== true) {
      throw new Error('Set ALLOW_SCHEMA_PUSH=true for this one non-production schema push.');
    }
    prismaArgs = ['prisma', 'db', 'push'];
  } else {
    throw new Error('Expected prisma environment command: migrate, reset, or push.');
  }

  logEnvironmentEvent('database.command.started', { command, expectedEnvironment: expectedEnvironment || null });
  const prismaCli = path.join(root, 'node_modules', 'prisma', 'build', 'index.js');
  const result = spawnSync(process.execPath, [prismaCli, ...prismaArgs.slice(1)], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  logEnvironmentEvent('database.command.completed', { command });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
