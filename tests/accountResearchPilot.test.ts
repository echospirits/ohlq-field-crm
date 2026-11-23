import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { getAccountResearchQueue } from '../lib/accountResearch';
import {
  ACCOUNT_RESEARCH_JOB_RESERVE_MICROS,
  ACCOUNT_RESEARCH_PILOT_BUDGET_MICROS,
  ACCOUNT_RESEARCH_PILOT_MAX_ACCOUNTS,
  ACCOUNT_RESEARCH_SUBMISSION_WAVE_SIZE,
  ACCOUNT_RESEARCH_AUTOMATIC_DAILY_LIMIT,
  ACCOUNT_RESEARCH_AUTOMATIC_DAILY_BUDGET_MICROS,
  chooseResearchTier,
  estimateResearchCostMicros,
  parseAccountResearchResult,
  validateExactResearchLocation,
  type AccountResearchInputSnapshot,
} from '../lib/accountResearchPilot';
import { assertAccountResearchAutomationEnabled, assertAccountResearchEnvironment, assertAccountResearchPilotEnabled, getRateLimitRetryDelayMs, retrieveAccountResearch, submitAccountResearch } from '../lib/accountResearchOpenAI';
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
  patioOutdoor: 'Yes', privateDining: 'Yes', venueType: 'Hotel bar/restaurant',
  footTrafficSignal: 'High', footTrafficEvidence: 'The venue publishes a 500-person capacity.', meetingSpaceSquareFeet: 100_000,
  cocktailProgram: 'Moderate', events: null, popularitySignal: 'High', openStatus: 'Open',
  publicRatings: [{ sourceName: 'Apple Maps', sourceUrl: 'https://maps.apple.com/example', rating: 4.6, reviewCount: 400 }],
  businessHours: { sourceName: 'Apple Maps', sourceUrl: 'https://maps.apple.com/example', schedule: [{ day: 'Monday', hours: '11:00 AM–10:00 PM' }] },
  isNationalChain: false,
  ownershipVerification: 'Independent', buyerStructure: 'Local', notes: 'Exact address supported.', confidence: 'HIGH',
  evidence: [
    { field: 'identity', claim: 'The listing uses 123 W Main St.', sourceUrl: 'https://example.com/contact', sourceTitle: 'Contact', exactLocation: true },
    { field: 'footTraffic', claim: 'The venue publishes a 500-person capacity.', sourceUrl: 'https://example.com/venue', sourceTitle: 'Venue', exactLocation: true },
    { field: 'hotelMeetingSpace', claim: 'The hotel lists 100,000 square feet of meeting space.', sourceUrl: 'https://example.com/meetings', sourceTitle: 'Meetings', exactLocation: true },
  ],
};

it('hard-caps manual tests at 25 accounts and two dollars', () => {
  assert.equal(ACCOUNT_RESEARCH_PILOT_MAX_ACCOUNTS, 25);
  assert.equal(ACCOUNT_RESEARCH_SUBMISSION_WAVE_SIZE, 25);
  assert.equal(ACCOUNT_RESEARCH_JOB_RESERVE_MICROS, 80_000);
  assert.equal(ACCOUNT_RESEARCH_PILOT_MAX_ACCOUNTS * ACCOUNT_RESEARCH_JOB_RESERVE_MICROS, ACCOUNT_RESEARCH_PILOT_BUDGET_MICROS);
  assert.equal(ACCOUNT_RESEARCH_AUTOMATIC_DAILY_LIMIT, 500);
  assert.equal(ACCOUNT_RESEARCH_AUTOMATIC_DAILY_BUDGET_MICROS, 40_000_000);
});

