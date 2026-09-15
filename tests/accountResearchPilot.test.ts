import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { getAccountResearchQueue } from '../lib/accountResearch';
import {
  ACCOUNT_RESEARCH_JOB_RESERVE_MICROS,
  ACCOUNT_RESEARCH_PILOT_BUDGET_MICROS,
  ACCOUNT_RESEARCH_PILOT_MAX_ACCOUNTS,
  chooseResearchTier,
  estimateResearchCostMicros,
  parseAccountResearchResult,
  validateExactResearchLocation,
  type AccountResearchInputSnapshot,
} from '../lib/accountResearchPilot';
import { assertAccountResearchEnvironment, assertAccountResearchPilotEnabled, retrieveAccountResearch, submitAccountResearch } from '../lib/accountResearchOpenAI';
import { deriveSettledPilotStatus } from '../lib/accountResearchPilotService';
import { AccountResearchPilotStatus } from '@prisma/client';

const staging = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production', APP_ENV: 'test', APP_BASE_URL: 'https://tst.example.com',
  DATABASE_URL: 'postgresql://user:password@test-db.example.com:5432/neat', DATABASE_ENVIRONMENT: 'test',
  DATABASE_TARGET_ID: 'test-db', EXPECTED_DATABASE_HOST: 'test-db.example.com', PRODUCTION_BASE_URL: 'https://crm.example.com',
  VERCEL: '1', VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'tst', ACCOUNT_RESEARCH_PILOT_ENABLED: 'true',
  OPENAI_API_KEY: 'test-key-never-log',
});

const input: AccountResearchInputSnapshot = {
  wholesaleAccountId: 'acct_1', licenseeId: 'LIC-1', accountName: 'Example Bar', address: '123 West Main Street',
  city: 'Columbus', state: 'OH', zip: '43215',
};

const result = {
  identity: { verdict: 'EXACT', matchedName: 'Example Bar', matchedAddress: '123 W Main St', matchedCity: 'Columbus', matchedState: 'OH', matchedZip: '43215-1234', explanation: 'Address agrees.' },
  researchedAt: '2026-09-14', websiteUrl: 'https://example.com/', cocktailMenuUrl: null, localBrandsOnMenu: [],
  patioOutdoor: 'Unknown', cocktailProgram: 'Moderate', events: null, popularitySignal: 'High', openStatus: 'Open',
  googleRating: 4.6, googleReviewCount: 400, yelpRating: null, yelpReviewCount: null, isNationalChain: false,
  ownershipVerification: 'Independent', buyerStructure: 'Local', notes: 'Exact address supported.', confidence: 'HIGH',
  evidence: [{ field: 'identity', claim: 'The listing uses 123 W Main St.', sourceUrl: 'https://example.com/contact', sourceTitle: 'Contact', exactLocation: true }],
};

it('hard-caps the pilot at 250 eight-cent reservations and twenty dollars', () => {
  assert.equal(ACCOUNT_RESEARCH_PILOT_MAX_ACCOUNTS, 250);
  assert.equal(ACCOUNT_RESEARCH_JOB_RESERVE_MICROS, 80_000);
  assert.equal(ACCOUNT_RESEARCH_PILOT_MAX_ACCOUNTS * ACCOUNT_RESEARCH_JOB_RESERVE_MICROS, ACCOUNT_RESEARCH_PILOT_BUDGET_MICROS);
});

it('reports an all-failed settled pilot as failed instead of complete', () => {
  assert.equal(deriveSettledPilotStatus({ FAILED: 50 }), AccountResearchPilotStatus.FAILED);
  assert.equal(deriveSettledPilotStatus({ NEEDS_REVIEW: 2, FAILED: 1 }), AccountResearchPilotStatus.READY_FOR_REVIEW);
  assert.equal(deriveSettledPilotStatus({ APPROVED: 49, REJECTED: 1 }), AccountResearchPilotStatus.COMPLETE);
  assert.equal(deriveSettledPilotStatus({ RUNNING: 1, FAILED: 49 }), null);
});

