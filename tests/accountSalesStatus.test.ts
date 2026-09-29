import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { AccountSalesStatus, AccountSalesStatusSource, SalesAccountType } from '@prisma/client';
import {
  BUYING_STATE_LABELS,
  countSalesStatuses,
  getBuyingState,
  getNeedsAttentionReasons,
  SALES_AUTOMATION_ELIGIBLE_STATUSES,
  SALES_STATUS_LABELS,
  SALES_STATUS_OPTIONS,
  SALES_STATUS_THRESHOLDS,
  setAccountSalesStatus,
  transitionEligibleSalesStatusPurchases,
} from '../lib/accountSalesStatus';
import { CORE_PACKAGE_FEATURE_KEYS, ECHO_FEATURE_KEYS, FEATURE_REGISTRY, getPackageFeatureKeys } from '../lib/featureRegistry';
import { getNavigationItems } from '../app/components/navigationConfig';

test('sales status definitions are centralized, stable, and user friendly', () => {
  assert.deepEqual(SALES_STATUS_OPTIONS.map((option) => option.value), Object.values(AccountSalesStatus));
  assert.equal(SALES_STATUS_LABELS.WAITING_ON_ORDER, 'Waiting on Order');
  assert.equal(BUYING_STATE_LABELS.NEVER_PURCHASED, 'Never purchased');
});

test('pilot entitlement is default disabled, enabled for Echo, and independent of Intelligence', () => {
  assert.equal(FEATURE_REGISTRY.ACCOUNT_SALES_STATUS.defaultEnabled, false);
  assert.equal(CORE_PACKAGE_FEATURE_KEYS.includes('ACCOUNT_SALES_STATUS'), false);
  assert.equal(getPackageFeatureKeys(false).includes('ACCOUNT_SALES_STATUS'), false);
  assert.equal(getPackageFeatureKeys(false, false, false, true).includes('ACCOUNT_SALES_STATUS'), true);
  assert.equal(getPackageFeatureKeys(false, false, false, true).includes('WHOLESALE_OPPORTUNITIES'), false);
  assert.equal(ECHO_FEATURE_KEYS.includes('ACCOUNT_SALES_STATUS'), true);
  assert.equal(getNavigationItems('accounts', []).some((item) => item.href === '/pipeline'), false);
  assert.equal(getNavigationItems('accounts', ['ACCOUNT_SALES_STATUS']).some((item) => item.href === '/pipeline'), true);
});

test('tenant-scoped Agency and Wholesale updates preserve history and no-op updates are idempotent', async () => {
  const overlays = new Map<string, any>();
  const history: any[] = [];
  const entitlements = new Set(['org-a', 'org-b']);
  const db = {
    organizationFeature: { findFirst: async ({ where }: any) => entitlements.has(where.organizationId) && where.featureKey === 'ACCOUNT_SALES_STATUS' ? { id: 'feature' } : null },
    agency: { findUnique: async ({ where }: any) => where.id === 'agency-1' ? { id: where.id } : null },
    wholesaleAccount: { findFirst: async ({ where }: any) => where.id === 'wholesale-1' ? { id: where.id } : null },
    organizationAccountOverlay: {
      findUnique: async ({ where }: any) => overlays.get(`${where.organizationId_accountType_externalAccountId.organizationId}:${where.organizationId_accountType_externalAccountId.accountType}:${where.organizationId_accountType_externalAccountId.externalAccountId}`) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const key = `${where.organizationId_accountType_externalAccountId.organizationId}:${where.organizationId_accountType_externalAccountId.accountType}:${where.organizationId_accountType_externalAccountId.externalAccountId}`;
        const value = { ...(overlays.get(key) ?? create), ...update };
        overlays.set(key, value);
        return value;
      },
    },
    accountSalesStatusHistory: { create: async ({ data }: any) => { history.push(data); return data; } },
  } as any;

  await setAccountSalesStatus({ accountType: SalesAccountType.AGENCY, changedByUserId: 'user-a', db, externalAccountId: 'agency-1', organizationId: 'org-a', source: AccountSalesStatusSource.USER, status: AccountSalesStatus.INTERESTED });
  await setAccountSalesStatus({ accountType: SalesAccountType.AGENCY, changedByUserId: 'user-a', db, externalAccountId: 'agency-1', organizationId: 'org-a', source: AccountSalesStatusSource.VISIT, status: AccountSalesStatus.INTERESTED, loggedVisitId: 'visit-1' });
  await setAccountSalesStatus({ accountType: SalesAccountType.AGENCY, changedByUserId: 'user-b', db, externalAccountId: 'agency-1', organizationId: 'org-b', source: AccountSalesStatusSource.USER, status: AccountSalesStatus.NURTURE });
  await setAccountSalesStatus({ accountType: SalesAccountType.WHOLESALE, db, externalAccountId: 'wholesale-1', organizationId: 'org-a', purchaseSourceKey: 'purchase-1', source: AccountSalesStatusSource.SALES_DATA, status: AccountSalesStatus.PURCHASING });
  assert.equal(history.length, 3);
  assert.equal(history[0].source, AccountSalesStatusSource.USER);
  assert.equal(history[1].organizationId, 'org-b');
  assert.equal(history[2].purchaseSourceKey, 'purchase-1');
  assert.equal(overlays.get('org-a:AGENCY:agency-1').salesStatus, AccountSalesStatus.INTERESTED);
  assert.equal(overlays.get('org-b:AGENCY:agency-1').salesStatus, AccountSalesStatus.NURTURE);
  entitlements.delete('org-b');
  await assert.rejects(() => setAccountSalesStatus({ accountType: SalesAccountType.AGENCY, db, externalAccountId: 'agency-1', organizationId: 'org-b', source: AccountSalesStatusSource.USER, status: AccountSalesStatus.LOST }), /not enabled/);
});

