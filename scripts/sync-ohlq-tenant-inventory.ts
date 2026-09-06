import fs from 'node:fs';
import path from 'node:path';
import { assertSideEffectEnabled, validateRuntimeEnvironment } from '../lib/appEnvironment';
import { runOhlqTenantInventoryWorkflow } from '../lib/ohlqTenantInventoryWorkflow';
import { prisma } from '../lib/prisma';

function loadEnvFile(fileName: string) {
  const file = path.join(process.cwd(), fileName);
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || line.trim().startsWith('#') || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

const arg = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] ?? '' : ''; };

async function main() {
  loadEnvFile('.env.local'); loadEnvFile('.env');
  const environment = arg('--environment');
  if (!['test', 'production'].includes(environment)) throw new Error('Pass --environment test or --environment production.');
  const runtime = validateRuntimeEnvironment();
  if (runtime.appEnvironment !== environment) throw new Error(`Requested ${environment}, but APP_ENV=${runtime.appEnvironment}.`);
  assertSideEffectEnabled('ohlqImport');
  await runOhlqTenantInventoryWorkflow();
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