it('restricts automated research to an explicitly enabled test environment', () => {
  assert.doesNotThrow(() => assertAccountResearchPilotEnabled(staging()));
  assert.doesNotThrow(() => assertAccountResearchEnvironment({ ...staging(), OPENAI_API_KEY: '' }));
  assert.throws(() => assertAccountResearchPilotEnabled({ ...staging(), ACCOUNT_RESEARCH_PILOT_ENABLED: 'false' }), /disabled/);
  assert.throws(() => assertAccountResearchPilotEnabled({ ...staging(), APP_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main' }), /restricted to APP_ENV=test/);
});

it('assigns deep research only to pursued and high-provisional-score accounts', () => {
  assert.equal(chooseResearchTier([{ status: 'ACTIONED', productionScore: 20 }]).tier, 'DEEP');
  assert.equal(chooseResearchTier([{ status: 'OPEN', productionScore: 70 }]).tier, 'DEEP');
  assert.equal(chooseResearchTier([{ status: 'OPEN', productionScore: 69 }]).tier, 'LIGHTWEIGHT');
});

it('requires exact street number, city, ZIP, model verdict, and location evidence', () => {
  const parsed = parseAccountResearchResult(result);
  assert.equal(validateExactResearchLocation(input, parsed).exact, true);
  assert.equal(validateExactResearchLocation(input, { ...parsed, identity: { ...parsed.identity, matchedZip: '43000' } }).exact, false);
  assert.equal(validateExactResearchLocation(input, { ...parsed, evidence: parsed.evidence.map((item) => ({ ...item, exactLocation: false })) }).exact, false);
});

it('records a deterministic token and search-call cost estimate', () => {
  assert.equal(estimateResearchCostMicros({ inputTokens: 1_000, outputTokens: 500, webSearchCalls: 2 }), 20_800);
});

it('submits background structured research with bounded web-search calls', async () => {
  let requestBody: Record<string, unknown> | null = null;
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: 'resp_1', status: 'queued' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const response = await submitAccountResearch({ input, tier: 'LIGHTWEIGHT', pilotId: 'pilot_1', jobId: 'job_1', fetchImpl: fetchImpl as typeof fetch, env: staging() });
  assert.equal(response.responseId, 'resp_1');
  assert.ok(requestBody);
  const body = requestBody as Record<string, unknown>;
  assert.equal(body.background, true);
  assert.equal(body.max_tool_calls, 3);
  assert.deepEqual(body.tools, [{ type: 'web_search', search_context_size: 'low' }]);
  assert.equal((body.text as { format?: { type?: string } }).format?.type, 'json_schema');
  assert.doesNotMatch(JSON.stringify(requestBody), /test-key-never-log/);
});

it('retrieves and validates structured evidence and usage', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    id: 'resp_1', status: 'completed', usage: { input_tokens: 1000, output_tokens: 500 },
    output: [
      { type: 'web_search_call', action: { sources: [{ url: 'https://example.com/contact' }] } },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] },
    ],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const retrieved = await retrieveAccountResearch({ responseId: 'resp_1', fetchImpl: fetchImpl as typeof fetch, env: staging() });
  assert.equal(retrieved.result?.identity.verdict, 'EXACT');
  assert.equal(retrieved.webSearchCalls, 1);
  assert.deepEqual(retrieved.sourceUrls, ['https://example.com/contact']);
});

it('scopes waterfall candidates to the selected tenant organization', async () => {
  let query: unknown;
  const db = { wholesaleAccount: { findMany: async (value: unknown) => { query = value; return []; } } } as unknown as PrismaClient;
  await getAccountResearchQueue({ db, organizationId: 'org_1', limit: 50 });
  assert.match(JSON.stringify(query), /"organizationId":"org_1"/);
});

it('keeps the pilot manual and Platform Admin protected', () => {
  const vercel = readFileSync('vercel.json', 'utf8');
  const actions = readFileSync('app/admin/account-research/actions.ts', 'utf8');
  assert.doesNotMatch(vercel, /account-research/);
  assert.match(actions, /requirePlatformAdmin/);
  assert.match(actions, /startAccountResearchPilot/);
});