it('reports an all-failed settled pilot as failed instead of complete', () => {
  assert.equal(deriveSettledPilotStatus({ FAILED: 50 }), AccountResearchPilotStatus.FAILED);
  assert.equal(deriveSettledPilotStatus({ NEEDS_REVIEW: 2, FAILED: 1 }), AccountResearchPilotStatus.READY_FOR_REVIEW);
  assert.equal(deriveSettledPilotStatus({ APPROVED: 49, REJECTED: 1 }), AccountResearchPilotStatus.COMPLETE);
  assert.equal(deriveSettledPilotStatus({ RUNNING: 1, FAILED: 49 }), null);
});

it('does not infer a terminal pilot status from missing job counts', () => {
  assert.equal(deriveSettledPilotStatus({}), null);
  assert.equal(deriveSettledPilotStatus({ APPROVED: 0, FAILED: 0 }), null);
});

it('allows guarded manual research in test and production but automatic research only in production', () => {
  assert.doesNotThrow(() => assertAccountResearchPilotEnabled(staging()));
  assert.doesNotThrow(() => assertAccountResearchEnvironment({ ...staging(), OPENAI_API_KEY: '' }));
  assert.throws(() => assertAccountResearchPilotEnabled({ ...staging(), ACCOUNT_RESEARCH_PILOT_ENABLED: 'false' }), /disabled/);
  const production = {
    ...staging(), APP_ENV: 'production', APP_BASE_URL: 'https://crm.example.com', DATABASE_ENVIRONMENT: 'production',
    DATABASE_URL: 'postgresql://user:password@prod-db.example.com:5432/neat', DATABASE_TARGET_ID: 'prod-db',
    EXPECTED_DATABASE_HOST: 'prod-db.example.com', VERCEL_GIT_COMMIT_REF: 'main', ACCOUNT_RESEARCH_AUTOMATION_ENABLED: 'true',
    CRON_JOBS_ENABLED: 'true',
  };
  assert.doesNotThrow(() => assertAccountResearchPilotEnabled(production));
  assert.doesNotThrow(() => assertAccountResearchAutomationEnabled(production));
  assert.throws(() => assertAccountResearchAutomationEnabled({ ...staging(), ACCOUNT_RESEARCH_AUTOMATION_ENABLED: 'true' }), /APP_ENV=production/);
});

it('assigns deep research only to pursued and solid-or-stronger commercial accounts', () => {
  assert.equal(chooseResearchTier([{ status: 'ACTIONED', rating: 0 }]).tier, 'DEEP');
  assert.equal(chooseResearchTier([{ status: 'OPEN', rating: 3 }]).tier, 'DEEP');
  assert.equal(chooseResearchTier([{ status: 'OPEN', rating: 2 }]).tier, 'LIGHTWEIGHT');
});

it('requires exact street number, city, ZIP, model verdict, and location evidence', () => {
  const parsed = parseAccountResearchResult(result);
  assert.equal(parsed.footTrafficSignal, 'High');
  assert.equal(parsed.privateDining, 'Yes');
  assert.equal(parsed.meetingSpaceSquareFeet, 100_000);
  assert.equal(validateExactResearchLocation(input, parsed).exact, true);
  assert.equal(validateExactResearchLocation(input, { ...parsed, identity: { ...parsed.identity, matchedZip: '43000' } }).exact, false);
  assert.equal(validateExactResearchLocation(input, { ...parsed, identity: { ...parsed.identity, matchedState: 'KY' } }).exact, false);
  assert.equal(validateExactResearchLocation(input, { ...parsed, identity: { ...parsed.identity, matchedState: 'Ohio' } }).exact, true);
  assert.equal(validateExactResearchLocation(input, { ...parsed, evidence: parsed.evidence.map((item) => ({ ...item, exactLocation: false })) }).exact, false);
});

