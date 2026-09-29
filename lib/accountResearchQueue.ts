import { AccountResearchJobStatus, OpportunityStatus, WorklistStatus, type PrismaClient } from '@prisma/client';
import type { AccountResearchResult } from './accountResearchPilot';
import { isActionableAccountResearchFailure } from './accountResearchFailures';
import { opportunityTerritoryForCounty, territoryCoverageDeficits } from './opportunityTerritories';
import { prisma } from './prisma';
import { isOutsideOhio, normalizeUsState } from './usStates';

const DAY = 86_400_000;
const ACTIVE_RESEARCH_JOB_STATUSES = [
  AccountResearchJobStatus.QUEUED,
  AccountResearchJobStatus.SUBMITTED,
  AccountResearchJobStatus.RUNNING,
  AccountResearchJobStatus.NEEDS_REVIEW,
];
const TERMINAL_RESEARCH_RETRY_STATUSES = [
  AccountResearchJobStatus.FAILED,
  AccountResearchJobStatus.BLOCKED_BUDGET,
  AccountResearchJobStatus.REJECTED,
];
export const ACCOUNT_RESEARCH_TERMINAL_RETRY_COOLDOWN_DAYS = 7;

export type ResearchIdentitySnapshot = {
  accountName: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  publicRatings?: AccountResearchResult['publicRatings'];
  businessHours?: AccountResearchResult['businessHours'];
  researchEvidence?: AccountResearchResult['evidence'];
  researchSignals?: Pick<AccountResearchResult, 'privateDining' | 'venueType' | 'footTrafficSignal' | 'footTrafficEvidence' | 'meetingSpaceSquareFeet'>;
  // Read-only compatibility for research completed before source provenance was captured.
  googleHours?: Array<{ day: string; hours: string }>;
};

export type ResearchQueueCandidate = {
  id: string;
  licenseeId: string;
  name: string;
  address: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  zip: string | null;
  createdAt: Date;
  isTargeting?: boolean;
  targetPublicResearch: { lastRefreshedAt: Date | null; identitySnapshot: unknown } | null;
  opportunities: Array<{ productionScore: number; status: OpportunityStatus; actionedAt: Date | null; lastDetectedAt: Date }>;
  upcomingWork: Array<{ dueDate: Date | null; createdAt: Date }>;
  accountResearchJobs?: Array<{
    status: AccountResearchJobStatus;
    submittedAt: Date | null;
    createdAt: Date;
    error?: string | null;
    reviewNote?: string | null;
    inputSnapshot?: unknown;
  }>;
};

export type ResearchQueueItem = ResearchQueueCandidate & {
  priorityBucket: 1 | 2 | 3 | 4 | 5 | 6;
  researchReason: string;
};

