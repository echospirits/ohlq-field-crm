import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ohlq-annual-sales.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const validationStep = 'Validate OHLQ import inputs';
const salesStep = 'Run OHLQ annual sales import';
const repairStep = 'Repair selected tenant OHLQ credentials';
const bash = process.platform === 'win32'
  ? path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
  : 'bash';

function step(name: string) {
  const body = workflow.split(`      - name: ${name}\n`)[1];
  assert.ok(body, `Missing workflow step: ${name}`);
  return body.split(/\n(?:      - name: |  [A-Za-z0-9_-]+:\n)/)[0];
}

function script(name: string) {
  const body = step(name);
  const block = body.split('        run: |\n')[1];
  if (block) return block.split('\n').map((line) => line.replace(/^          /, '')).join('\n');
  const inline = body.match(/^        run: (.+)$/m)?.[1];
  assert.ok(inline, `Missing run script: ${name}`);
  return inline;
}

// Model expression evaluation only at the YAML env boundary, never in Bash source.
function environment(name: string, context: Record<string, string>) {
  const block = step(name).match(/        env:\n((?:          [^\n]+\n)+)/)?.[1];
  assert.ok(block, `Missing step environment: ${name}`);
  return Object.fromEntries(block.trim().split('\n').map((line) => {
    const match = line.trim().match(/^(\w+): \$\{\{ (.+?) \}\}$/);
    assert.ok(match, `Unexpected env mapping: ${line}`);
    const [key, fallback] = match[2].split(' || ');
    return [match[1], context[key] || (fallback ? fallback.slice(1, -1) : '')];
  }));
}

function harness(run: (execute: (name: string, env: Record<string, string>) => ReturnType<typeof spawnSync>, dir: string) => void) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ohlq-workflow-inputs-'));
  const output = path.join(dir, 'github-output').replace(/\\/g, '/');
  const log = path.join(dir, 'npm-args').replace(/\\/g, '/');
  try {
    run((name, env) => spawnSync(bash, ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c',
      [
        'date() { if [[ "$*" == "+%Y-%m-%d" ]]; then printf "%s\\n" "$OHLQ_TEST_TODAY"; else command date "$@"; fi; }',
        'npm() { printf "%s\\0" "$@" >> "$NPM_CALL_LOG"; for arg in "$@"; do if [[ -n "${NPM_FAIL_DATE:-}" && "$arg" == "$NPM_FAIL_DATE" ]]; then return 1; fi; done; }',
        'node() { [[ "$1" == "scripts/retry-ohlq-command.cjs" && "$2" == "--" && "$3" == "npm" ]] || return 88; shift 2; "$@"; }',
        script(name),
      ].join('\n')], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 10_000,
      // Never give the harness database, OHLQ, or other hosted credentials.
      env: {
        NODE_ENV: 'test',
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        GITHUB_OUTPUT: output,
        NPM_CALL_LOG: log,
        OHLQ_TEST_TODAY: '2026-11-19',
        ...env,
      },
    }), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function inputEnvironment(inputs: Record<string, string> = {}, eventName = 'workflow_dispatch') {
  return environment(validationStep, {
    'github.event_name': eventName,
    ...Object.fromEntries(Object.entries(inputs).map(([name, value]) => [`github.event.inputs.${name}`, value])),
  });
}

function assertRejected(env: Record<string, string>) {
  harness((execute, dir) => {
    const result = execute(validationStep, env);
    assert.ifError(result.error);
    assert.equal(result.status, 1, String(result.stderr));
    assert.equal(existsSync(path.join(dir, 'injection-marker')), false);
    assert.equal(existsSync(path.join(dir, 'github-output')), false);
    assert.equal(existsSync(path.join(dir, 'npm-args')), false);
  });
}

