import { OpportunityStatus, Prisma, type PrismaClient } from '@prisma/client';
import Papa from 'papaparse';
import { evaluateOpportunityIntelligence } from './opportunityEngine';
import { prisma } from './prisma';

const DAY = 86_400_000;
export const PURSUED_RESEARCH_DAYS = 30;
export const STANDARD_RESEARCH_DAYS = 90;
export const DEFAULT_RESEARCH_EXPORT_LIMIT = 50;
export const MAX_RESEARCH_EXPORT_LIMIT = 250;
const activeStatuses = [OpportunityStatus.OPEN, OpportunityStatus.ACTIONED, OpportunityStatus.SNOOZED];

export const ACCOUNT_RESEARCH_HEADERS = [
  'wholesale_account_id', 'licensee_id', 'account_name', 'address', 'city', 'state', 'zip', 'researched_at',
  'website_url', 'cocktail_menu_url', 'local_brands_on_menu', 'patio_outdoor', 'cocktail_program', 'events',
  'popularity_signal', 'open_status', 'google_rating', 'google_review_count', 'yelp_rating', 'yelp_review_count',
  'is_national_chain', 'ownership_verification', 'buyer_structure', 'notes', 'confidence', 'source_urls',
] as const;

type AccountResearchHeader = (typeof ACCOUNT_RESEARCH_HEADERS)[number];
type RawResearchRow = Record<AccountResearchHeader, string>;
type CsvParseResult<T> = { data: T[]; errors: Array<{ message: string; row?: number }>; meta: { fields?: string[] } };

type ResearchCandidate = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  licenseeId: string;
  targetProfile: { currentRank: number | null; currentScore: Prisma.Decimal | null } | null;
  targetPublicResearch: { lastRefreshedAt: Date | null } | null;
  opportunities: Array<{ status: OpportunityStatus }>;
};

export type ParsedAccountResearchRow = {
  rowNumber: number;
  wholesaleAccountId: string;
  licenseeId: string;
  accountName: string;
  researchedAt: Date;
  websiteUrl: string | null;
  cocktailMenuUrl: string | null;
  localBrandsOnMenu: string[];
  patioOutdoor: 'Strong' | 'Yes' | 'No' | 'Unknown';
  cocktailProgram: 'Strong' | 'Moderate' | 'Limited' | 'None' | 'Unknown';
  events: string | null;
  popularitySignal: 'High' | 'Medium' | 'Low' | 'Unknown';
  openStatus: 'Open' | 'Closed' | 'Unclear';
  googleRating: number | null;
  googleReviewCount: number | null;
  yelpRating: number | null;
  yelpReviewCount: number | null;
  isNationalChain: boolean | null;
  ownershipVerification: string | null;
  buyerStructure: string | null;
  notes: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  sourceUrls: string[];
};

export type AccountResearchValidationError = { rowNumber: number; message: string };

const clean = (value: unknown) => {
  const normalized = String(value ?? '').trim();
  return normalized || null;
};
const normalizedIdentity = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const parseList = (value: string | null) => [...new Set((value ?? '').split('|').map((item) => item.trim()).filter(Boolean))];

const parseUrl = (value: string | null, field: string, rowNumber: number, errors: AccountResearchValidationError[]) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported protocol');
    return url.toString();
  } catch {
    errors.push({ rowNumber, message: `${field} must be a valid http(s) URL.` });
    return null;
  }
};

const parseEnum = <T extends string>(value: string | null, allowed: readonly T[], field: string, rowNumber: number, errors: AccountResearchValidationError[]): T | null => {
  const match = allowed.find((item) => item.toLowerCase() === value?.toLowerCase());
  if (match) return match;
  errors.push({ rowNumber, message: `${field} must be one of: ${allowed.join(', ')}.` });
  return null;
};

const parseNumber = (value: string | null, field: string, rowNumber: number, errors: AccountResearchValidationError[], { integer = false, max }: { integer?: boolean; max?: number } = {}) => {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ''));
  if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isInteger(parsed)) || (max !== undefined && parsed > max)) {
    errors.push({ rowNumber, message: `${field} must be ${integer ? 'a non-negative whole number' : `between 0 and ${max}`}.` });
    return null;
  }
  return parsed;
};

const parseBoolean = (value: string | null, rowNumber: number, errors: AccountResearchValidationError[]) => {
  if (!value || value.toLowerCase() === 'unknown') return null;
  if (['true', 'yes'].includes(value.toLowerCase())) return true;
  if (['false', 'no'].includes(value.toLowerCase())) return false;
  errors.push({ rowNumber, message: 'is_national_chain must be true, false, or unknown.' });
  return null;
};

