import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AccountSalesStatus, SalesAccountType } from '@prisma/client';
import { setAccountTargeting } from '../lib/accountTargeting';
import { classifyResearchNeed } from '../lib/accountResearchQueue';

test('targeting is organization scoped, records only transitions, and preserves Purchasing', async () => {
  const overlays = new Map<string, any>([
    ['org-a:WHOLESALE:wh-1', { isTargeting: false, salesStatus: AccountSalesStatus.PURCHASING }],
    ['org-c:WHOLESALE:wh-1', { isTargeting: false, salesStatus: AccountSalesStatus.ENGAGED }],
  ]);
  const history: any[] = [];
  const salesHistory: any[] = [];
  const db: any = {
    agency: { findUnique: async () => ({ id: 'agency-1' }) },
    wholesaleAccount: { findFirst: async () => ({ id: 'wh-1' }) },
    organizationFeature: { findFirst: async () => ({ id: 'status-feature' }) },
    organizationAccountOverlay: {
      findUnique: async ({ where }: any) => overlays.get(`${where.organizationId_accountType_externalAccountId.organizationId}:${where.organizationId_accountType_externalAccountId.accountType}:${where.organizationId_accountType_externalAccountId.externalAccountId}`) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const key = `${where.organizationId_accountType_externalAccountId.organizationId}:${where.organizationId_accountType_externalAccountId.accountType}:${where.organizationId_accountType_externalAccountId.externalAccountId}`;
        const current = { ...(overlays.get(key) ?? create), ...update };
        overlays.set(key, current);
        return current;
      },
    },
    accountTargetingHistory: { create: async ({ data }: any) => { history.push(data); return data; } },
    accountSalesStatusHistory: { create: async ({ data }: any) => { salesHistory.push(data); return data; } },
  };

  await setAccountTargeting({ accountType: SalesAccountType.WHOLESALE, changedByUserId: 'user-a', db, externalAccountId: 'wh-1', isTargeting: true, organizationId: 'org-a' });
  await setAccountTargeting({ accountType: SalesAccountType.WHOLESALE, changedByUserId: 'user-a', db, externalAccountId: 'wh-1', isTargeting: true, organizationId: 'org-a' });
  await setAccountTargeting({ accountType: SalesAccountType.WHOLESALE, changedByUserId: 'user-b', db, externalAccountId: 'wh-1', isTargeting: true, organizationId: 'org-b' });
  await setAccountTargeting({ accountType: SalesAccountType.WHOLESALE, changedByUserId: 'user-a', db, externalAccountId: 'wh-1', isTargeting: false, organizationId: 'org-a' });
  await setAccountTargeting({ accountType: SalesAccountType.WHOLESALE, changedByUserId: 'user-c', db, externalAccountId: 'wh-1', isTargeting: true, organizationId: 'org-c' });
  assert.equal(history.length, 4);
  assert.equal(overlays.get('org-a:WHOLESALE:wh-1').isTargeting, false);
  assert.equal(overlays.get('org-b:WHOLESALE:wh-1').isTargeting, true);
  assert.equal(overlays.get('org-a:WHOLESALE:wh-1').salesStatus, AccountSalesStatus.PURCHASING);
  assert.equal(history[2].isTargeting, false);
  assert.equal(salesHistory.length, 1);
  assert.equal(overlays.get('org-b:WHOLESALE:wh-1').salesStatus, AccountSalesStatus.TARGET);
  assert.equal(overlays.get('org-c:WHOLESALE:wh-1').salesStatus, AccountSalesStatus.ENGAGED);
});

test('targeting requests refreshed research even when the previous snapshot is fresh', () => {
  const now = new Date('2026-09-23T12:00:00Z');
  const candidate: any = {
    id: 'wh-1', licenseeId: 'L1', name: 'Local Bar', address: '1 Main St', city: 'Columbus', county: 'Franklin', state: 'OH', zip: '43215', createdAt: now,
    isTargeting: true,
    targetPublicResearch: { lastRefreshedAt: new Date('2026-09-22T12:00:00Z'), identitySnapshot: null },
    opportunities: [], upcomingWork: [],
  };
  assert.equal(classifyResearchNeed(candidate, now)?.researchReason, 'Target account; refresh research');
});

test('all required user surfaces use the centralized account target action and shared marker', () => {
  for (const path of ['app/visits/LogVisitForm.tsx', 'app/opportunities/page.tsx', 'app/agency-focus/page.tsx', 'app/wholesale/[id]/page.tsx', 'app/agencies/[id]/page.tsx']) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /TargetAccountControl|targetAccount/);
  }
  assert.match(readFileSync('app/components/TargetAccountMarker.tsx', 'utf8'), /TARGET ACCOUNT/);
  assert.match(readFileSync('app/account-targeting/actions.ts', 'utf8'), /scheduleTargetedAgencyResearch/);
  assert.match(readFileSync('app/visits/actions.ts', 'utf8'), /scheduleTargetedAgencyResearch/);
  assert.match(readFileSync('lib/scheduleTargetedAgencyResearch.ts', 'utf8'), /refreshTargetedAgencyResearch/);
  assert.match(readFileSync('lib/agencyIntelligenceService.ts', 'utf8'), /targetedAgencyIds/);
  const inventoryWorkflow = readFileSync('lib/ohlqTenantInventoryWorkflow.ts', 'utf8');
  assert.match(inventoryWorkflow, /accountOverlays: \{ some: \{ accountType: 'AGENCY', isTargeting: true \} \}/);
  assert.match(inventoryWorkflow, /targetedAgencyIds: organization\.features\.length \? undefined/);
  const styles = readFileSync('app/styles.css', 'utf8');
  assert.match(styles, /\.target-account-marker\s*\{[^}]*display:\s*block;[^}]*max-width:\s*100%/);
  assert.match(styles, /\.target-account-control\s*\{[^}]*flex-wrap:\s*wrap/);
});