const normalized = (value: string | null | undefined) => (value ?? '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const ageCutoff = (now: Date, days: number) => new Date(now.getTime() - days * DAY);
const isOlderThan = (value: Date | null | undefined, cutoff: Date) => !value || value < cutoff;

export const createResearchIdentitySnapshot = (
  candidate: Pick<ResearchQueueCandidate, 'name' | 'address' | 'city' | 'state' | 'zip'>,
  research?: Pick<AccountResearchResult, 'publicRatings' | 'businessHours' | 'evidence'>
    & Partial<Pick<AccountResearchResult, 'privateDining' | 'venueType' | 'footTrafficSignal' | 'footTrafficEvidence' | 'meetingSpaceSquareFeet'>>,
): ResearchIdentitySnapshot => ({
  accountName: candidate.name,
  address: candidate.address,
  city: candidate.city,
  state: candidate.state,
  zip: candidate.zip,
  ...(research ? {
    publicRatings: research.publicRatings,
    businessHours: research.businessHours,
    researchEvidence: research.evidence,
    researchSignals: {
      privateDining: research.privateDining ?? 'Unknown',
      venueType: research.venueType ?? 'Unknown',
      footTrafficSignal: research.footTrafficSignal ?? 'Unknown',
      footTrafficEvidence: research.footTrafficEvidence ?? null,
      meetingSpaceSquareFeet: research.meetingSpaceSquareFeet ?? null,
    },
  } : {}),
});

type BusinessHour = NonNullable<AccountResearchResult['businessHours']>['schedule'][number];

const isBusinessHour = (item: unknown): item is BusinessHour => (
    Boolean(item)
    && typeof item === 'object'
    && typeof (item as { day?: unknown }).day === 'string'
    && typeof (item as { hours?: unknown }).hours === 'string'
  );

export const readBusinessHours = (snapshot: unknown): AccountResearchResult['businessHours'] => {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const stored = snapshot as Partial<ResearchIdentitySnapshot>;
  if (stored.businessHours && typeof stored.businessHours === 'object' && !Array.isArray(stored.businessHours)) {
    const sourceName = (stored.businessHours as { sourceName?: unknown }).sourceName;
    const sourceUrl = (stored.businessHours as { sourceUrl?: unknown }).sourceUrl;
    const schedule = (stored.businessHours as { schedule?: unknown }).schedule;
    if (typeof sourceName === 'string' && typeof sourceUrl === 'string' && Array.isArray(schedule)) {
      const validSchedule = schedule.filter(isBusinessHour);
      if (validSchedule.length) return { sourceName, sourceUrl, schedule: validSchedule };
    }
  }
  const legacyHours = stored.googleHours;
  if (!Array.isArray(legacyHours)) return null;
  const schedule = legacyHours.filter(isBusinessHour);
  return schedule.length ? { sourceName: 'Legacy source not recorded', sourceUrl: '', schedule } : null;
};

export const readPublicRatings = (snapshot: unknown): AccountResearchResult['publicRatings'] => {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return [];
  const ratings = (snapshot as Partial<ResearchIdentitySnapshot>).publicRatings;
  if (!Array.isArray(ratings)) return [];
  return ratings.filter((item): item is AccountResearchResult['publicRatings'][number] => (
    Boolean(item) && typeof item === 'object'
    && typeof item.sourceName === 'string' && typeof item.sourceUrl === 'string'
    && typeof item.rating === 'number'
    && (item.reviewCount === null || typeof item.reviewCount === 'number')
  ));
};

export const readResearchEvidence = (snapshot: unknown): AccountResearchResult['evidence'] => {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return [];
  const evidence = (snapshot as Partial<ResearchIdentitySnapshot>).researchEvidence;
  if (!Array.isArray(evidence)) return [];
  return evidence.filter((item): item is AccountResearchResult['evidence'][number] => (
    Boolean(item) && typeof item === 'object'
    && typeof item.field === 'string' && typeof item.claim === 'string'
    && typeof item.sourceUrl === 'string' && typeof item.exactLocation === 'boolean'
  ));
};

export const readResearchSignals = (snapshot: unknown): NonNullable<ResearchIdentitySnapshot['researchSignals']> => {
  const unknownSignals = {
    privateDining: 'Unknown', venueType: 'Unknown', footTrafficSignal: 'Unknown',
    footTrafficEvidence: null, meetingSpaceSquareFeet: null,
  } as const;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return unknownSignals;
  const stored = (snapshot as Partial<ResearchIdentitySnapshot>).researchSignals;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return unknownSignals;
  const privateDining = ['Strong', 'Yes', 'No', 'Unknown'].includes(stored.privateDining) ? stored.privateDining : 'Unknown';
  const venueType = ['Hotel bar/restaurant', 'Restaurant', 'Bar', 'Other', 'Unknown'].includes(stored.venueType) ? stored.venueType : 'Unknown';
  const footTrafficSignal = ['Very High', 'High', 'Medium', 'Low', 'Unknown'].includes(stored.footTrafficSignal) ? stored.footTrafficSignal : 'Unknown';
  return {
    privateDining,
    venueType,
    footTrafficSignal,
    footTrafficEvidence: typeof stored.footTrafficEvidence === 'string' ? stored.footTrafficEvidence : null,
    meetingSpaceSquareFeet: typeof stored.meetingSpaceSquareFeet === 'number' && stored.meetingSpaceSquareFeet >= 0 ? stored.meetingSpaceSquareFeet : null,
  } as NonNullable<ResearchIdentitySnapshot['researchSignals']>;
};

export const hasResearchIdentityChanged = (
  candidate: Pick<ResearchQueueCandidate, 'name' | 'address' | 'city' | 'state' | 'zip'>,
  snapshot: unknown,
) => {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
  const prior = snapshot as Partial<ResearchIdentitySnapshot>;
  return normalized(candidate.name) !== normalized(prior.accountName)
    || normalized(candidate.address) !== normalized(prior.address)
    || normalized(candidate.city) !== normalized(prior.city)
    || (normalizeUsState(candidate.state) ?? normalized(candidate.state)) !== (normalizeUsState(prior.state) ?? normalized(prior.state))
    || normalized(candidate.zip) !== normalized(prior.zip);
};

export function shouldDeferResearchRetry(
  candidate: Pick<ResearchQueueCandidate, 'name' | 'address' | 'city' | 'state' | 'zip' | 'accountResearchJobs'>,
  now = new Date(),
) {
  const latestAttempt = candidate.accountResearchJobs?.[0];
  if (!latestAttempt || latestAttempt.createdAt < ageCutoff(now, ACCOUNT_RESEARCH_TERMINAL_RETRY_COOLDOWN_DAYS)) return false;
  // Provider, billing, rate-limit, and other operational failures are unsuccessful
  // attempts, not account defects. They immediately return to queue eligibility.
  if (!isActionableAccountResearchFailure(latestAttempt)) return false;
  // Once the user corrects the submitted identity, do not make them wait for the
  // normal cooldown before trying the account again.
  return !hasResearchIdentityChanged(candidate, latestAttempt.inputSnapshot);
}

export function classifyResearchNeed(candidate: ResearchQueueCandidate, now = new Date()): ResearchQueueItem | null {
  const refreshedAt = candidate.targetPublicResearch?.lastRefreshedAt ?? null;
  const stale30 = isOlderThan(refreshedAt, ageCutoff(now, 30));
  const recentPursuit = candidate.opportunities.some((item) => item.status === OpportunityStatus.ACTIONED && item.actionedAt && item.actionedAt >= ageCutoff(now, 1));
  const recentTenantActivity = candidate.opportunities.some((item) => item.actionedAt && item.actionedAt >= ageCutoff(now, 7));
  const nextTwoDays = new Date(now.getTime() + 2 * DAY);
  const nextSevenDays = new Date(now.getTime() + 7 * DAY);
  const upcomingTwoDayWork = candidate.upcomingWork.some((item) => item.dueDate && item.dueDate >= now && item.dueDate <= nextTwoDays);
  const otherUpcomingWork = candidate.upcomingWork.some((item) => (item.dueDate && item.dueDate >= now && item.dueDate <= nextSevenDays) || (!item.dueDate && item.createdAt >= ageCutoff(now, 1)));

  if (candidate.isTargeting) return { ...candidate, priorityBucket: 1, researchReason: 'Target account; refresh research' };
  if (candidate.opportunities.length === 0 && !refreshedAt) return { ...candidate, priorityBucket: 1, researchReason: 'New account without an opportunity score or research' };
  if (hasResearchIdentityChanged(candidate, candidate.targetPublicResearch?.identitySnapshot)) return { ...candidate, priorityBucket: 2, researchReason: 'Account name or address changed since research' };
  if (stale30 && recentPursuit) return { ...candidate, priorityBucket: 3, researchReason: 'Opportunity moved to in progress by a tenant in the last day; research is over 30 days old' };
  if (stale30 && upcomingTwoDayWork) return { ...candidate, priorityBucket: 4, researchReason: 'Tenant work is due in the next two days; research is over 30 days old' };
  if (stale30 && (otherUpcomingWork || recentTenantActivity)) return { ...candidate, priorityBucket: 5, researchReason: 'Upcoming or recent tenant activity; research is over 30 days old' };
  if (isOlderThan(refreshedAt, ageCutoff(now, 90))) return { ...candidate, priorityBucket: 6, researchReason: 'Research intelligence is over 90 days old' };
  return null;
}

export async function getPrioritizedAccountResearchQueue({
  db = prisma,
  now = new Date(),
  limit = null,
}: {
  db?: PrismaClient;
  now?: Date;
  limit?: number | null;
} = {}) {
  const targetedOverlays = await db.organizationAccountOverlay.findMany({ where: { accountType: 'WHOLESALE', isTargeting: true }, select: { externalAccountId: true } });
  const targetedIds = [...new Set(targetedOverlays.map(({ externalAccountId }) => externalAccountId))];
  const accounts = await db.wholesaleAccount.findMany({
    where: {
      isActive: true,
      mergedIntoId: null,
      address: { not: null },
      city: { not: null },
      zip: { not: null },
      accountResearchJobs: { none: { OR: [
        { status: { in: ACTIVE_RESEARCH_JOB_STATUSES } },
      ] } },
    },
    select: {
      id: true,
      licenseeId: true,
      name: true,
      address: true,
      city: true,
      county: true,
      state: true,
      zip: true,
      createdAt: true,
      targetPublicResearch: { select: { lastRefreshedAt: true, identitySnapshot: true } },
      opportunities: { select: { productionScore: true, status: true, actionedAt: true, lastDetectedAt: true } },
      accountResearchJobs: {
        where: { status: { in: TERMINAL_RESEARCH_RETRY_STATUSES } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { status: true, submittedAt: true, createdAt: true, error: true, reviewNote: true, inputSnapshot: true },
      },
    },
  });
  if (accounts.length === 0) return [];
  const work = await db.worklistItem.findMany({
    where: {
      wholesaleAccountId: { in: accounts.map((item) => item.id) },
      status: { in: [WorklistStatus.OPEN, WorklistStatus.IN_PROGRESS] },
      OR: [{ dueDate: { lte: new Date(now.getTime() + 7 * DAY) } }, { dueDate: null, createdAt: { gte: ageCutoff(now, 1) } }],
    },
    select: { wholesaleAccountId: true, dueDate: true, createdAt: true },
  });
  const workByAccount = new Map<string, Array<{ dueDate: Date | null; createdAt: Date }>>();
  for (const item of work) {
    if (!item.wholesaleAccountId) continue;
    const current = workByAccount.get(item.wholesaleAccountId) ?? [];
    current.push({ dueDate: item.dueDate, createdAt: item.createdAt });
    workByAccount.set(item.wholesaleAccountId, current);
  }
  const coverageDeficits = territoryCoverageDeficits(accounts.filter((account) => !isOutsideOhio(account.state)));
  const queue = accounts
    .filter((account) => !shouldDeferResearchRetry(account, now))
    .map((account) => classifyResearchNeed({
      ...account,
      isTargeting: targetedIds.includes(account.id),
      upcomingWork: workByAccount.get(account.id) ?? [],
    }, now))
    .filter((item): item is ResearchQueueItem => Boolean(item))
    .sort((left, right) => {
      const leftCoverageDeficit = isOutsideOhio(left.state) ? 0 : coverageDeficits.get(opportunityTerritoryForCounty(left.county)) ?? 0;
      const rightCoverageDeficit = isOutsideOhio(right.state) ? 0 : coverageDeficits.get(opportunityTerritoryForCounty(right.county)) ?? 0;
      const leftRefresh = left.targetPublicResearch?.lastRefreshedAt?.getTime() ?? 0;
      const rightRefresh = right.targetPublicResearch?.lastRefreshedAt?.getTime() ?? 0;
      const leftIsRetry = left.accountResearchJobs?.length ? 1 : 0;
      const rightIsRetry = right.accountResearchJobs?.length ? 1 : 0;
      const leftScore = Math.max(0, ...left.opportunities.map((item) => item.productionScore));
      const rightScore = Math.max(0, ...right.opportunities.map((item) => item.productionScore));
      return left.priorityBucket - right.priorityBucket
        || leftIsRetry - rightIsRetry
        || rightCoverageDeficit - leftCoverageDeficit
        || leftRefresh - rightRefresh
        || rightScore - leftScore
        || left.name.localeCompare(right.name);
    });
  return limit === null ? queue : queue.slice(0, Math.max(0, limit));
}