const parseResearchDate = (value: string | null, rowNumber: number, errors: AccountResearchValidationError[]) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    errors.push({ rowNumber, message: 'researched_at must use YYYY-MM-DD.' });
    return new Date(0);
  }
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    errors.push({ rowNumber, message: 'researched_at is not a valid calendar date.' });
    return new Date(0);
  }
  if (parsed.getTime() > Date.now() + DAY) errors.push({ rowNumber, message: 'researched_at cannot be in the future.' });
  return parsed;
};

export const getResearchPriority = (candidate: Pick<ResearchCandidate, 'opportunities' | 'targetProfile' | 'targetPublicResearch' | 'name'>) => {
  const statuses = new Set(candidate.opportunities.map((item) => item.status));
  const workflowPriority = statuses.has(OpportunityStatus.ACTIONED) ? 0 : statuses.has(OpportunityStatus.OPEN) || statuses.has(OpportunityStatus.SNOOZED) ? 1 : 2;
  const refreshedAt = candidate.targetPublicResearch?.lastRefreshedAt?.getTime() ?? 0;
  const refreshInterval = statuses.has(OpportunityStatus.ACTIONED) ? PURSUED_RESEARCH_DAYS : STANDARD_RESEARCH_DAYS;
  return {
    workflowPriority,
    targetRank: candidate.targetProfile?.currentRank ?? Number.MAX_SAFE_INTEGER,
    targetScore: Number(candidate.targetProfile?.currentScore ?? 0),
    dueAt: refreshedAt === 0 ? 0 : refreshedAt + refreshInterval * DAY,
    name: candidate.name,
  };
};

export const compareResearchCandidates = (
  left: Pick<ResearchCandidate, 'opportunities' | 'targetProfile' | 'targetPublicResearch' | 'name'>,
  right: Pick<ResearchCandidate, 'opportunities' | 'targetProfile' | 'targetPublicResearch' | 'name'>,
) => {
  const a = getResearchPriority(left);
  const b = getResearchPriority(right);
  return a.dueAt - b.dueAt || a.workflowPriority - b.workflowPriority || a.targetRank - b.targetRank || b.targetScore - a.targetScore || a.name.localeCompare(b.name);
};

export const normalizeResearchExportLimit = (value: string | number | null | undefined): number => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(MAX_RESEARCH_EXPORT_LIMIT, parsed)) : DEFAULT_RESEARCH_EXPORT_LIMIT;
};

export async function getAccountResearchQueue({ db = prisma, now = new Date(), limit = DEFAULT_RESEARCH_EXPORT_LIMIT, includeFresh = false }: { db?: PrismaClient; now?: Date; limit?: number | null; includeFresh?: boolean } = {}) {
  const pursuedCutoff = new Date(now.getTime() - PURSUED_RESEARCH_DAYS * DAY);
  const standardCutoff = new Date(now.getTime() - STANDARD_RESEARCH_DAYS * DAY);
  const candidates = await db.wholesaleAccount.findMany({
    where: {
      isActive: true,
      mergedIntoId: null,
      OR: [{ targetProfile: { isNot: null } }, { opportunities: { some: { status: { in: activeStatuses } } } }],
      ...(!includeFresh ? { AND: [{ OR: [
        { targetPublicResearch: { is: null } },
        { targetPublicResearch: { is: { lastRefreshedAt: null } } },
        { AND: [
          { opportunities: { some: { status: OpportunityStatus.ACTIONED } } },
          { targetPublicResearch: { is: { lastRefreshedAt: { lt: pursuedCutoff } } } },
        ] },
        { AND: [
          { opportunities: { none: { status: OpportunityStatus.ACTIONED } } },
          { targetPublicResearch: { is: { lastRefreshedAt: { lt: standardCutoff } } } },
        ] },
      ] }] } : {}),
    },
    select: {
      id: true, name: true, address: true, city: true, state: true, zip: true, licenseeId: true,
      targetProfile: { select: { currentRank: true, currentScore: true } },
      targetPublicResearch: { select: { lastRefreshedAt: true } },
      opportunities: { where: { status: { in: activeStatuses } }, select: { status: true } },
    },
  });
  candidates.sort(compareResearchCandidates);
  return limit === null ? candidates : candidates.slice(0, normalizeResearchExportLimit(limit));
}

