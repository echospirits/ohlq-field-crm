import { AccountResearchJobStatus, OpportunityStatus, WorklistStatus, type PrismaClient } from '@prisma/client';
import { ACCOUNT_RESEARCH_MINIMUM_BOTTLES_30 } from './accountResearchPilot';
import type { AccountResearchResult } from './accountResearchPilot';
import { opportunityTerritoryForCounty, territoryCoverageDeficits } from './opportunityTerritories';
import { prisma } from './prisma';

const DAY = 86_400_000;
const ACTIVE_RESEARCH_JOB_STATUSES = [
  AccountResearchJobStatus.QUEUED,
  AccountResearchJobStatus.SUBMITTED,
  AccountResearchJobStatus.RUNNING,
  AccountResearchJobStatus.NEEDS_REVIEW,
];

export type ResearchIdentitySnapshot = {
  accountName: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  publicRatings?: AccountResearchResult['publicRatings'];
  businessHours?: AccountResearchResult['businessHours'];
  researchEvidence?: AccountResearchResult['evidence'];
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
  targetPublicResearch: { lastRefreshedAt: Date | null; identitySnapshot: unknown } | null;
  opportunities: Array<{ productionScore: number; status: OpportunityStatus; actionedAt: Date | null; lastDetectedAt: Date }>;
  upcomingWork: Array<{ dueDate: Date | null; createdAt: Date }>;
  bottles30: number;
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
  research?: Pick<AccountResearchResult, 'publicRatings' | 'businessHours' | 'evidence'>,
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

export const hasResearchIdentityChanged = (
  candidate: Pick<ResearchQueueCandidate, 'name' | 'address' | 'city' | 'state' | 'zip'>,
  snapshot: unknown,
) => {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return false;
  const prior = snapshot as Partial<ResearchIdentitySnapshot>;
  return normalized(candidate.name) !== normalized(prior.accountName)
    || normalized(candidate.address) !== normalized(prior.address)
    || normalized(candidate.city) !== normalized(prior.city)
    || normalized(candidate.state) !== normalized(prior.state)
    || normalized(candidate.zip) !== normalized(prior.zip);
};

export function classifyResearchNeed(candidate: ResearchQueueCandidate, now = new Date()): ResearchQueueItem | null {
  const refreshedAt = candidate.targetPublicResearch?.lastRefreshedAt ?? null;
  const stale30 = isOlderThan(refreshedAt, ageCutoff(now, 30));
  const recentPursuit = candidate.opportunities.some((item) => item.status === OpportunityStatus.ACTIONED && item.actionedAt && item.actionedAt >= ageCutoff(now, 1));
  const recentTenantActivity = candidate.opportunities.some((item) => item.actionedAt && item.actionedAt >= ageCutoff(now, 7));
  const nextTwoDays = new Date(now.getTime() + 2 * DAY);
  const nextSevenDays = new Date(now.getTime() + 7 * DAY);
  const upcomingTwoDayWork = candidate.upcomingWork.some((item) => item.dueDate && item.dueDate >= now && item.dueDate <= nextTwoDays);
  const otherUpcomingWork = candidate.upcomingWork.some((item) => (item.dueDate && item.dueDate >= now && item.dueDate <= nextSevenDays) || (!item.dueDate && item.createdAt >= ageCutoff(now, 1)));

  // Tenant actions are an explicit commercial signal and override the volume gate.
  // Identity changes, missing scores, and routine staleness alone do not justify
  // public research for accounts with very little recent wholesale activity.
  const tenantActionOverride = stale30 && (recentPursuit || upcomingTwoDayWork || otherUpcomingWork || recentTenantActivity);
  if (candidate.bottles30 < ACCOUNT_RESEARCH_MINIMUM_BOTTLES_30 && !tenantActionOverride) return null;

  if (candidate.opportunities.length === 0 && !refreshedAt) return { ...candidate, priorityBucket: 1, researchReason: 'New account without an opportunity score or research' };
  if (hasResearchIdentityChanged(candidate, candidate.targetPublicResearch?.identitySnapshot)) return { ...candidate, priorityBucket: 2, researchReason: 'Account name or address changed since research' };
  if (stale30 && recentPursuit) return { ...candidate, priorityBucket: 3, researchReason: 'Pursued by a tenant in the last day; research is over 30 days old' };
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
  const accounts = await db.wholesaleAccount.findMany({
    where: {
      isActive: true,
      mergedIntoId: null,
      address: { not: null },
      city: { not: null },
      zip: { not: null },
      accountResearchJobs: { none: { status: { in: ACTIVE_RESEARCH_JOB_STATUSES } } },
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
    },
  });
  if (accounts.length === 0) return [];
  const salesWindowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 29 * DAY);
  const [work, sales] = await Promise.all([db.worklistItem.findMany({
    where: {
      wholesaleAccountId: { in: accounts.map((item) => item.id) },
      status: { in: [WorklistStatus.OPEN, WorklistStatus.IN_PROGRESS] },
      OR: [{ dueDate: { lte: new Date(now.getTime() + 7 * DAY) } }, { dueDate: null, createdAt: { gte: ageCutoff(now, 1) } }],
    },
    select: { wholesaleAccountId: true, dueDate: true, createdAt: true },
  }), db.accountSalesEvent.groupBy({
    by: ['organizationId', 'wholesaleAccountId'],
    where: {
      wholesaleAccountId: { in: accounts.map((item) => item.id) },
      reportDate: { gte: salesWindowStart },
    },
    _sum: { bottles: true },
  })]);
  const workByAccount = new Map<string, Array<{ dueDate: Date | null; createdAt: Date }>>();
  for (const item of work) {
    if (!item.wholesaleAccountId) continue;
    const current = workByAccount.get(item.wholesaleAccountId) ?? [];
    current.push({ dueDate: item.dueDate, createdAt: item.createdAt });
    workByAccount.set(item.wholesaleAccountId, current);
  }
  // Sales ledgers are tenant-scoped copies of the same OHLQ market activity.
  // Taking the largest tenant total avoids multiplying volume by tenant count.
  const bottlesByAccount = new Map<string, number>();
  for (const item of sales) {
    bottlesByAccount.set(
      item.wholesaleAccountId,
      Math.max(bottlesByAccount.get(item.wholesaleAccountId) ?? 0, item._sum.bottles ?? 0),
    );
  }
  const coverageDeficits = territoryCoverageDeficits(accounts);
  const queue = accounts
    .map((account) => classifyResearchNeed({
      ...account,
      upcomingWork: workByAccount.get(account.id) ?? [],
      bottles30: bottlesByAccount.get(account.id) ?? 0,
    }, now))
    .filter((item): item is ResearchQueueItem => Boolean(item))
    .sort((left, right) => {
      const leftCoverageDeficit = coverageDeficits.get(opportunityTerritoryForCounty(left.county)) ?? 0;
      const rightCoverageDeficit = coverageDeficits.get(opportunityTerritoryForCounty(right.county)) ?? 0;
      const leftRefresh = left.targetPublicResearch?.lastRefreshedAt?.getTime() ?? 0;
      const rightRefresh = right.targetPublicResearch?.lastRefreshedAt?.getTime() ?? 0;
      const leftScore = Math.max(0, ...left.opportunities.map((item) => item.productionScore));
      const rightScore = Math.max(0, ...right.opportunities.map((item) => item.productionScore));
      return left.priorityBucket - right.priorityBucket
        || rightCoverageDeficit - leftCoverageDeficit
        || leftRefresh - rightRefresh
        || rightScore - leftScore
        || left.name.localeCompare(right.name);
    });
  return limit === null ? queue : queue.slice(0, Math.max(0, limit));
}
