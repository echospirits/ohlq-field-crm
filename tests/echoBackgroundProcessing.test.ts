import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { ECHO_ORGANIZATION_ID as ECHO } from '../lib/echoAccess';
import { getOrganizationOhlqCredentials } from '../lib/ohlqTenantCredentials';
import { importOhlqAgencyInventoryCsv } from '../lib/ohlqAgencyInventoryImport';
import { refreshAgencyIntelligence } from '../lib/agencyIntelligenceService';
import { refreshAgencyMarketIntelligence } from '../lib/agencyMarketIntelligenceService';
import { evaluateWholesaleAssessments } from '../lib/wholesaleAssessmentService';
import { forecastAccess } from '../lib/productionForecasting/import';
import { discoverOrganizationProducts, discoverProductsForOrganizations } from '../lib/organizationProductDiscovery';

// Execute the delivered worker entry points with fixture databases/providers.
function load(path: string, mocks: Record<string, unknown>) {
  const filename = resolve(path), nativeRequire = createRequire(filename);
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const exports: Record<string, any> = {};
  runInNewContext(code, { exports, process, Buffer, Date, URL, URLSearchParams, Request, Response, TextEncoder, console,
    require: (name: string) => name in mocks ? mocks[name] : nativeRequire(name),
  }, { filename });
  return exports;
}

test('explicit foreign worker targets fail before reading credentials or writing data', async () => {
  const db: any = new Proxy({}, { get() { assert.fail('outside target must stop before database access'); } });
  await assert.rejects(getOrganizationOhlqCredentials('outside', db), /restricted to Echo/);
  await assert.rejects(discoverOrganizationProducts({ db, organizationId: 'outside' }), /restricted to Echo/);
  await assert.rejects(importOhlqAgencyInventoryCsv({ csv: '', reportDate: '2026-10-28', organizationId: 'outside', db }), /restricted to Echo/);
  await assert.rejects(refreshAgencyIntelligence({ db, organizationId: 'outside', inventoryReportDate: new Date(), salesReportDate: new Date() }), /restricted to Echo/);
  await assert.rejects(refreshAgencyMarketIntelligence({ db, organizationId: 'outside', asOfDate: new Date() }), /restricted to Echo/);
  await assert.rejects(evaluateWholesaleAssessments({ db, organizationId: 'outside' }), /restricted to Echo/);
  await assert.rejects(forecastAccess(db, 'outside'), /restricted to Echo/);

});

test('scheduled product discovery selects active Echo and skips retained outside organizations', async () => {
  const db: any = { organization: { findMany: async ({ where }: any) => {
    assert.equal(where.id, ECHO); assert.equal(where.active, true); assert.equal(where.vendorIdentifiers.some.active, true);
    return [{ id: 'outside' }];
  } } };
  const result = await discoverProductsForOrganizations({ db });
  assert.equal(result.organizationsScanned, 0); assert.equal(result.productsDiscovered, 0);
});

test('forecast workflow selects entitled Echo and rejects stale outside selection before refresh', async () => {
  const calls: string[] = [];
  const worker = load('lib/productionForecasting/workflow.ts', {
    '../prisma': { prisma: { organization: { findMany: async ({ where }: any) => {
      assert.equal(where.id, ECHO); assert.equal(where.active, true);
      assert.equal(where.features.some.featureKey, 'PRODUCTION_FORECASTING');
      return [{ id: ECHO }, { id: 'outside' }];
    } } } },
    '../appEnvironment': { isSideEffectEnabled: () => true },
    './service': { refreshProductionForecast: async (id: string) => calls.push(id) },
  });
  const result = await worker.productionForecastWorkflow();
  assert.equal(result.completed, 1); assert.equal(result.failed, 0); assert.deepEqual(calls, [ECHO]);
});

test('automatic research rejects a foreign pilot before polling or selecting fallback work', async () => {
  const db: any = {
    organization: { findFirst: async () => assert.fail('foreign pilot must not create another pilot') },
    accountResearchPilot: { findFirst: async ({ where, select }: any) => { assert.equal(where.organizationId, ECHO); return select.organizationId ? { id: 'stale-run', organizationId: 'outside' } : null; } },
    accountResearchJob: {
      count: async ({ where }: any) => { assert.equal(where.organizationId, ECHO); return 0; },
      findMany: async ({ where }: any) => { assert.equal(where.organizationId, ECHO); return []; },
      groupBy: async ({ where }: any) => { assert.equal(where.organizationId, ECHO); return []; },
    },
  };
  const worker = load('lib/accountResearchAutomation.ts', {
    './accountResearchOpenAI': { assertAccountResearchAutomationEnabled() {} },
    './accountResearchQueue': { getPrioritizedAccountResearchQueue: async ({ organizationId }: any) => { assert.equal(organizationId, ECHO); return []; } },
    './accountResearchPilotService': { pollAccountResearchPilot: () => assert.fail('outside run must not poll'), submitQueuedPilotJobs: () => assert.fail('outside run must not submit') },
  });
  const result = await worker.runAutomaticAccountResearch({ db });
  assert.equal(result.submitted, 0); assert.equal(result.outstandingJobs, 0);
});

test('an existing Echo research run still polls and submits a bounded wave', async () => {
  let polled = 0, submitted = 0, refreshed = 0;
  const db: any = {
    accountResearchPilot: {
      findFirst: async ({ where, select }: any) => {
        assert.equal(where.organizationId, ECHO);
        if (select.organizationId) return { id: 'echo-run', organizationId: ECHO };
        assert.equal(where.id, 'echo-run');
        return { status: 'RUNNING' };
      },
    },
    accountResearchJob: { count: async () => 0, findMany: async () => [], groupBy: async () => [] },
  };
  const worker = load('lib/accountResearchAutomation.ts', {
    './accountResearchOpenAI': { assertAccountResearchAutomationEnabled() {} },
    './accountResearchQueue': { getPrioritizedAccountResearchQueue: async ({ organizationId }: any) => { assert.equal(organizationId, ECHO); return []; } },
    './accountResearchPilotService': {
      pollAccountResearchPilot: async ({ organizationId, pilotId }: any) => { assert.equal(organizationId, ECHO); assert.equal(pilotId, 'echo-run'); polled++; return { reconciliationRequired: 0, paused: false }; },
      submitQueuedPilotJobs: async ({ organizationId, take }: any) => { assert.equal(organizationId, ECHO); assert.equal(take, 3); submitted++; return { submitted: 3, failed: 0, paused: false, remaining: 0 }; },
      refreshPilotStatus: async ({ organizationId, pilotId }: any) => { assert.equal(organizationId, ECHO); assert.equal(pilotId, 'echo-run'); refreshed++; },
    },
  });
  const result = await worker.runAutomaticAccountResearch({ db, remainingRunCapacity: 3 });
  assert.equal(polled, 1); assert.equal(submitted, 1); assert.equal(refreshed, 1); assert.equal(result.submitted, 3); assert.equal(result.attempted, 3);
});
