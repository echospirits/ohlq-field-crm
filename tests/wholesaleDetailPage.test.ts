import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Wholesale Agency ID links to the matching Agency account when one exists', () => {
  const page = readFileSync('app/wholesale/[id]/page.tsx', 'utf8');

  assert.match(page, /prisma\.agency\.findFirst/);
  assert.match(page, /agencyId: \{ equals: account\.agencyId, mode: 'insensitive' \}/);
  assert.match(page, /linkedAgency \? <Link href=\{`\/agencies\/\$\{linkedAgency\.id\}`\}>/);
});

test('Wholesale activity timeline loads only the viewing tenant portfolio purchases', () => {
  const panel = readFileSync('app/wholesale/OpportunityAccountPanel.tsx', 'utf8');

  assert.match(panel, /getOrganizationTenantConfig\(organizationId\)/);
  assert.match(panel, /where: \{ organizationId, wholesaleAccountId, \.\.\.getTenantAccountSalesEventWhere\(tenantConfig\) \}/);
});

test('Wholesale opportunity intelligence shows the tenant-scoped production score', () => {
  const panel = readFileSync('app/wholesale/OpportunityAccountPanel.tsx', 'utf8');

  assert.match(panel, /\{ organizationId, wholesaleAccountId, status: \{ in: activeStatuses \} \}/);
  assert.match(panel, /productionScore=\{item\.productionScore\}/);
  assert.match(panel, /Opportunity score \$\{Math\.round\(productionScore\)\} out of 100/);
  assert.match(panel, /How this score was calculated/);
  assert.match(panel, /This score is calculated for your organization/);
  assert.match(panel, /parseOpportunityScoreComponents\(factors\)/);
  assert.match(panel, /scores: \{ orderBy: \{ scoredAt: 'desc' \}/);
  assert.match(panel, /Point-by-point values were not stored with this earlier score/);
});

test('Wholesale opportunity intelligence shows public research signals and freshness', () => {
  const panel = readFileSync('app/wholesale/OpportunityAccountPanel.tsx', 'utf8');

  assert.match(panel, /prisma\.targetPublicResearch\.findUnique/);
  assert.match(panel, /Public account research/);
  assert.match(panel, /Google/);
  assert.match(panel, /Yelp/);
  assert.match(panel, /Patio/);
  assert.match(panel, /Cocktails/);
  assert.match(panel, /Updated \{formatEasternDateTime\(research\.updatedAt\)\}/);
});
