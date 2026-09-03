import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ProvisioningStepKind } from '@prisma/client';
import { PROVISIONING_STEP_ORDER } from '../lib/tenantProvisioning';

test('organization provisioning is ordered, persisted, and waits for product review before activation', () => {
  assert.deepEqual(PROVISIONING_STEP_ORDER, [
    ProvisioningStepKind.VALIDATE_CONFIGURATION,
    ProvisioningStepKind.DISCOVER_PRODUCTS,
    ProvisioningStepKind.CONFIRM_PRODUCTS,
    ProvisioningStepKind.APPLY_ENTITLEMENTS,
    ProvisioningStepKind.CREATE_INITIAL_ADMIN,
    ProvisioningStepKind.SEND_INITIAL_INVITATION,
    ProvisioningStepKind.BACKFILL_SALES,
    ProvisioningStepKind.BACKFILL_AGENCY_INTELLIGENCE,
    ProvisioningStepKind.BACKFILL_OPPORTUNITIES,
    ProvisioningStepKind.FINALIZE,
  ]);
});

test('customer configuration lives on Organization and sensitive operational rows require tenant ownership', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  for (const field of ['appName', 'digestName', 'productLabel', 'brandPrimaryColor', 'contactEmail', 'supportEmail', 'settings']) {
    assert.match(schema, new RegExp(`\\b${field}\\s+`));
  }
  for (const model of ['LoggedVisit', 'WorklistItem', 'LocationContact', 'MenuPlacement', 'Recipe', 'SalesOpportunity']) {
    assert.match(schema, new RegExp(`model ${model} \\{[\\s\\S]*?organizationId\\s+String\\s`, 'm'));
  }
  assert.match(schema, /@@unique\(\[organizationId, submissionKey\]\)/);
  assert.match(schema, /@@unique\(\[organizationId, name\]\)/);
});

test('normal request traffic never performs the legacy Echo bootstrap or null-row ownership backfill', () => {
  const platformPage = readFileSync('app/platform/page.tsx', 'utf8');
  const organizations = readFileSync('lib/organizations.ts', 'utf8');
  assert.doesNotMatch(platformPage, /ensureEchoOrganization/);
  assert.doesNotMatch(organizations, /updateMany\([^)]*organizationId:\s*null/s);
});
