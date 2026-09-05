import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { assertSideEffectEnabled, validateRuntimeEnvironment } from '../lib/appEnvironment';
import { downloadOhlqAccountMaster } from '../lib/ohlqAnnualSalesReport';

function loadEnvFile(fileName: string) {
  const envPath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || line.trim().startsWith('#') || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

const getArgValue = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? '' : '';
};

async function runImporter(file: string, environment: string, apply: boolean) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = [
    'run',
    'import:ohlq-account-master',
    '--',
    '--file',
    file,
    '--environment',
    environment,
    ...(apply ? ['--apply'] : []),
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(npmCommand, args, { env: process.env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Account Master importer exited with ${signal ? `signal ${signal}` : `code ${code}`}.`));
    });
  });
}

async function main() {
  loadEnvFile('.env.local');
  loadEnvFile('.env');
  const environment = getArgValue('--environment');
  if (!['test', 'production'].includes(environment)) {
    throw new Error('Pass --environment test or --environment production.');
  }
  const apply = process.argv.includes('--apply');
  const runtime = validateRuntimeEnvironment();
  if (runtime.appEnvironment !== environment) {
    throw new Error(`Requested ${environment}, but APP_ENV=${runtime.appEnvironment}.`);
  }
  if (apply) assertSideEffectEnabled('ohlqImport');
  const download = await downloadOhlqAccountMaster({
    debugDir: path.join(process.cwd(), 'output', 'playwright'),
    downloadDir: path.join(process.cwd(), 'output', 'ohlq-downloads'),
    headless: true,
    returnBuffer: false,
    useServerlessChromium: false,
  });
  console.log(JSON.stringify({ accountMasterDownload: download }, null, 2));
  await runImporter(download.outputPath, environment, apply);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