export function createAccountResearchCsv(candidates: ResearchCandidate[]) {
  const rows = candidates.map((candidate) => ({
    wholesale_account_id: candidate.id, licensee_id: candidate.licenseeId, account_name: candidate.name,
    address: candidate.address ?? '', city: candidate.city ?? '', state: candidate.state ?? '', zip: candidate.zip ?? '',
    researched_at: '', website_url: '', cocktail_menu_url: '', local_brands_on_menu: '', patio_outdoor: '',
    cocktail_program: '', events: '', popularity_signal: '', open_status: '', google_rating: '', google_review_count: '',
    yelp_rating: '', yelp_review_count: '', is_national_chain: '', ownership_verification: '', buyer_structure: '',
    notes: '', confidence: '', source_urls: '',
  }));
  return Papa.unparse({ fields: [...ACCOUNT_RESEARCH_HEADERS], data: rows });
}

export function parseAccountResearchCsv(csv: string | Buffer) {
  const parsed = Papa.parse(csv.toString('utf8'), {
    header: true, skipEmptyLines: true,
    transformHeader: (header: string) => header.trim().replace(/^\uFEFF/, '').toLowerCase(),
  }) as CsvParseResult<RawResearchRow>;
  const errors: AccountResearchValidationError[] = parsed.errors.map((error) => ({ rowNumber: (error.row ?? 0) + 2, message: error.message }));
  const headers = new Set(parsed.meta.fields ?? []);
  const missingHeaders = ACCOUNT_RESEARCH_HEADERS.filter((header) => !headers.has(header));
  if (missingHeaders.length > 0) throw new Error(`Research CSV is missing required header(s): ${missingHeaders.join(', ')}`);
  if (parsed.data.length === 0) throw new Error('Research CSV contains no account rows.');

  const seenIds = new Set<string>();
  const rows: ParsedAccountResearchRow[] = [];
  parsed.data.forEach((raw, index) => {
    const rowNumber = index + 2;
    const wholesaleAccountId = clean(raw.wholesale_account_id) ?? '';
    const licenseeId = clean(raw.licensee_id) ?? '';
    const accountName = clean(raw.account_name) ?? '';
    if (!wholesaleAccountId) errors.push({ rowNumber, message: 'wholesale_account_id is required.' });
    if (!licenseeId) errors.push({ rowNumber, message: 'licensee_id is required.' });
    if (!accountName) errors.push({ rowNumber, message: 'account_name is required.' });
    if (seenIds.has(wholesaleAccountId)) errors.push({ rowNumber, message: 'Duplicate wholesale_account_id in this file.' });
    seenIds.add(wholesaleAccountId);
    const sourceUrls = parseList(clean(raw.source_urls)).map((url) => parseUrl(url, 'source_urls', rowNumber, errors)).filter((url): url is string => Boolean(url));
    if (sourceUrls.length === 0) errors.push({ rowNumber, message: 'At least one source URL is required.' });
    const notes = clean(raw.notes) ?? '';
    if (!notes) errors.push({ rowNumber, message: 'notes is required; use a concise evidence or uncertainty summary.' });
    const patioOutdoor = parseEnum(clean(raw.patio_outdoor), ['Strong', 'Yes', 'No', 'Unknown'] as const, 'patio_outdoor', rowNumber, errors) ?? 'Unknown';
    const cocktailProgram = parseEnum(clean(raw.cocktail_program), ['Strong', 'Moderate', 'Limited', 'None', 'Unknown'] as const, 'cocktail_program', rowNumber, errors) ?? 'Unknown';
    const popularitySignal = parseEnum(clean(raw.popularity_signal), ['High', 'Medium', 'Low', 'Unknown'] as const, 'popularity_signal', rowNumber, errors) ?? 'Unknown';
    const openStatus = parseEnum(clean(raw.open_status), ['Open', 'Closed', 'Unclear'] as const, 'open_status', rowNumber, errors) ?? 'Unclear';
    const confidence = parseEnum(clean(raw.confidence), ['HIGH', 'MEDIUM', 'LOW'] as const, 'confidence', rowNumber, errors) ?? 'LOW';
    rows.push({
      rowNumber, wholesaleAccountId, licenseeId, accountName,
      researchedAt: parseResearchDate(clean(raw.researched_at), rowNumber, errors),
      websiteUrl: parseUrl(clean(raw.website_url), 'website_url', rowNumber, errors),
      cocktailMenuUrl: parseUrl(clean(raw.cocktail_menu_url), 'cocktail_menu_url', rowNumber, errors),
      localBrandsOnMenu: parseList(clean(raw.local_brands_on_menu)), patioOutdoor, cocktailProgram,
      events: clean(raw.events), popularitySignal, openStatus,
      googleRating: parseNumber(clean(raw.google_rating), 'google_rating', rowNumber, errors, { max: 5 }),
      googleReviewCount: parseNumber(clean(raw.google_review_count), 'google_review_count', rowNumber, errors, { integer: true }),
      yelpRating: parseNumber(clean(raw.yelp_rating), 'yelp_rating', rowNumber, errors, { max: 5 }),
      yelpReviewCount: parseNumber(clean(raw.yelp_review_count), 'yelp_review_count', rowNumber, errors, { integer: true }),
      isNationalChain: parseBoolean(clean(raw.is_national_chain), rowNumber, errors),
      ownershipVerification: clean(raw.ownership_verification), buyerStructure: clean(raw.buyer_structure), notes, confidence, sourceUrls,
    });
  });
  return { rows, errors };
}