test('OHLQ workflow expressions remain outside every run script and inputs validate before npm or imports', () => {
  for (const match of workflow.matchAll(/^      - name: (.+)$/gm)) {
    if (/^        run:/m.test(step(match[1]))) assert.doesNotMatch(script(match[1]), /\$\{\{/);
  }
  for (const name of ['Install dependencies', repairStep, 'Download and import current OHLQ Account Master', salesStep]) {
    assert.ok(workflow.indexOf(`- name: ${validationStep}`) < workflow.indexOf(`- name: ${name}`));
  }
});

test('date and count injection payloads are rejected as literal data without executing commands or npm', () => {
  const payloads = [
    '$(touch injection-marker)',
    '`touch injection-marker`',
    '"; touch injection-marker; #',
    '2026-10-07\n$(touch injection-marker)',
    '2026-10-07\npurchase_state_only=true',
  ];
  for (const input of ['reportDate', 'reportDates', 'dailyLoadDate', 'days', 'fromDate', 'toDate']) {
    for (const payload of payloads) assertRejected(inputEnvironment({ [input]: payload }));
  }
});

test('daily observation date requires a current, normal report-date batch', () => {
  const reportDates = '2026-11-17,2026-11-18';
  assertRejected(inputEnvironment({ dailyLoadDate: '2026-11-18', reportDates }));
  assertRejected(inputEnvironment({ dailyLoadDate: '2026-11-19', reportDate: '2026-11-18' }));
  assertRejected(inputEnvironment({ dailyLoadDate: '2026-11-19', reportDates, repairTenantCredentials: 'true' }));
});

test('dates, bounded decimal counts, range pairing and booleans validate before side effects', () => {
  for (const days of ['0', '-1', '+1', '01', '1.0', '1e1', ' 1 ', '31', '9999999999999999999999999']) {
    assertRejected(inputEnvironment({ days }));
  }
  for (const reportDate of ['2026-2-01', '2026-02-29', '2026-02-31', '2026-13-01', '2026-10-07;true']) {
    assertRejected(inputEnvironment({ reportDate }));
  }
  assertRejected(inputEnvironment({ purchaseStateOnly: 'true', days: '121' }));
  assertRejected(inputEnvironment({ purchaseStateOnly: 'invalid' }));
  assertRejected(inputEnvironment({ productionSourcesOnly: '$(touch injection-marker)' }));
  assertRejected(inputEnvironment({ productionSourcesOnly: 'true', purchaseStateOnly: 'true' }));
  assertRejected(inputEnvironment({ purchaseStateOnly: 'true', fromDate: '2026-10-01' }));
  assertRejected(inputEnvironment({ purchaseStateOnly: 'true', toDate: '2026-10-07' }));
  assertRejected(inputEnvironment({ purchaseStateOnly: 'true', fromDate: '2026-10-07', toDate: '2026-10-01' }));
  assertRejected({ ...inputEnvironment({}, 'schedule'), OHLQ_CRON_REFRESH_DAYS: '$(touch injection-marker)' });
});

const importArguments = (dates: string[]) => dates.flatMap((date) => ['run', 'backfill:ohlq-annual-sales', '--', '--date', date, '--import-only']);
const priorDates = (count: number) => Array.from({ length: count }, (_, index) => {
  const date = new Date('2026-11-19T12:00:00Z');
  date.setUTCDate(date.getUTCDate() - (count - index));
  return date.toISOString().slice(0, 10);
});
const validationOutputs = (dir: string) => Object.fromEntries(readFileSync(path.join(dir, 'github-output'), 'utf8').trimEnd().split('\n').map((line) => {
  const equals = line.indexOf('=');
  return [`steps.import_inputs.outputs.${line.slice(0, equals)}`, line.slice(equals + 1)];
}));

test('valid dates are frozen and each sales date reaches the importer with exact npm arguments', () => {
  const cases: { inputs: Record<string, string>; event?: string; cronDays?: string; args: string[] }[] = [
    { inputs: {}, args: importArguments(priorDates(1)) },
    { inputs: { days: '30' }, args: importArguments(priorDates(30)) },
    { inputs: { reportDate: '2024-02-29' }, args: importArguments(['2024-02-29']) },
    { inputs: { reportDates: '2026-11-18,2026-11-17' }, args: importArguments(['2026-11-17', '2026-11-18']) },
    { inputs: { reportDates: '2026-11-18,2026-11-17', dailyLoadDate: '2026-11-19' }, args: importArguments(['2026-11-17', '2026-11-18']) },
    { inputs: { purchaseStateOnly: 'true', reportDate: '2026-10-07' }, args: ['run', 'seed:ohlq-wholesale-purchase-state', '--', '--date', '2026-10-07'] },
    { inputs: { purchaseStateOnly: 'true', fromDate: '2026-10-01', toDate: '2026-10-07' }, args: ['run', 'seed:ohlq-wholesale-purchase-state', '--', '--from', '2026-10-01', '--to', '2026-10-07'] },
    { inputs: { purchaseStateOnly: 'true', days: '120' }, args: ['run', 'seed:ohlq-wholesale-purchase-state', '--', '--days', '120'] },
    { inputs: {}, event: 'schedule', args: importArguments(priorDates(2)) },
    { inputs: {}, event: 'schedule', cronDays: '3', args: importArguments(priorDates(3)) },
  ];
  for (const item of cases) {
    harness((execute, dir) => {
      const env = inputEnvironment(item.inputs, item.event);
      if (item.cronDays) env.OHLQ_CRON_REFRESH_DAYS = item.cronDays;
      const validation = execute(validationStep, env);
      assert.ifError(validation.error);
      assert.equal(validation.status, 0, String(validation.stderr));
      const outputs = validationOutputs(dir);
      const sales = execute(salesStep, environment(salesStep, outputs));
      assert.ifError(sales.error);
      assert.equal(sales.status, 0, String(sales.stderr));
      assert.deepEqual(readFileSync(path.join(dir, 'npm-args'), 'utf8').split('\0').slice(0, -1), item.args);
    });
  }
});

test('date batches reject invalid entries, ambiguous modes and more than thirty dates before setup', () => {
  for (const reportDates of ['2026-11-18,', ',2026-11-18', '2026-11-18, 2026-11-17', '2026-11-18,2026-02-30', '2026-11-18,2026-11-18', Array.from({ length: 31 }, (_, index) => `2026-10-${String(index + 1).padStart(2, '0')}`).join(',')]) {
    assertRejected(inputEnvironment({ reportDates }));
  }
  const conflicts: Record<string, string>[] = [{ reportDate: '2026-11-18' }, { days: '2' }, { purchaseStateOnly: 'true' }, { productionSourcesOnly: 'true' }];
  for (const conflict of conflicts) {
    assertRejected(inputEnvironment({ reportDates: '2026-11-17', ...conflict }));
  }
});

test('an unresolved older date does not block the newer date and the batch remains failed', () => {
  harness((execute, dir) => {
    const validation = execute(validationStep, inputEnvironment({ reportDates: '2026-11-18,2026-11-17' }));
    assert.equal(validation.status, 0, String(validation.stderr));
    const sales = execute(salesStep, { ...environment(salesStep, validationOutputs(dir)), NPM_FAIL_DATE: '2026-11-17' });
    assert.equal(sales.status, 1, String(sales.stderr));
    assert.deepEqual(readFileSync(path.join(dir, 'npm-args'), 'utf8').split('\0').slice(0, -1), importArguments(['2026-11-17', '2026-11-18']));
  });
});

test('a later clock date cannot change the frozen dates passed to recovery', () => {
  harness((execute, dir) => {
    assert.equal(execute(validationStep, inputEnvironment({}, 'schedule')).status, 0);
    const outputs = validationOutputs(dir);
    assert.equal(outputs['steps.import_inputs.outputs.observation_date'], '2026-11-19');
    const sales = execute(salesStep, { ...environment(salesStep, outputs), OHLQ_TEST_TODAY: '2026-11-20' });
    assert.equal(sales.status, 0, String(sales.stderr));
    assert.deepEqual(readFileSync(path.join(dir, 'npm-args'), 'utf8').split('\0').slice(0, -1), importArguments(['2026-11-17', '2026-11-18']));
  });
});

test('tenant repair preserves valid organization arguments and rejects shell syntax before npm', () => {
  for (const value of ['c' + 'a'.repeat(24), 'org_echo_spirits', 'org_neat_staging']) {
    harness((execute, dir) => {
      const env = environment(repairStep, { 'inputs.tenantOrganizationId': value });
      const result = execute(repairStep, { ...env, APP_ENV: 'test' });
      assert.ifError(result.error);
      assert.equal(result.status, 0, String(result.stderr));
      assert.equal(existsSync(path.join(dir, 'injection-marker')), false);
      assert.deepEqual(readFileSync(path.join(dir, 'npm-args'), 'utf8').split('\0').slice(0, -1),
        ['run', 'repair:ohlq-tenant-credentials', '--', '--environment', 'test', '--organization', value, '--apply']);
    });
  }
  for (const value of ['', '$(touch injection-marker)', '`touch injection-marker`', '"; touch injection-marker; #', 'tenant with spaces\nand a newline']) {
    harness((execute, dir) => {
      const result = execute(repairStep, { ...environment(repairStep, { 'inputs.tenantOrganizationId': value }), APP_ENV: 'test' });
      assert.ifError(result.error);
      assert.equal(result.status, 1);
      assert.equal(existsSync(path.join(dir, 'injection-marker')), false);
      assert.equal(existsSync(path.join(dir, 'npm-args')), false);
    });
  }
});