test('buying state and deterministic attention thresholds distinguish objective and subjective state', () => {
  const now = new Date('2026-09-22T12:00:00Z');
  assert.equal(getBuyingState(null, now), 'NEVER_PURCHASED');
  assert.equal(getBuyingState(new Date('2026-09-01T00:00:00Z'), now), 'ACTIVE');
  assert.equal(getBuyingState(new Date('2026-01-01T00:00:00Z'), now), 'LAPSED');
  const reasons = getNeedsAttentionReasons({ status: AccountSalesStatus.WAITING_ON_ORDER, statusUpdatedAt: new Date('2026-09-01T00:00:00Z'), lastActivityAt: new Date('2026-08-01T00:00:00Z'), lastPurchaseAt: null, nextActionAt: null, now });
  assert.equal(SALES_STATUS_THRESHOLDS.noMeaningfulActivityDays, 21);
  assert.equal(SALES_STATUS_THRESHOLDS.waitingOnOrderDays, 14);
  assert.deepEqual(reasons, ['No future next step', 'No meaningful activity in 21 days', 'Waiting on Order for 14 days without a purchase']);
});

test('sales automation includes only safe stages and pipeline counts match tracked accounts', () => {
  assert.equal(SALES_AUTOMATION_ELIGIBLE_STATUSES.includes(AccountSalesStatus.WAITING_ON_ORDER), true);
  assert.equal((SALES_AUTOMATION_ELIGIBLE_STATUSES as readonly AccountSalesStatus[]).includes(AccountSalesStatus.NURTURE), false);
  assert.equal((SALES_AUTOMATION_ELIGIBLE_STATUSES as readonly AccountSalesStatus[]).includes(AccountSalesStatus.LOST), false);
  const counts = countSalesStatuses([AccountSalesStatus.TARGET, AccountSalesStatus.INTERESTED, AccountSalesStatus.INTERESTED]);
  assert.equal(counts.TARGET, 1);
  assert.equal(counts.INTERESTED, 2);
  assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), 3);
});

