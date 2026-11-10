import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { ohioSourceConfiguration } from '../lib/productionForecasting/sourceConfiguration';
import { unavailableForecastRefreshState } from '../lib/productionForecasting/refreshState';

test('real foreground request/status imports and execution do not load source workers or browser packages', () => {
  const script = `
    const assert = require('node:assert/strict');
    const Module = require('node:module');
    const original = Module._load;
    Module._load = function(name, parent, main) {
      if (/sourceWorkflow(?:\\.ts)?$/.test(name) || /(?:playwright|sparticuz)/i.test(name)) throw new Error('Foreground loaded a browser worker: ' + name);
      return original.call(this, name, parent, main);
    };
    const { enqueueForecastRefresh, getForecastRefreshState } = require('./lib/productionForecasting/refreshRequests.ts');
    let request = null;
    const organizationId = 'org_echo_spirits', now = new Date();
    const tx = {
      $executeRaw: async () => 0,
      organization: { findFirst: async () => ({ id: organizationId, enabledStates: ['OH'], settings: { productionForecasting: { ohio: { historyStart: '2019-01-01', directInvoices: 'invoice-date' } } } }) },
      user: { findFirst: async () => ({ id: 'admin' }) },
      organizationOhlqCredentials: { findUnique: async () => ({ organizationId }) },
      productionForecastRefreshRequest: {
        updateMany: async () => ({ count: 0 }),
        findFirst: async ({where}) => where.status === 'SUCCEEDED' ? null : request,
        create: async ({data}) => request = { id:'cforegroundrequest0000001', startedAt:null, completedAt:null, ...data },
      },
    };
    const db = { ...tx, $transaction: async callback => callback(tx) };
    const services = {
      configuration: () => ({deploymentEnvironment:'test',repository:'echospirits/neat-tst',ref:'tst',token:'unused',workflowId:'production-forecast-refresh.yml'}),
      dispatch: async () => ({repository:'echospirits/neat-tst',ref:'tst',workflowId:'production-forecast-refresh.yml'}),
    };
    (async () => {
      const result = await enqueueForecastRefresh({organizationId,requestedByUserId:'admin',db,now,services});
      assert.equal(result.ok, true); assert.equal(result.state.job.status,'QUEUED');
      const state = await getForecastRefreshState(organizationId,db,now,services);
      assert.equal(state.job.status,'QUEUED'); assert.equal(state.configured,true);
      process.stdout.write('foreground provider boundary passed');
    })().catch(error => { process.stderr.write(error.stack); process.exitCode=1; });
  `;
  const output = execFileSync(process.execPath, ['--import', 'tsx', '--import', './tests/setup.ts', '--input-type=commonjs', '-e', script], { cwd: process.cwd(), encoding: 'utf8', timeout: 30000 });
  assert.match(output, /foreground provider boundary passed/);
});

test('the default source adapter loads only when an authorized background worker executes it', async () => {
  const organizationId = 'org_echo_spirits', now = new Date('2026-11-10T18:00:00Z');
  const request: Record<string, any> = { id: 'clazyworkerrequest000001', organizationId, requestedByUserId: 'admin', status: 'QUEUED', stage: 'QUEUED', activeKey: organizationId, requestedAt: now, startedAt: null, completedAt: null, expiresAt: new Date(now.getTime() + 3600000), result: {} };
  let loaded = 0, executions = 0;
  const tx = {
    $executeRaw: async () => 0,
    user: { findFirst: async () => ({ id: 'admin' }) },
    productionForecastRefreshRequest: {
      findFirst: async () => request,
      update: async ({ data }: any) => Object.assign(request, data),
      updateMany: async ({ where, data }: any) => {
        if (where.expiresAt?.lte || where.leaseToken && where.leaseToken !== request.leaseToken) return { count: 0 };
        Object.assign(request, data); return { count: 1 };
      },
    },
  };
  const db = { ...tx, $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx) };
  const dependencies: Record<string, unknown> = {
    'node:crypto': { randomUUID: () => 'worker-lease' }, '@prisma/client': { Prisma: {} }, '../prisma': { prisma: db },
    '../appEnvironment': { getAppEnvironment: () => 'test' }, '../echoAccess': { ECHO_ORGANIZATION_ID: organizationId },
    './import': { forecastAccess: async () => ({ id: organizationId, enabledStates: ['OH'] }) },
    './sourceConfiguration': { ohioSourceConfiguration }, './refreshState': { unavailableForecastRefreshState },
    './refreshDispatch': { getProductionForecastRefreshDispatchConfig: () => null, dispatchProductionForecastRefresh: async () => undefined, productionForecastRefreshRequestId: /^[a-z0-9_-]+$/i, productionForecastRefreshTarget: () => ({ repository: 'echospirits/neat-tst' }) },
  };
  const exports: Record<string, (...args: any[]) => Promise<any>> = {};
  const source = ts.transpileModule(readFileSync('lib/productionForecasting/refreshRequests.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(source, { exports, Date, setInterval, clearInterval, require: (name: string) => {
    if (name === './sourceWorkflow') {
      loaded++;
      return { syncProductionSources: async (options: any) => { executions++; await options.onStage('FORECAST'); options.onResult({ configuredOrganizations: 1, importedSources: 2, refreshedForecasts: 1, failedSources: [] }); return { configuredOrganizations: 1, importedSources: 2 }; } };
    }
    assert(name in dependencies, name); return dependencies[name];
  } });
  assert.equal(loaded, 0);
  const result = await exports.runProductionForecastRefresh({ requestId: request.id, organizationId, workflowRunId: '123', repository: 'echospirits/neat-tst', environment: 'test' }, { db, now: () => now, heartbeatIntervalMs: 0 });
  assert.equal(result.status, 'SUCCEEDED'); assert.equal(loaded, 1); assert.equal(executions, 1);
});
