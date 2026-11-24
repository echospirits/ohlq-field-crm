import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { type PrismaClient } from '@prisma/client';
import ts from 'typescript';
import { ECHO_ORGANIZATION_ID } from '../lib/echoAccess';

function loadWithMocks<T>(path: string, mocks: Record<string, unknown>): T {
  const filename = resolve(path);
  const nativeRequire = createRequire(filename);
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const exports = {};
  runInNewContext(outputText, {
    exports,
    require: (name: string) => name in mocks ? mocks[name] : nativeRequire(name),
  }, { filename });
  return exports as T;
}

it('opens a configured-state Echo scope inside every hosted research step', async () => {
  const scopes = new AsyncLocalStorage<string>();
  const calls: Array<{ scope: string | undefined; pilotId: string | undefined; remaining: number }> = [];
  let sleeps = 0;
  const worker = loadWithMocks<typeof import('../lib/accountResearchDailyWorkflow')>('lib/accountResearchDailyWorkflow.ts', {
    workflow: { sleep: async () => { assert.equal(scopes.getStore(), undefined); sleeps += 1; } },
    './prisma': {
      runWithOrganizationStateAccess: (organizationId: string, work: () => Promise<unknown>, options: { restrictToConfiguredStates: boolean }) => {
        assert.equal(options.restrictToConfiguredStates, true);
        return scopes.run(organizationId, work);
      },
    },
    './accountResearchAutomation': {
      runAutomaticAccountResearch: async ({ pilotId, remainingRunCapacity }: { pilotId?: string; remainingRunCapacity: number }) => {
        calls.push({ scope: scopes.getStore(), pilotId, remaining: remainingRunCapacity });
        const firstPass = calls.length === 1;
        return {
          pilotId: 'existing-pilot',
          submitted: firstPass ? 3 : 0,
          attempted: firstPass ? 4 : 0,
          outstandingJobs: firstPass ? 1 : 0,
          reconciliationRequired: firstPass ? 0 : 1,
          paused: false,
        };
      },
    },
  });

  const result = await worker.runDailyAccountResearchWorkflow();
  assert.deepEqual(calls, [
    { scope: ECHO_ORGANIZATION_ID, pilotId: undefined, remaining: 500 },
    { scope: ECHO_ORGANIZATION_ID, pilotId: 'existing-pilot', remaining: 496 },
  ]);
  assert.equal(sleeps, 1);
  assert.equal(result.pilotId, 'existing-pilot');
  assert.equal(result.submitted, 3);
  assert.equal(result.attempted, 4);
  assert.equal(result.reconciliationRequired, 1);
  assert.equal(scopes.getStore(), undefined);
});

it('stays pinned to one automatic pilot when resuming and after the pilot settles', async () => {
  let settled = false;
  const db = {
    accountResearchPilot: {
      findFirst: async ({ where, select }: { where: { id: string; organizationId: string }; select: { organizationId?: boolean } }) => {
        assert.equal(where.id, 'selected-pilot');
        assert.equal(where.organizationId, ECHO_ORGANIZATION_ID);
        if (settled) return null;
        return select.organizationId ? { id: where.id, organizationId: ECHO_ORGANIZATION_ID } : { status: 'RUNNING' };
      },
      create: async () => assert.fail('a pinned workflow must not create another pilot'),
    },
    accountResearchJob: {
      count: async () => 1,
      findMany: async () => [],
      groupBy: async () => [],
    },
    $transaction: async () => assert.fail('a pinned workflow must not enter the select-or-create transaction'),
  };
  const polls: string[] = [];
  const submissions: number[] = [];
  const worker = loadWithMocks<typeof import('../lib/accountResearchAutomation')>('lib/accountResearchAutomation.ts', {
    './accountResearchOpenAI': { assertAccountResearchAutomationEnabled() {} },
    './accountResearchQueue': { getPrioritizedAccountResearchQueue: async () => [] },
    './accountResearchPilotService': {
      pollAccountResearchPilot: async ({ pilotId }: { pilotId: string }) => {
        polls.push(pilotId);
        return { checked: 1, pending: 1, failedChecks: 0, reconciliationRequired: 0, paused: false };
      },
      submitQueuedPilotJobs: async ({ mode, take, pilotId }: { mode: string; take: number; pilotId: string }) => {
        assert.equal(mode, 'automatic');
        assert.equal(pilotId, 'selected-pilot');
        submissions.push(take);
        return { submitted: take, failed: 0, paused: false, remaining: 140 };
      },
    },
  });

  const params = { db: db as unknown as PrismaClient, pilotId: 'selected-pilot', remainingRunCapacity: 3 };
  const result = await worker.runAutomaticAccountResearch(params);
  assert.equal(result.submitted, 3);
  settled = true;
  const afterSettlement = await worker.runAutomaticAccountResearch(params);
  assert.equal(afterSettlement.pilotId, 'selected-pilot');
  assert.equal(afterSettlement.submitted, 0);
  assert.equal(afterSettlement.outstandingJobs, 0);
  assert.deepEqual(polls, ['selected-pilot']);
  assert.deepEqual(submissions, [3]);
});