it('matches an inclusive permit range, including a shortened endpoint and equivalent range notation', () => {
  const licensed = { ...input, address: '112–119 West Main Street' };
  for (const matchedAddress of ['112 W Main St', '116 W Main St', '119 W Main St', '112-119 W Main St']) {
    const researched = parseAccountResearchResult({ ...result, identity: { ...result.identity, matchedAddress } });
    assert.equal(validateExactResearchLocation(licensed, researched).exact, true, matchedAddress);
  }

  const shortened = { ...input, address: '1824-28 Columbus Pike' };
  const researched = parseAccountResearchResult({ ...result, identity: { ...result.identity, matchedAddress: '1828 Columbus Pike' } });
  assert.equal(validateExactResearchLocation(shortened, researched).exact, true);
});

it('matches explicitly listed permit numbers without treating gaps as part of the permit', () => {
  const licensed = { ...input, address: '1955 & 1959 East Maple Street' };
  for (const [matchedAddress, expected] of [['1955 E Maple St', true], ['1959 E Maple St', true], ['1957 E Maple St', false]] as const) {
    const researched = parseAccountResearchResult({ ...result, identity: { ...result.identity, matchedAddress } });
    const validation = validateExactResearchLocation(licensed, researched);
    assert.equal(validation.exact, expected, matchedAddress);
    assert.equal(validation.checks.streetNumber, expected, matchedAddress);
  }
});

it('rejects out-of-range numbers, ambiguous ranges, a range supplied only by the source, and different number suffixes', () => {
  const nonmatchingNumbers = [
    ['112–119 W Main St', '111 W Main St'],
    ['112–119 W Main St', '120 W Main St'],
    ['119–112 W Main St', '116 W Main St'],
    ['5676-78-80 Mayberry Sq', '5678 Mayberry Sq'],
    ['112 W Main St', '112–119 W Main St'],
    ['112A W Main St', '112 W Main St'],
  ];
  for (const [address, matchedAddress] of nonmatchingNumbers) {
    const researched = parseAccountResearchResult({ ...result, identity: { ...result.identity, matchedAddress } });
    const validation = validateExactResearchLocation({ ...input, address }, researched);
    assert.equal(validation.exact, false, `${address} vs. ${matchedAddress}`);
    assert.equal(validation.checks.streetNumber, false, `${address} vs. ${matchedAddress}`);
  }
});

it('requires the same street name, direction, and suite even when the permit covers the house number', () => {
  const licensed = { ...input, address: '112–119 West Main Street Suite 2' };
  for (const matchedAddress of ['116 W Lake St Suite 2', '116 E Main St Suite 2', '116 W Main St Suite 3', '116 W Main St']) {
    const researched = parseAccountResearchResult({ ...result, identity: { ...result.identity, matchedAddress } });
    const validation = validateExactResearchLocation(licensed, researched);
    assert.equal(validation.checks.streetNumber, true, matchedAddress);
    assert.equal(validation.checks.streetAddress, false, matchedAddress);
    assert.equal(validation.exact, false, matchedAddress);
  }
});

it('normalizes common permit address formatting while preserving explicit occupied units', () => {
  const comparisons = [
    ['114–118 W MAIN ST1ST FL & PARTIAL BSMT', '116 West Main Street', true],
    ['114–118 W MAIN ST1ST FL & PATIO', '116 West Main Street 2nd Floor', false],
    ['114–118 W MAIN ST STE 2 & PATIO', '116 West Main Street #2', true],
    ['114–118 W MAIN ST', '116 West Main Street Suite A', true],
    ['114–118 SR172 NE', '116 State Route 172 Northwest', false],
    ['114–118 SR172 NE', '116 OH-172 Northeast', true],
    ['114–118 W US HWY 36', '116 W US 36', true],
  ] as const;
  for (const [address, matchedAddress, exact] of comparisons) {
    const researched = parseAccountResearchResult({ ...result, identity: { ...result.identity, matchedAddress } });
    assert.equal(validateExactResearchLocation({ ...input, address }, researched).exact, exact, address + ' vs. ' + matchedAddress);
  }
});

