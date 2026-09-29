import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { AccountResearchJobStatus, OpportunityStatus } from '@prisma/client';
import { ACCOUNT_RESEARCH_TERMINAL_RETRY_COOLDOWN_DAYS, classifyResearchNeed, createResearchIdentitySnapshot, hasResearchIdentityChanged, readBusinessHours, readPublicRatings, readResearchSignals, shouldDeferResearchRetry, type ResearchQueueCandidate } from '../lib/accountResearchQueue';
import { accountResearchFailureReason, isActionableAccountResearchFailure, isUnsuccessfulAccountResearchAttempt } from '../lib/accountResearchFailures';
import { opportunityTerritoryForCounty, territoryCoverageDeficits } from '../lib/opportunityTerritories';

const now = new Date('2026-09-15T16:00:00.000Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
const candidate = (overrides: Partial<ResearchQueueCandidate> = {}): ResearchQueueCandidate => ({
  id: 'account_1', licenseeId: 'LIC-1', name: 'Example Bar', address: '1 Main St', city: 'Columbus', county: 'Franklin', state: 'OH', zip: '43215',
  createdAt: daysAgo(100),
  targetPublicResearch: { lastRefreshedAt: daysAgo(40), identitySnapshot: { accountName: 'Example Bar', address: '1 Main St', city: 'Columbus', state: 'OH', zip: '43215' } },
  opportunities: [{ productionScore: 50, status: OpportunityStatus.OPEN, actionedAt: null, lastDetectedAt: daysAgo(1) }],
  upcomingWork: [],
  ...overrides,
});

it('researches new out-of-state accounts without inventing sales, while retaining normal freshness and correction handling', () => {
  const outside = candidate({ state: 'Kentucky', opportunities: [], targetPublicResearch: null });
  assert.equal(classifyResearchNeed(outside, now)?.priorityBucket, 1);
  assert.equal(classifyResearchNeed({ ...outside, state: 'OH' }, now)?.priorityBucket, 1);
  const fresh = { ...outside, targetPublicResearch: { lastRefreshedAt: daysAgo(5), identitySnapshot: createResearchIdentitySnapshot(outside) } };
  assert.equal(classifyResearchNeed(fresh, now), null);
  assert.equal(classifyResearchNeed({ ...fresh, city: 'New city' }, now)?.priorityBucket, 2);
  assert.equal(hasResearchIdentityChanged({ ...outside, state: 'KY' }, createResearchIdentitySnapshot(outside)), false);
});

it('maps Ohio metros and only favors outside territories while their research coverage trails Central Ohio', () => {
  assert.equal(opportunityTerritoryForCounty('Franklin'), 'central-ohio');
  assert.equal(opportunityTerritoryForCounty('CUYAHOGA'), 'cleveland');
  assert.equal(opportunityTerritoryForCounty('Lucas'), 'toledo');
  assert.equal(opportunityTerritoryForCounty('Athens'), 'other-ohio');

  const researched = { lastRefreshedAt: daysAgo(1) };
  const missing = null;
  const deficits = territoryCoverageDeficits([
    { county: 'Franklin', targetPublicResearch: researched },
    { county: 'Delaware', targetPublicResearch: researched },
    { county: 'Cuyahoga', targetPublicResearch: researched },
    { county: 'Lake', targetPublicResearch: missing },
  ]);
  assert.equal(deficits.get('central-ohio'), 0);
  assert.equal(deficits.get('cleveland'), 0.5);

  const caughtUp = territoryCoverageDeficits([
    { county: 'Franklin', targetPublicResearch: researched },
    { county: 'Cuyahoga', targetPublicResearch: researched },
  ]);
  assert.equal(caughtUp.get('cleveland'), 0);
});

it('prioritizes unscored accounts, then exact identity changes', () => {
  assert.equal(classifyResearchNeed(candidate({ opportunities: [], targetPublicResearch: null }), now)?.priorityBucket, 1);
  assert.equal(classifyResearchNeed(candidate({ opportunities: [], targetPublicResearch: { lastRefreshedAt: daysAgo(10), identitySnapshot: createResearchIdentitySnapshot(candidate()) } }), now), null);
  assert.equal(classifyResearchNeed(candidate({ name: 'Renamed Bar' }), now)?.priorityBucket, 2);
  assert.equal(hasResearchIdentityChanged(candidate(), createResearchIdentitySnapshot(candidate())), false);
});

it('prioritizes fresh pursuit and near-term work only when research is over 30 days old', () => {
  const pursued = candidate({ opportunities: [{ productionScore: 50, status: OpportunityStatus.ACTIONED, actionedAt: daysAgo(0.5), lastDetectedAt: daysAgo(0.5) }] });
  assert.equal(classifyResearchNeed(pursued, now)?.priorityBucket, 3);
  assert.equal(classifyResearchNeed(candidate({ upcomingWork: [{ dueDate: new Date(now.getTime() + 86_400_000), createdAt: daysAgo(5) }] }), now)?.priorityBucket, 4);
  assert.equal(classifyResearchNeed(candidate({ targetPublicResearch: { lastRefreshedAt: daysAgo(10), identitySnapshot: createResearchIdentitySnapshot(candidate()) }, upcomingWork: [{ dueDate: new Date(now.getTime() + 86_400_000), createdAt: daysAgo(5) }] }), now), null);
});

it('uses other upcoming activity before the routine 90-day refresh', () => {
  assert.equal(classifyResearchNeed(candidate({ upcomingWork: [{ dueDate: new Date(now.getTime() + 5 * 86_400_000), createdAt: daysAgo(2) }] }), now)?.priorityBucket, 5);
  assert.equal(classifyResearchNeed(candidate({ targetPublicResearch: { lastRefreshedAt: daysAgo(91), identitySnapshot: createResearchIdentitySnapshot(candidate()) } }), now)?.priorityBucket, 6);
  assert.equal(classifyResearchNeed(candidate({ targetPublicResearch: { lastRefreshedAt: daysAgo(60), identitySnapshot: createResearchIdentitySnapshot(candidate()) } }), now), null);
});

it('queues accounts regardless of recent bottle volume', () => {
  assert.equal(classifyResearchNeed(candidate({ opportunities: [], targetPublicResearch: null }), now)?.priorityBucket, 1);
  assert.equal(classifyResearchNeed(candidate({ name: 'Renamed Bar' }), now)?.priorityBucket, 2);
  assert.equal(classifyResearchNeed(candidate({ targetPublicResearch: { lastRefreshedAt: daysAgo(91), identitySnapshot: createResearchIdentitySnapshot(candidate()) } }), now)?.priorityBucket, 6);
  const pursued = candidate({
    opportunities: [{ productionScore: 50, status: OpportunityStatus.ACTIONED, actionedAt: daysAgo(0.5), lastDetectedAt: daysAgo(0.5) }],
  });
  assert.equal(classifyResearchNeed(pursued, now)?.priorityBucket, 3);
  assert.equal(classifyResearchNeed(candidate({ upcomingWork: [{ dueDate: new Date(now.getTime() + 86_400_000), createdAt: daysAgo(5) }] }), now)?.priorityBucket, 4);
});

it('refreshes research-driven opportunity scores independently for every entitled tenant', () => {
  const scoring = readFileSync('lib/accountResearchScoring.ts', 'utf8');
  assert.match(scoring, /featureKey: 'ADVANCED_INTELLIGENCE'/);
  assert.match(scoring, /organizationId: scope\.id/);
});

it('returns operational failures to the queue while deferring unchanged account-location failures', () => {
  assert.equal(ACCOUNT_RESEARCH_TERMINAL_RETRY_COOLDOWN_DAYS, 7);
  const usageFailure = { status: AccountResearchJobStatus.FAILED, error: 'You have no credits remaining.', reviewNote: null, createdAt: daysAgo(1), submittedAt: daysAgo(1), inputSnapshot: null };
  const locationFailure = { status: AccountResearchJobStatus.REJECTED, error: null, reviewNote: 'Automatically declined: exact-location validation failed. Street address did not match.', createdAt: daysAgo(1), submittedAt: daysAgo(1), inputSnapshot: createResearchIdentitySnapshot(candidate()) };
  assert.equal(isUnsuccessfulAccountResearchAttempt(usageFailure), true);
  assert.equal(shouldDeferResearchRetry(candidate({ accountResearchJobs: [usageFailure] }), now), false);
  assert.equal(isActionableAccountResearchFailure(locationFailure), true);
  assert.equal(accountResearchFailureReason(locationFailure), 'Street address did not match.');
  assert.equal(shouldDeferResearchRetry(candidate({ accountResearchJobs: [locationFailure] }), now), true);
  for (const correctedIdentity of [
    { name: 'Corrected Bar' },
    { address: '2 Main St' },
    { city: 'Cleveland' },
    { state: 'KY' },
    { zip: '44113' },
  ]) {
    assert.equal(shouldDeferResearchRetry(candidate({ ...correctedIdentity, accountResearchJobs: [locationFailure] }), now), false);
  }
});

it('stores and reads source-attributed public research without changing identity comparisons', () => {
  const snapshot = createResearchIdentitySnapshot(candidate(), {
    publicRatings: [{ sourceName: 'Apple Maps', sourceUrl: 'https://maps.apple.com/example', rating: 4.6, reviewCount: 400 }],
    businessHours: { sourceName: 'Apple Maps', sourceUrl: 'https://maps.apple.com/example', schedule: [{ day: 'Monday', hours: '11:00 AM–10:00 PM' }] },
    evidence: [{ field: 'businessHours', claim: 'Hours listed.', sourceUrl: 'https://maps.apple.com/example', sourceTitle: 'Apple Maps', exactLocation: true }],
    privateDining: 'Yes', venueType: 'Hotel bar/restaurant', footTrafficSignal: 'High',
    footTrafficEvidence: 'Published capacity supports high traffic.', meetingSpaceSquareFeet: 100_000,
  });
  assert.deepEqual(readBusinessHours(snapshot)?.schedule, [{ day: 'Monday', hours: '11:00 AM–10:00 PM' }]);
  assert.equal(readPublicRatings(snapshot)[0].sourceName, 'Apple Maps');
  assert.deepEqual(readResearchSignals(snapshot), {
    privateDining: 'Yes', venueType: 'Hotel bar/restaurant', footTrafficSignal: 'High',
    footTrafficEvidence: 'Published capacity supports high traffic.', meetingSpaceSquareFeet: 100_000,
  });
  assert.equal(hasResearchIdentityChanged(candidate(), snapshot), false);
});
