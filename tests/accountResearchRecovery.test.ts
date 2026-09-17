import assert from 'node:assert/strict';
import { it } from 'node:test';
import { type PrismaClient } from '@prisma/client';
import { recoverInterruptedResearchSubmissions, pollAccountResearchPilot } from '../lib/accountResearchPilotService';

it('polling recovers an orphaned claim before checking active responses', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { APP_ENV: 'production', APP_BASE_URL: 'https://crm.echospirits.com', DATABASE_ENVIRONMENT: 'production', DATABASE_TARGET_ID: 'ohlq-field-crm', BLOB_ENVIRONMENT: 'production', OAUTH_ENVIRONMENT: 'production', CRON_JOBS_ENABLED: 'true', ACCOUNT_RESEARCH_AUTOMATION_ENABLED: 'true', OPENAI_API_KEY: 'test', DATABASE_URL: 'postgresql://test:test@localhost/test', EXPECTED_DATABASE_HOST: 'localhost' });
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
      findFirst: async () => ({ status: 'RUNNING' }),
      updateMany: async () => ({ count: 1 }),
    },
    $transaction: async (fn: any) => fn(db),
  };
  try {
    await pollAccountResearchPilot({ pilotId: 'pilot', organizationId: 'org', db: db as unknown as PrismaClient, mode: 'automatic' });
    assert.equal(reserved, 0);
    assert.deepEqual(calls.slice(0, 2), ['recover', 'poll']);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
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
