import { AccountResearchJobStatus } from '@prisma/client';

export const ACCOUNT_RESEARCH_ACTIONABLE_REVIEW_PREFIX = 'Automatically declined: exact-location validation failed.';
export const ACCOUNT_RESEARCH_CITY_RETRY_PREFIX = 'City correction applied; research retry requested.';
export const ACCOUNT_RESEARCH_RECONCILIATION_PREFIX = 'Provider response requires reconciliation:';

type ResearchAttempt = {
  status: AccountResearchJobStatus;
  error?: string | null;
  reviewNote?: string | null;
};

export function isActionableAccountResearchFailure(attempt: ResearchAttempt) {
  return attempt.status === AccountResearchJobStatus.REJECTED
    && Boolean(attempt.reviewNote?.startsWith(ACCOUNT_RESEARCH_ACTIONABLE_REVIEW_PREFIX));
}

export function isUnsuccessfulAccountResearchAttempt(attempt: ResearchAttempt) {
  return attempt.status === AccountResearchJobStatus.FAILED
    || attempt.status === AccountResearchJobStatus.BLOCKED_BUDGET;
}

export function accountResearchFailureReason(attempt: ResearchAttempt) {
  const detail = attempt.reviewNote?.startsWith(ACCOUNT_RESEARCH_ACTIONABLE_REVIEW_PREFIX)
    ? attempt.reviewNote.slice(ACCOUNT_RESEARCH_ACTIONABLE_REVIEW_PREFIX.length).trim()
    : attempt.reviewNote || attempt.error;
  return detail || 'The public sources could not be matched confidently to this exact account location.';
}