test('purchase reconciliation moves eligible status once and never overwrites Nurture or Lost', async () => {
  const overlays = new Map<string, any>([
    ['eligible', { externalAccountId: 'eligible', salesStatus: AccountSalesStatus.INTERESTED, salesStatusUpdatedAt: new Date('2026-09-01') }],
    ['nurture', { externalAccountId: 'nurture', salesStatus: AccountSalesStatus.NURTURE, salesStatusUpdatedAt: new Date('2026-09-01') }],
    ['lost', { externalAccountId: 'lost', salesStatus: AccountSalesStatus.LOST, salesStatusUpdatedAt: new Date('2026-09-01') }],
  ]);
  const history: any[] = [];
  const db: any = {
    organizationFeature: { findFirst: async () => ({ id: 'feature' }) },
    agency: { findUnique: async () => null },
    wholesaleAccount: { findFirst: async ({ where }: any) => overlays.has(where.id) ? { id: where.id } : null },
    organizationAccountOverlay: {
      findMany: async () => [...overlays.values()].filter((row) => (SALES_AUTOMATION_ELIGIBLE_STATUSES as readonly AccountSalesStatus[]).includes(row.salesStatus)),
      findUnique: async ({ where }: any) => overlays.get(where.organizationId_accountType_externalAccountId.externalAccountId) ?? null,
      upsert: async ({ where, update }: any) => {
        const id = where.organizationId_accountType_externalAccountId.externalAccountId;
        overlays.set(id, { ...overlays.get(id), ...update });
      },
    },
    accountSalesStatusHistory: { create: async ({ data }: any) => { history.push(data); return data; } },
  };
  db.$transaction = async (callback: any) => callback(db);
  const purchases = ['eligible', 'eligible', 'nurture', 'lost'].map((externalAccountId, index) => ({ externalAccountId, occurredAt: new Date('2026-09-20'), sourceKey: `purchase-${index}` }));
  assert.equal(await transitionEligibleSalesStatusPurchases({ accountType: SalesAccountType.WHOLESALE, db, organizationId: 'org-a', purchases }), 1);
  assert.equal(await transitionEligibleSalesStatusPurchases({ accountType: SalesAccountType.WHOLESALE, db, organizationId: 'org-a', purchases }), 0);
  assert.equal(overlays.get('eligible').salesStatus, AccountSalesStatus.PURCHASING);
  assert.equal(overlays.get('nurture').salesStatus, AccountSalesStatus.NURTURE);
  assert.equal(overlays.get('lost').salesStatus, AccountSalesStatus.LOST);
  assert.equal(history.length, 1);
  assert.equal(history[0].source, AccountSalesStatusSource.SALES_DATA);
});

test('Pipeline, status writes, visit integration, and sales import are server gated and remain separate from Opportunities', () => {
  const pipeline = readFileSync('app/pipeline/page.tsx', 'utf8');
  const actions = readFileSync('app/account-sales-status/actions.ts', 'utf8');
  const visits = readFileSync('app/visits/actions.ts', 'utf8');
  const visitForm = readFileSync('app/visits/LogVisitForm.tsx', 'utf8');
  const workflow = readFileSync('lib/ohlqAnnualSalesWorkflow.ts', 'utf8');
  const service = readFileSync('lib/accountSalesStatus.ts', 'utf8');
  assert.match(pipeline, /requireFeatureForUser\(user, 'ACCOUNT_SALES_STATUS'\)/);
  assert.match(actions, /requireFeatureForUser\(user, 'ACCOUNT_SALES_STATUS'\)/);
  assert.match(visits, /hasFeature\(organizationId, 'ACCOUNT_SALES_STATUS'\)/);
  assert.match(visits, /source: AccountSalesStatusSource\.VISIT/);
  assert.match(visitForm, /defaultChecked name="salesStatus" type="radio" value=""/);
  assert.match(workflow, /reconcileAccountSalesStatusAfterImport/);
  assert.match(service, /purchaseSourceKey/);
  assert.doesNotMatch(service, /WHOLESALE_OPPORTUNITIES|opportunityEngine/);
});

test('Pipeline defaults to Kanban with collapsed native groups and visible filter affordances', () => {
  const pipeline = readFileSync('app/pipeline/page.tsx', 'utf8');
  const journey = readFileSync('app/components/SalesStatusJourney.tsx', 'utf8');
  const styles = readFileSync('app/components/salesStatus.css', 'utf8');
  assert.match(pipeline, /const view = params\?\.view === 'list' \? 'list' : 'board'/);
  assert.ok(pipeline.indexOf("href={pipelineHref('board')}") < pipeline.indexOf("href={pipelineHref('list')}"));
  assert.match(pipeline, /<details className="pipeline-kanban-column"/);
  assert.doesNotMatch(pipeline, /<details[^>]*\sopen(?:[\s=>])/);
  assert.match(pipeline, /<summary><h3>\{option.label\}<\/h3>/);
  assert.match(pipeline, /href=\{pipelineHref\(view, null\)\}>Clear filter/);
  assert.match(journey, /filterHref \? 'sales-journey--filters'/);
  assert.match(journey, /sales-journey-filter-icon/);
  assert.match(styles, /summary:focus-visible/);
  assert.match(styles, /\.pipeline-kanban-column\[open\]/);
});
