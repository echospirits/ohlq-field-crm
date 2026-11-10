import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { operationalCredentialKeyStatus } from '../lib/productionForecasting/operationalSignals/credentials';

const dedicatedVariable = 'PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY';
const fallbackVariable = 'OHLQ_TENANT_CREDENTIAL_ENCRYPTION_KEY';
const originalDedicated = process.env[dedicatedVariable];
const originalFallback = process.env[fallbackVariable];
const fallback = 'test-only-tenant-fallback-key-over-thirty-two-characters';
const workflow = readFileSync(new URL('../.github/workflows/production-forecast-refresh.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const step = workflow.split('      - name: Claim and refresh only Production Forecasting\n')[1];
assert.ok(step, 'Missing dedicated forecasting runner step.');
assert.match(step, /        shell: bash\n/);
const run = step.match(/        run: \|\n((?:          [^\n]*(?:\n|$))+)/)?.[1];
assert.ok(run, 'The dedicated runner must use a literal Bash run block.');
const shellSource = run.replace(/^ {10}/gm, '');
assert.doesNotMatch(shellSource, /\$\{\{/);
const bash = process.platform === 'win32'
  ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
  : 'bash';

afterEach(() => {
  for (const [variable, value] of [[dedicatedVariable, originalDedicated], [fallbackVariable, originalFallback]] as const) {
    if (value === undefined) delete process.env[variable];
    else process.env[variable] = value;
  }
});

for (const scenario of [
  { name: 'absent dedicated key uses the existing tenant fallback', dedicated: undefined, configured: true },
  { name: 'empty Actions secret uses the existing tenant fallback', dedicated: '', configured: true },
  { name: 'nonempty dedicated key retains its exact value and precedence', dedicated: 'test-only-dedicated-key-over-thirty-two-characters', configured: true },
  { name: 'whitespace dedicated key remains fail closed', dedicated: '   \t ', configured: false },
  { name: 'malformed nonempty dedicated key remains fail closed', dedicated: 'too-short', configured: false },
]) {
  test(`actual forecasting workflow wrapper: ${scenario.name}`, () => {
    const env: NodeJS.ProcessEnv = { ...process.env, [fallbackVariable]: fallback, BASH_ENV: '', ENV: '' };
    if (scenario.dedicated === undefined) delete env[dedicatedVariable];
    else env[dedicatedVariable] = scenario.dedicated;
    const result = spawnSync(bash, ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-s'], {
      encoding: 'utf8', env, timeout: 10000,
      // Stub the exact CLI boundary: this cannot launch a runner or reach a provider/database.
      // Only synthetic key values above cross back to the real application selector below.
      input: `npx() {
  [[ "$#" == 2 && "$1" == tsx && "$2" == scripts/run-production-forecast-refresh.ts ]] || return 61
  if [[ "\${PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY+x}" == x ]]; then
    printf 'present\\0%s\\0' "$PRODUCTION_OPERATIONAL_CREDENTIAL_ENCRYPTION_KEY"
  else
    printf 'absent\\0'
  fi
}
${shellSource}`,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const fields = result.stdout.split('\0');
    const preservesDedicated = Boolean(scenario.dedicated);
    assert.deepEqual(fields, preservesDedicated ? ['present', scenario.dedicated, ''] : ['absent', '']);
    process.env[fallbackVariable] = fallback;
    if (fields[0] === 'present') process.env[dedicatedVariable] = fields[1];
    else delete process.env[dedicatedVariable];
    assert.deepEqual(operationalCredentialKeyStatus(), {
      configured: scenario.configured,
      keyVariable: preservesDedicated ? dedicatedVariable : fallbackVariable,
    });
  });
}