export async function validateAccountResearchRows({ rows, db = prisma }: { rows: ParsedAccountResearchRow[]; db?: PrismaClient }) {
  const errors: AccountResearchValidationError[] = [];
  const accounts = await db.wholesaleAccount.findMany({
    where: { id: { in: rows.map((row) => row.wholesaleAccountId) } },
    select: { id: true, name: true, licenseeId: true, isActive: true, mergedIntoId: true, licenseeIds: { select: { licenseeId: true } } },
  });
  const byId = new Map(accounts.map((account) => [account.id, account]));
  for (const row of rows) {
    const account = byId.get(row.wholesaleAccountId);
    if (!account) {
      errors.push({ rowNumber: row.rowNumber, message: 'wholesale_account_id does not match a CRM account.' });
      continue;
    }
    if (!account.isActive || account.mergedIntoId) errors.push({ rowNumber: row.rowNumber, message: 'Account is inactive or has been merged.' });
    const licenseeIds = new Set([account.licenseeId, ...account.licenseeIds.map((item) => item.licenseeId)].map((value) => value.toUpperCase()));
    if (!licenseeIds.has(row.licenseeId.toUpperCase())) errors.push({ rowNumber: row.rowNumber, message: 'licensee_id does not belong to this CRM account.' });
    if (normalizedIdentity(account.name) !== normalizedIdentity(row.accountName)) errors.push({ rowNumber: row.rowNumber, message: `account_name does not match CRM name "${account.name}".` });
  }
  return errors;
}

export async function importAccountResearchCsv({ csv, db = prisma, dryRun = true, importedBy }: { csv: string | Buffer; db?: PrismaClient; dryRun?: boolean; importedBy: string }) {
  const parsed = parseAccountResearchCsv(csv);
  const identityErrors = await validateAccountResearchRows({ rows: parsed.rows, db });
  const errors = [...parsed.errors, ...identityErrors].sort((a, b) => a.rowNumber - b.rowNumber);
  if (errors.length > 0 || dryRun) return { parsedRows: parsed.rows.length, importedRows: 0, errors, dryRun };

  const scoredAt = new Date();
  await db.$transaction(async (tx) => {
    for (const row of parsed.rows) {
      const data = {
        researchStatus: 'Researched via ChatGPT CSV', patioOutdoor: row.patioOutdoor, cocktailProgram: row.cocktailProgram,
        events: row.events, popularitySignal: row.popularitySignal, openStatus: row.openStatus,
        ownershipVerification: row.ownershipVerification, buyerStructure: row.buyerStructure,
        websiteUrl: row.websiteUrl, cocktailMenuUrl: row.cocktailMenuUrl, localBrandsOnMenu: row.localBrandsOnMenu,
        googleRating: row.googleRating, googleReviewCount: row.googleReviewCount, yelpRating: row.yelpRating, yelpReviewCount: row.yelpReviewCount,
        isNationalChain: row.isNationalChain, researchConfidence: row.confidence, notes: row.notes, sourceUrls: row.sourceUrls,
        completedAt: row.researchedAt, researcher: `ChatGPT CSV imported by ${importedBy}`,
        lastAttemptedAt: row.researchedAt, lastRefreshedAt: row.researchedAt, refreshStatus: 'COMPLETE', refreshError: null,
        researchModel: 'ChatGPT subscription research', researchResponseId: null,
      } satisfies Prisma.TargetPublicResearchUncheckedUpdateInput;
      await tx.targetPublicResearch.upsert({
        where: { wholesaleAccountId: row.wholesaleAccountId },
        create: { wholesaleAccountId: row.wholesaleAccountId, ...data }, update: data,
      });
    }
    await evaluateOpportunityIntelligence({
      db: tx as unknown as PrismaClient,
      asOfDate: scoredAt,
      accountIds: parsed.rows.map((row) => row.wholesaleAccountId),
    });
  }, { timeout: 180_000 });
  return { parsedRows: parsed.rows.length, importedRows: parsed.rows.length, errors: [], dryRun: false };
}
