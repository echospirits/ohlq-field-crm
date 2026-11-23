import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { type PrismaClient } from '@prisma/client';
import { ACCOUNT_RESEARCH_RECONCILIATION_PREFIX } from '../lib/accountResearchFailures';
import { ACCOUNT_RESEARCH_AUTOMATIC_RUN_ACTOR } from '../lib/accountResearchPilot';
import { recoverInterruptedResearchSubmissions, pollAccountResearchPilot, refreshPilotStatus, submitQueuedPilotJobs } from '../lib/accountResearchPilotService';
import { getPrioritizedAccountResearchQueue } from '../lib/accountResearchQueue';
import { ECHO_ORGANIZATION_ID } from '../lib/echoAccess';

function useTestResearchEnvironment(t: TestContext) {
  const saved = { ...process.env };
  Object.assign(process.env, { APP_ENV: 'production', APP_BASE_URL: 'https://crm.echospirits.com', DATABASE_ENVIRONMENT: 'production', DATABASE_TARGET_ID: 'ohlq-field-crm', BLOB_ENVIRONMENT: 'production', OAUTH_ENVIRONMENT: 'production', CRON_JOBS_ENABLED: 'true', ACCOUNT_RESEARCH_AUTOMATION_ENABLED: 'true', ACCOUNT_RESEARCH_PILOT_ENABLED: 'true', OPENAI_API_KEY: 'test', DATABASE_URL: 'postgresql://test:test@localhost/test', EXPECTED_DATABASE_HOST: 'localhost' });
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });
}

it('polling recovers an orphaned claim before checking active responses', async t => {
  useTestResearchEnvironment(t);
  const calls: string[] = [];
  let reserved = 80000;
  const db = {
    accountResearchJob: {
      findMany: async ({ where }: any) => {
        if (where.responseId === null) { calls.push('recover'); return [{ id: 'orphan', reservedMicros: reserved }]; }
        calls.push('poll'); return [];
      },
      updateMany: async () => ({ count: 1 }),
      groupBy: async () => [{ status: 'QUEUED', _count: { _all: 195 } }],
    },
    accountResearchPilot: {
      update: async ({ data }: any) => { reserved -= data.reservedMicros.decrement; },
      findFirst: async () => ({ status: 'RUNNING', maxAccounts: 195, startedByUserId: ACCOUNT_RESEARCH_AUTOMATIC_RUN_ACTOR }),
      updateMany: async () => ({ count: 1 }),
    },
    $executeRaw: async () => 1,
    $transaction: async (fn: any) => fn(db),
  };
  await pollAccountResearchPilot({ pilotId: 'pilot', organizationId: ECHO_ORGANIZATION_ID, db: db as unknown as PrismaClient, mode: 'automatic' });
  assert.equal(reserved, 0);
  assert.deepEqual(calls.slice(0, 2), ['recover', 'poll']);
});

it('recovery excludes fresh or response-backed claims and releases reservations only for the winning update', async () => {
  const now = new Date('2026-09-17T12:00:00Z');
  let releases = 0;
  let won = false;
  const db = {
    accountResearchJob: {
      findMany: async ({ where }: any) => {
        assert.equal(where.responseId, null);
        assert.equal(where.status, 'SUBMITTED');
        assert.equal(where.organizationId, 'org');
        assert.equal(where.submittedAt.lt.toISOString(), '2026-09-17T11:45:00.000Z');
        return [{ id: 'orphan', reservedMicros: 80000 }];
      },
      updateMany: async ({ where }: any) => {
        assert.equal(where.responseId, null);
        assert.equal(where.status, 'SUBMITTED');
        if (won) return { count: 0 };
        won = true; return { count: 1 };
      },
    },
    accountResearchPilot: { update: async () => { releases++; } },
    $transaction: async (fn: any) => fn(db),
  };
  const args = { pilotId: 'pilot', organizationId: 'org', now, db: db as unknown as PrismaClient };
  assert.equal(await recoverInterruptedResearchSubmissions(args), 1);
  assert.equal(await recoverInterruptedResearchSubmissions(args), 0);
  assert.equal(releases, 1);
});

