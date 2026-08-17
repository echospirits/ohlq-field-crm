import assert from 'node:assert/strict';
import { it } from 'node:test';
import { OpportunityStatus, Prisma, type PrismaClient } from '@prisma/client';
import {
  ACCOUNT_RESEARCH_HEADERS,
  compareResearchCandidates,
  createAccountResearchCsv,
  normalizeResearchExportLimit,
  parseAccountResearchCsv,
  validateAccountResearchRows,
} from '../lib/accountResearch';

const candidate = ({ name, status, rank, refreshedAt }: { name: string; status?: OpportunityStatus; rank?: number; refreshedAt?: Date }) => ({
  name,
  opportunities: status ? [{ status }] : [],
  targetProfile: { currentRank: rank ?? null, currentScore: new Prisma.Decimal(50) },
  targetPublicResearch: refreshedAt ? { lastRefreshedAt: refreshedAt } : null,
});

const researchRow = (overrides: Record<string, string> = {}) => ({
  wholesale_account_id: 'acct_1', licensee_id: 'LIC-1', account_name: 'Example Bar', address: '1 Main St',
  city: 'Columbus', state: 'OH', zip: '43215', researched_at: '2026-08-16', website_url: 'https://example.com',
  cocktail_menu_url: 'https://example.com/menu', local_brands_on_menu: 'Watershed|Echo Spirits', patio_outdoor: 'Yes',
  cocktail_program: 'Strong', events: 'Private events', popularity_signal: 'High', open_status: 'Open', google_rating: '4.7',
  google_review_count: '1200', yelp_rating: '4.5', yelp_review_count: '300', is_national_chain: 'false',
  ownership_verification: 'Independent', buyer_structure: 'Local beverage buyer', notes: 'Exact address matched.',
  confidence: 'HIGH', source_urls: 'https://example.com|https://example.com/menu', ...overrides,
});

const toCsv = (row: Record<string, string>) => {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return `${ACCOUNT_RESEARCH_HEADERS.join(',')}\n${ACCOUNT_RESEARCH_HEADERS.map((header) => escape(row[header] ?? '')).join(',')}`;
};

it('bounds account research export size', () => {
  assert.equal(normalizeResearchExportLimit(undefined), 50);
  assert.equal(normalizeResearchExportLimit('0'), 1);
  assert.equal(normalizeResearchExportLimit('999'), 250);
});

it('prioritizes pursued accounts, then open opportunities, then target rank', () => {
  const candidates = [
    candidate({ name: 'Rank one', rank: 1 }),
    candidate({ name: 'Open', status: OpportunityStatus.OPEN, rank: 100 }),
    candidate({ name: 'Pursued', status: OpportunityStatus.ACTIONED, rank: 500 }),
  ].sort(compareResearchCandidates);
  assert.deepEqual(candidates.map((item) => item.name), ['Pursued', 'Open', 'Rank one']);
});

it('creates a research CSV with immutable account identity and blank output fields', () => {
  const csv = createAccountResearchCsv([{
    id: 'acct_1', name: 'Example Bar', licenseeId: 'LIC-1', address: '1 Main St', city: 'Columbus', state: 'OH', zip: '43215',
    targetProfile: null, targetPublicResearch: null, opportunities: [],
  }]);
  assert.match(csv, /wholesale_account_id,licensee_id,account_name/);
  assert.match(csv, /acct_1,LIC-1,Example Bar/);
});

it('parses validated research fields, lists, ratings, and citations', () => {
  const result = parseAccountResearchCsv(toCsv(researchRow()));
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].googleRating, 4.7);
  assert.equal(result.rows[0].isNationalChain, false);
  assert.deepEqual(result.rows[0].localBrandsOnMenu, ['Watershed', 'Echo Spirits']);
  assert.deepEqual(result.rows[0].sourceUrls, ['https://example.com/', 'https://example.com/menu']);
});

it('blocks invalid enums, missing citations, and duplicate account IDs', () => {
  const first = researchRow({ patio_outdoor: 'Maybe', source_urls: '' });
  const second = researchRow();
  const csv = `${toCsv(first)}\n${ACCOUNT_RESEARCH_HEADERS.map((header) => `"${second[header] ?? ''}"`).join(',')}`;
  const result = parseAccountResearchCsv(csv);
  assert.ok(result.errors.some((error) => error.message.includes('patio_outdoor')));
  assert.ok(result.errors.some((error) => error.message.includes('source URL')));
  assert.ok(result.errors.some((error) => error.message.includes('Duplicate')));
});

it('verifies CRM account name and Licensee ID before import', async () => {
  const parsed = parseAccountResearchCsv(toCsv(researchRow()));
  const db = {
    wholesaleAccount: {
      findMany: async () => [{ id: 'acct_1', name: 'Example Bar', licenseeId: 'LIC-1', isActive: true, mergedIntoId: null, licenseeIds: [] }],
    },
  } as unknown as PrismaClient;
  assert.deepEqual(await validateAccountResearchRows({ rows: parsed.rows, db }), []);
  const mismatched = parseAccountResearchCsv(toCsv(researchRow({ licensee_id: 'WRONG' })));
  assert.ok((await validateAccountResearchRows({ rows: mismatched.rows, db })).some((error) => error.message.includes('licensee_id')));
});