it('recognizes Ohio city abbreviations and reviewed alternate localities at the same ZIP', () => {
  const cases = [
    { city: 'MILFORD CTR', matchedCity: 'Milford Center', zip: '43045', matchedZip: '43045', state: 'OH', exact: true },
    { city: 'Columbus', matchedCity: 'Dublin', zip: '43016', matchedZip: '43016-1234', state: 'Ohio', exact: true },
    { city: 'Columbus', matchedCity: 'Dublin', zip: '43215', matchedZip: '43215', state: 'OH', exact: false },
    { city: 'Columbus', matchedCity: 'Dublin', zip: '43016', matchedZip: '43017', state: 'OH', exact: false },
    { city: 'Columbus', matchedCity: 'Dublin', zip: '43016', matchedZip: '43016', state: 'KY', exact: false },
    { city: 'CENTERVILLE', matchedCity: 'Dayton/Centerville market', zip: '45459', matchedZip: '45459', state: 'OH', exact: true },
    { city: 'CENTERVILLE', matchedCity: 'Dayton/Centerville/Toledo', zip: '45459', matchedZip: '45459', state: 'OH', exact: false },
    { city: 'Noth Canton', matchedCity: 'North Canton', zip: '44720', matchedZip: '44720', state: 'OH', exact: true },
    { city: 'E Liverpool', matchedCity: 'East Liverpool', zip: '43920', matchedZip: '43920', state: 'Ohio', exact: true },
  ];
  for (const { city, matchedCity, zip, matchedZip, state, exact } of cases) {
    const researched = parseAccountResearchResult({ ...result, identity: { ...result.identity, matchedCity, matchedZip, matchedState: state } });
    const validation = validateExactResearchLocation({ ...input, city, zip, state }, researched);
    const context = `${city} vs. ${matchedCity}, ${state} ${zip} / ${matchedZip}`;
    assert.equal(validation.checks.city, exact, context);
    assert.equal(validation.exact, exact, context);
  }
});

it('keeps the exact venue verdict and exact-location evidence gates for equivalent addresses', () => {
  const licensed = { ...input, address: '112–119 West Main Street', city: 'MILFORD CTR', zip: '43045' };
  const identity = { ...result.identity, matchedAddress: '116 W Main St', matchedCity: 'Milford Center', matchedZip: '43045' };
  const probable = parseAccountResearchResult({ ...result, identity: { ...identity, verdict: 'PROBABLE' } });
  const noExactEvidence = parseAccountResearchResult({ ...result, identity, evidence: result.evidence.map((item) => ({ ...item, exactLocation: false })) });
  const probableValidation = validateExactResearchLocation(licensed, probable);
  assert.equal(probableValidation.checks.streetNumber, true);
  assert.equal(probableValidation.checks.city, true);
  assert.equal(probableValidation.checks.modelVerdict, false);
  assert.equal(probableValidation.exact, false);
  const evidenceValidation = validateExactResearchLocation(licensed, noExactEvidence);
  assert.equal(evidenceValidation.checks.locationEvidence, false);
  assert.equal(evidenceValidation.exact, false);
});

it('keeps legacy Google-shaped research responses readable without asserting Google provenance', () => {
  const { publicRatings: _publicRatings, businessHours: _businessHours, ...shared } = result;
  const legacy = { ...shared, googleRating: 4.6, googleReviewCount: 400, yelpRating: null, yelpReviewCount: null };
  const parsed = parseAccountResearchResult(legacy);
  assert.equal(parsed.publicRatings[0].sourceName, 'Legacy source not recorded');
  assert.equal(parsed.businessHours, null);
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
  assert.deepEqual(retrieved.result?.businessHours?.schedule, [{ day: 'Monday', hours: '11:00 AM–10:00 PM' }]);
  assert.equal(retrieved.result?.publicRatings[0].sourceName, 'Apple Maps');
  assert.equal(retrieved.webSearchCalls, 1);
  assert.deepEqual(retrieved.sourceUrls, ['https://example.com/contact']);
});

