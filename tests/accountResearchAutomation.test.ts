import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { OpportunityStatus } from '@prisma/client';
import { classifyResearchNeed, createResearchIdentitySnapshot, hasResearchIdentityChanged, readGoogleHours, type ResearchQueueCandidate } from '../lib/accountResearchQueue';

const now = new Date('2026-09-15T16:00:00.000Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
const candidate = (overrides: Partial<ResearchQueueCandidate> = {}): ResearchQueueCandidate => ({
  id: 'account_1', licenseeId: 'LIC-1', name: 'Example Bar', address: '1 Main St', city: 'Columbus', state: 'OH', zip: '43215',
  createdAt: daysAgo(100),
  targetPublicResearch: { lastRefreshedAt: daysAgo(40), identitySnapshot: { accountName: 'Example Bar', address: '1 Main St', city: 'Columbus', state: 'OH', zip: '43215' } },
  opportunities: [{ productionScore: 50, status: OpportunityStatus.OPEN, actionedAt: null, lastDetectedAt: daysAgo(1) }],
  upcomingWork: [],
  bottles30: 100,
  ...overrides,
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

it('excludes low-volume accounts unless tenant actions specifically elevate them', () => {
  assert.equal(classifyResearchNeed(candidate({ bottles30: 39, opportunities: [], targetPublicResearch: null }), now), null);
  assert.equal(classifyResearchNeed(candidate({ bottles30: 39, name: 'Renamed Bar' }), now), null);
  assert.equal(classifyResearchNeed(candidate({ bottles30: 39, targetPublicResearch: { lastRefreshedAt: daysAgo(91), identitySnapshot: createResearchIdentitySnapshot(candidate()) } }), now), null);

  const pursued = candidate({
    bottles30: 0,
    opportunities: [{ productionScore: 50, status: OpportunityStatus.ACTIONED, actionedAt: daysAgo(0.5), lastDetectedAt: daysAgo(0.5) }],
  });
  assert.equal(classifyResearchNeed(pursued, now)?.priorityBucket, 3);
  assert.equal(classifyResearchNeed(candidate({ bottles30: 0, upcomingWork: [{ dueDate: new Date(now.getTime() + 86_400_000), createdAt: daysAgo(5) }] }), now)?.priorityBucket, 4);
});

it('refreshes research-driven opportunity scores independently for every entitled tenant', () => {
  const scoring = readFileSync('lib/accountResearchScoring.ts', 'utf8');
  assert.match(scoring, /featureKey: 'ADVANCED_INTELLIGENCE'/);
  assert.match(scoring, /organizationId: scope\.id/);
});

it('stores and reads structured Google hours without changing identity comparisons', () => {
  const snapshot = createResearchIdentitySnapshot(candidate(), [{ day: 'Monday', hours: '11:00 AM–10:00 PM' }]);
  assert.deepEqual(readGoogleHours(snapshot), [{ day: 'Monday', hours: '11:00 AM–10:00 PM' }]);
  assert.equal(hasResearchIdentityChanged(candidate(), snapshot), false);
});
