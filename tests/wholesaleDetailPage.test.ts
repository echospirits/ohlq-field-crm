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