it('honors OpenAI retry timing with a bounded buffer', () => {
  assert.equal(getRateLimitRetryDelayMs(new Response(null, { headers: { 'retry-after': '3.334' } }), ''), 3_834);
  assert.equal(getRateLimitRetryDelayMs(new Response(null), 'Please try again in 2.5s.'), 3_000);
  assert.equal(getRateLimitRetryDelayMs(new Response(null, { headers: { 'retry-after': '90' } }), ''), 10_000);
});

it('scopes waterfall candidates to the selected tenant organization', async () => {
  let query: unknown;
  let overlayQuery: unknown;
  const db = {
    wholesaleAccount: { findMany: async (value: unknown) => { query = value; return []; } },
    organizationAccountOverlay: { findMany: async (value: unknown) => { overlayQuery = value; return []; } },
  } as unknown as PrismaClient;
  await getAccountResearchQueue({ db, organizationId: 'org_1', limit: 50 });
  assert.match(JSON.stringify(query), /"organizationId":"org_1"/);
  assert.deepEqual(overlayQuery, {
    where: { organizationId: 'org_1', accountType: 'WHOLESALE', isTargeting: true },
    select: { externalAccountId: true },
  });
});

it('keeps manual tests Platform Admin protected and schedules a production-gated worker', () => {
  const vercel = readFileSync('vercel.json', 'utf8');
  const actions = readFileSync('app/admin/account-research/actions.ts', 'utf8');
  const service = readFileSync('lib/accountResearchPilotService.ts', 'utf8');
  assert.match(vercel, /\/api\/cron\/account-research/);
  assert.match(vercel, /"schedule": "0 12 \* \* \*"/);
  assert.match(actions, /requireEchoAdmin/);
  assert.match(actions, /startAccountResearchPilot/);
  assert.match(service, /take = ACCOUNT_RESEARCH_SUBMISSION_WAVE_SIZE/);
  assert.match(service, /The current 25-account wave is still running/);
  assert.doesNotMatch(service, /setTimeout\(resolve, 15_000\)/);
  const route = readFileSync('app/api/cron/account-research/route.ts', 'utf8');
  assert.match(route, /getAccountResearchAutomationAvailability/);
  assert.match(route, /start\(runDailyAccountResearchWorkflow\)/);
  const workflow = readFileSync('lib/accountResearchDailyWorkflow.ts', 'utf8');
  assert.match(workflow, /'use workflow'/);
  assert.match(workflow, /sleep\(ACCOUNT_RESEARCH_AUTOMATIC_WAVE_PAUSE\)/);
  const automation = readFileSync('lib/accountResearchAutomation.ts', 'utf8');
  assert.match(automation, /remainingRunCapacity/);
  assert.doesNotMatch(automation, /ACCOUNT_RESEARCH_AUTOMATIC_DAILY_LIMIT - submittedToday/);
  const page = readFileSync('app/admin/account-research/page.tsx', 'utf8');
  assert.match(page, /const researchWhere = \{ lastRefreshedAt: \{ not: null as null \} \}/);
  assert.match(page, /orderBy: \[\{ updatedAt: 'desc' \}/);
  assert.match(page, /formatEasternDateTime\(item\.updatedAt\)/);
  assert.doesNotMatch(page, /const researchWhere = .*opportunities/);
  assert.match(page, /Failures to fix/);
  assert.match(page, /Account research history/);
  assert.match(page, /ResearchFailureList failures=/);
  const failures = readFileSync('app/admin/account-research/ResearchFailureList.tsx', 'utf8');
  assert.match(failures, /Open restaurant account/);
  assert.match(page, /unsuccessful/);
  assert.match(page, /hasResearchIdentityChanged\(attempt\.wholesaleAccount, attempt\.inputSnapshot\)/);
  assert.match(page, /uniqueAccountsSubmittedToday/);
});
