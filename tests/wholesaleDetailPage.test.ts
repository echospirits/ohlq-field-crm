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

test('Wholesale account overview opens by default and displays source-attributed business hours', () => {
  const page = readFileSync('app/wholesale/[id]/page.tsx', 'utf8');
  assert.match(page, /id="overview" initialOpen summary="Account details, visit totals & tags"/);
  assert.match(page, /readBusinessHours\(account\.targetPublicResearch\?\.identitySnapshot\)/);
  assert.match(page, />Current hours</);
  assert.match(page, /Source:/);
  assert.match(page, /Not yet confirmed from a current public source/);
});

test('Wholesale intelligence reads tenant-scoped current assessments and keeps pursuit scores historical', () => {
  const panel = readFileSync('app/wholesale/OpportunityAccountPanel.tsx', 'utf8');
  assert.match(panel, /wholesaleAccountAssessment.findUnique/);
  assert.match(panel, /organizationId_wholesaleAccountId: \{ organizationId, wholesaleAccountId \}/);
  assert.match(panel, /WholesaleAssessmentSummary value=\{currentAssessment\?\.assessment\}/);
  assert.doesNotMatch(panel, /productionScore=\{item\.productionScore\}/);
  assert.match(panel, /Existing pursuit:/);
});

test('Wholesale opportunity intelligence shows public research signals and freshness', () => {
  const panel = readFileSync('app/wholesale/OpportunityAccountPanel.tsx', 'utf8');

  assert.match(panel, /prisma\.targetPublicResearch\.findUnique/);
  assert.match(panel, /Public account research/);
  assert.match(panel, /Public rating/);
  assert.match(panel, /Source:/);
  assert.match(panel, /Patio/);
  assert.match(panel, /Cocktails/);
  assert.match(panel, /Last researched \{research\.lastRefreshedAt \? formatEasternDateTime\(research\.lastRefreshedAt\)/);
});