it('fails closed on missing scoped child counts without writing a terminal pilot status', async () => {
  const db = {
    accountResearchJob: { groupBy: async () => [] },
    accountResearchPilot: {
      findFirst: async () => ({ status: 'RUNNING', maxAccounts: 226 }),
      update: async () => assert.fail('empty child counts must not mark a live pilot complete'),
      updateMany: async () => assert.fail('empty child counts must not mark a live pilot complete'),
    },
    $executeRaw: async () => 1,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  await assert.rejects(refreshPilotStatus({ pilotId: 'pilot', organizationId: ECHO_ORGANIZATION_ID, db: db as unknown as PrismaClient }), /job count/i);
});

it('keeps the manual submission gate when one OpenAI response is active', async t => {
  useTestResearchEnvironment(t);
  const db = {
    accountResearchPilot: { findFirst: async () => ({ id: 'manual', startedByUserId: 'admin', budgetLimitMicros: 2_000_000, reservedMicros: 80_000, estimatedSpendMicros: 0 }) },
    accountResearchJob: {
      findMany: async ({ where }: { where: { responseId?: unknown } }) => {
        if (where.responseId === null) return [];
        return assert.fail('manual mode must stop before reading queued work');
      },
      count: async () => 1,
    },
  };
  t.mock.method(globalThis, 'fetch', async () => assert.fail('manual mode must stop before provider submission'));
  await assert.rejects(submitQueuedPilotJobs({ pilotId: 'manual', organizationId: ECHO_ORGANIZATION_ID, db: db as unknown as PrismaClient }), /wave is still running/);
});

it('fills the remaining automatic wave slots and rechecks capacity inside the claim transaction', async t => {
  useTestResearchEnvironment(t);
  const jobs = Array.from({ length: 25 }, (_, index) => ({
    id: `job-${index}`,
    status: 'QUEUED',
    tier: 'LIGHTWEIGHT',
    inputSnapshot: { wholesaleAccountId: `account-${index}`, accountName: 'Test account' },
  }));
  let providerRequests = 0;
  let active = 1;
  let lockHeld = false;
  t.mock.method(globalThis, 'fetch', async (url: string, request: RequestInit) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(request.method, 'POST');
    assert.equal(lockHeld, false);
    providerRequests += 1;
    return Response.json({ id: `resp_${providerRequests}`, status: 'in_progress' });
  });
  const db = {
    accountResearchPilot: {
      findFirst: async () => ({ id: 'automatic', startedByUserId: ACCOUNT_RESEARCH_AUTOMATIC_RUN_ACTOR, budgetLimitMicros: 40_000_000, reservedMicros: 2_000_000, estimatedSpendMicros: 0 }),
      updateMany: async () => ({ count: 1 }),
    },
    accountResearchJob: {
      count: async ({ where }: any) => where.status === 'QUEUED' ? jobs.filter(job => job.status === 'QUEUED').length : active,
      findMany: async ({ where, take }: any) => where.responseId === null ? [] : jobs.slice(0, take),
      updateMany: async ({ where }: any) => {
        assert.equal(lockHeld, true);
        assert.equal(where.status, 'QUEUED');
        const job = jobs.find(item => item.id === where.id)!;
        job.status = 'SUBMITTED';
        active += 1;
        return { count: 1 };
      },
      update: async ({ where, data }: any) => Object.assign(jobs.find(item => item.id === where.id)!, data),
    },
    $executeRaw: async () => {
      lockHeld = true;
      // Another worker fills one slot between the initial count and the claim.
      if (active === 1) active += 1;
      return 1;
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      try { return await fn(db); }
      finally { lockHeld = false; }
    },
  };

  const result = await submitQueuedPilotJobs({ pilotId: 'automatic', organizationId: ECHO_ORGANIZATION_ID, db: db as unknown as PrismaClient, mode: 'automatic', take: 25 });
  assert.equal(result.submitted, 23);
  assert.equal(result.failed, 0);
  assert.equal(providerRequests, 23);
  assert.equal(active, 25);
});

for (const status of [404, 410, 200]) {
  it(`preserves an unavailable provider response for reconciliation (HTTP ${status})`, async t => {
    useTestResearchEnvironment(t);
    const responseId = 'resp_must_be_retained';
    const job = {
      id: 'job-1', pilotId: 'pilot', organizationId: ECHO_ORGANIZATION_ID, wholesaleAccountId: 'account-1',
      status: 'RUNNING', responseId, submittedAt: new Date(Date.now() - 2 * 60 * 60_000), reservedMicros: 80_000,
      error: null as string | null,
    };
    const requestedResponses: string[] = [];
    t.mock.method(globalThis, 'fetch', async (url: string, request: RequestInit) => {
      assert.equal(request.method, 'GET');
      requestedResponses.push(url);
      const payload = status === 200
        ? { id: responseId, status: 'in_progress' }
        : { error: { message: 'Response unavailable' } };
      return Response.json(payload, { status });
    });
    let reservationReleased = 0;
    const db = {
      accountResearchJob: {
        findMany: async ({ where }: any) => where.responseId?.not === null && job.status === 'RUNNING' ? [{ ...job }] : [],
        updateMany: async ({ where, data }: any) => {
          assert.equal(where.id, job.id);
          assert.equal(where.responseId, responseId);
          Object.assign(job, data);
          return { count: 1 };
        },
        groupBy: async () => [{ status: job.status, _count: { _all: 1 } }],
      },
      accountResearchPilot: {
        findFirst: async () => ({ status: 'RUNNING', maxAccounts: 1, startedByUserId: ACCOUNT_RESEARCH_AUTOMATIC_RUN_ACTOR }),
        update: async ({ data }: any) => { reservationReleased += data.reservedMicros?.decrement ?? 0; },
        updateMany: async ({ data }: any) => { reservationReleased += data.reservedMicros?.decrement ?? 0; return { count: 1 }; },
      },
      $executeRaw: async () => 1,
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    };

    const result = await pollAccountResearchPilot({ pilotId: job.pilotId, organizationId: job.organizationId, db: db as unknown as PrismaClient, mode: 'automatic' });
    assert.deepEqual(requestedResponses, [`https://api.openai.com/v1/responses/${responseId}`]);
    assert.equal(result.reconciliationRequired, 1);
    assert.equal(job.status, 'FAILED');
    assert.equal(job.responseId, responseId);
    assert.equal(job.reservedMicros, 0);
    assert.equal(reservationReleased, 80_000);
    assert.ok(job.error?.startsWith(ACCOUNT_RESEARCH_RECONCILIATION_PREFIX));

    const waiting = await getPrioritizedAccountResearchQueue({
      organizationId: job.organizationId,
      db: {
        organizationAccountOverlay: { findMany: async () => [] },
        wholesaleAccount: {
          findMany: async ({ where }: any) => {
            const relatedJobs = where.accountResearchJobs.none;
            assert.equal(relatedJobs.organizationId, job.organizationId);
            assert.ok(relatedJobs.OR.some((filter: any) => filter.status === job.status && job.error?.startsWith(filter.error?.startsWith ?? '\0')));
            return [];
          },
        },
      } as unknown as PrismaClient,
    });
    assert.deepEqual(waiting, []);
  });
}
