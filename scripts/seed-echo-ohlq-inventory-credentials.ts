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
  if (!envFile) throw new Error('Usage: seed-echo-ohlq-inventory-credentials <env-file>.');
  loadEnvFile(envFile);
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
