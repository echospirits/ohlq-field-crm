import { PrismaClient } from '@prisma/client';
import { loadEnvironmentFile } from '../lib/environmentFile';
import { validateRuntimeEnvironment } from '../lib/appEnvironment';

// Audit by default. Use a separately pulled, ignored environment file; never
// overwrite local development credentials or print connection strings.
const file = process.argv.find(arg => arg.startsWith('--env-file='))?.slice(11);
if (!file) throw new Error('Provide --env-file=<path>.');
const loaded: Record<string, string | undefined> = {};
loadEnvironmentFile(file, { environment: loaded });
if (!loaded.DATABASE_URL) throw new Error('Selected environment file has no database URL; refusing any fallback connection.');
// Prisma may load .env when imported. The selected file must take precedence.
for (const [key, value] of Object.entries(loaded)) if (value) process.env[key] = value;
const runtime = validateRuntimeEnvironment();
const expected = process.argv.find(arg => arg.startsWith('--environment='))?.slice(14);
if (runtime.appEnvironment !== expected) throw new Error('Environment confirmation does not match loaded configuration.');
const apply = process.argv.includes('--apply');
if (apply && expected === 'production' && !process.argv.includes('--confirm-production')) throw new Error('Production writes require --confirm-production.');
const db = new PrismaClient();

async function main() {
  const before = await db.wholesaleAccount.groupBy({ by: ['state'], _count: true });
  const candidates = (await db.wholesaleAccount.findMany({ select: { id: true, state: true } }))
    .filter(row => !row.state?.trim() || row.state.trim().toUpperCase() === 'OHIO');
  let updated = 0;
  if (apply) {
    for (const row of candidates) {
      // Compare original state to avoid overwriting a concurrent address edit.
      const result = await db.wholesaleAccount.updateMany({ where: { id: row.id, state: row.state }, data: { state: 'OH' } });
      updated += result.count;
    }
  }
  const after = await db.wholesaleAccount.groupBy({ by: ['state'], _count: true });
  console.log(JSON.stringify({ environment: expected, apply, candidates: candidates.length, updated, before, after }, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'State backfill failed'); process.exitCode = 1; }).finally(() => db.$disconnect());
