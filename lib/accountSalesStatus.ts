import {
  AccountSalesStatus,
  AccountSalesStatusSource,
  SalesAccountType,
  WorklistStatus,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import { captureWholesaleSalesEvents } from './accountSalesEvents';
import { getTenantSalesWhere } from './ohlqSalesData';
import { prisma } from './prisma';
import { getOrganizationTenantConfig } from './tenantConfig';

export const SALES_STATUS_OPTIONS = [
  { value: AccountSalesStatus.TARGET, label: 'Target' },
  { value: AccountSalesStatus.CONTACTED, label: 'Contacted' },
  { value: AccountSalesStatus.ENGAGED, label: 'Engaged' },
  { value: AccountSalesStatus.INTERESTED, label: 'Interested' },
  { value: AccountSalesStatus.WAITING_ON_ORDER, label: 'Waiting on Order' },
  { value: AccountSalesStatus.PURCHASING, label: 'Purchasing' },
  { value: AccountSalesStatus.NURTURE, label: 'Nurture' },
  { value: AccountSalesStatus.LOST, label: 'Lost' },
] as const;

export const VISIT_SALES_STATUS_OPTIONS = SALES_STATUS_OPTIONS.filter(({ value }) =>
  ([AccountSalesStatus.ENGAGED, AccountSalesStatus.INTERESTED, AccountSalesStatus.WAITING_ON_ORDER, AccountSalesStatus.NURTURE, AccountSalesStatus.LOST] as AccountSalesStatus[]).includes(value),
);

export const SALES_STATUS_LABELS = Object.fromEntries(SALES_STATUS_OPTIONS.map(({ value, label }) => [value, label])) as Record<AccountSalesStatus, string>;
export const BUYING_STATE_LABELS = {
  NEVER_PURCHASED: 'Never purchased',
  ACTIVE: 'Active purchaser',
  LAPSED: 'Lapsed purchaser',
} as const;
export type BuyingState = keyof typeof BUYING_STATE_LABELS;

export const SALES_STATUS_THRESHOLDS = {
  activePurchaseDays: 90,
  noMeaningfulActivityDays: 21,
  waitingOnOrderDays: 14,
} as const;

export const ACTIVE_SALES_STATUSES = [
  AccountSalesStatus.TARGET,
  AccountSalesStatus.CONTACTED,
  AccountSalesStatus.ENGAGED,
  AccountSalesStatus.INTERESTED,
  AccountSalesStatus.WAITING_ON_ORDER,
  AccountSalesStatus.PURCHASING,
] as const;

export const SALES_AUTOMATION_ELIGIBLE_STATUSES = [
  AccountSalesStatus.TARGET,
  AccountSalesStatus.CONTACTED,
  AccountSalesStatus.ENGAGED,
  AccountSalesStatus.INTERESTED,
  AccountSalesStatus.WAITING_ON_ORDER,
] as const;

export function countSalesStatuses(statuses: readonly AccountSalesStatus[]) {
  const counts = Object.fromEntries(Object.values(AccountSalesStatus).map((status) => [status, 0])) as Record<AccountSalesStatus, number>;
  statuses.forEach((status) => { counts[status] += 1; });
  return counts;
}

type SalesStatusDb = PrismaClient | Prisma.TransactionClient;

export function parseSalesStatus(value: FormDataEntryValue | string | null | undefined) {
  return Object.values(AccountSalesStatus).includes(value as AccountSalesStatus) ? value as AccountSalesStatus : null;
}

export function getBuyingState(lastPurchaseAt: Date | null, now = new Date()): BuyingState {
  if (!lastPurchaseAt) return 'NEVER_PURCHASED';
  const activeCutoff = new Date(now.getTime() - SALES_STATUS_THRESHOLDS.activePurchaseDays * 86_400_000);
  return lastPurchaseAt >= activeCutoff ? 'ACTIVE' : 'LAPSED';
}

export function getNeedsAttentionReasons({
  status,
  statusUpdatedAt,
  lastActivityAt,
  lastPurchaseAt,
  nextActionAt,
  now = new Date(),
}: {
  status: AccountSalesStatus;
  statusUpdatedAt: Date;
  lastActivityAt: Date | null;
  lastPurchaseAt: Date | null;
  nextActionAt: Date | null;
  now?: Date;
}) {
  const daysSince = (value: Date | null) => value ? Math.floor((now.getTime() - value.getTime()) / 86_400_000) : null;
  const reasons: string[] = [];
  if ((ACTIVE_SALES_STATUSES as readonly AccountSalesStatus[]).includes(status) && (!nextActionAt || nextActionAt < now)) reasons.push('No future next step');
  const activityDays = daysSince(lastActivityAt);
  if (activityDays === null || activityDays >= SALES_STATUS_THRESHOLDS.noMeaningfulActivityDays) reasons.push(`No meaningful activity in ${SALES_STATUS_THRESHOLDS.noMeaningfulActivityDays} days`);
  if (status === AccountSalesStatus.WAITING_ON_ORDER && daysSince(statusUpdatedAt)! >= SALES_STATUS_THRESHOLDS.waitingOnOrderDays && (!lastPurchaseAt || lastPurchaseAt < statusUpdatedAt)) {
    reasons.push(`Waiting on Order for ${SALES_STATUS_THRESHOLDS.waitingOnOrderDays} days without a purchase`);
  }
  return reasons;
}

async function assertEntitled(db: SalesStatusDb, organizationId: string) {
  const entitlement = await db.organizationFeature.findFirst({ where: { organizationId, featureKey: 'ACCOUNT_SALES_STATUS', enabled: true }, select: { id: true } });
  if (!entitlement) throw new Error('ACCOUNT_SALES_STATUS is not enabled for this organization.');
}

async function assertAccountExists(db: SalesStatusDb, accountType: SalesAccountType, externalAccountId: string) {
  const account = accountType === SalesAccountType.AGENCY
    ? await db.agency.findUnique({ where: { id: externalAccountId }, select: { id: true } })
    : await db.wholesaleAccount.findFirst({ where: { id: externalAccountId, mergedIntoId: null }, select: { id: true } });
  if (!account) throw new Error('Account not found.');
}

export async function setAccountSalesStatus({
  accountType,
  changedAt = new Date(),
  changedByUserId,
  context,
  db = prisma,
  externalAccountId,
  loggedVisitId,
  organizationId,
  purchaseSourceKey,
  source,
  status,
}: {
  accountType: SalesAccountType;
  changedAt?: Date;
  changedByUserId?: string | null;
  context?: string | null;
  db?: SalesStatusDb;
  externalAccountId: string;
  loggedVisitId?: string | null;
  organizationId: string;
  purchaseSourceKey?: string | null;
  source: AccountSalesStatusSource;
  status: AccountSalesStatus;
}) {
  await assertEntitled(db, organizationId);
  await assertAccountExists(db, accountType, externalAccountId);
  const overlayKey = { organizationId_accountType_externalAccountId: { organizationId, accountType, externalAccountId } };
  const current = await db.organizationAccountOverlay.findUnique({ where: overlayKey, select: { salesStatus: true } });
  if (current?.salesStatus === status) return { changed: false, previousStatus: current.salesStatus, status };
  await db.organizationAccountOverlay.upsert({
    where: overlayKey,
    create: { organizationId, accountType, externalAccountId, salesStatus: status, salesStatusUpdatedAt: changedAt, salesStatusUpdatedBy: changedByUserId ?? null },
    update: { salesStatus: status, salesStatusUpdatedAt: changedAt, salesStatusUpdatedBy: changedByUserId ?? null },
  });
  await db.accountSalesStatusHistory.create({
    data: { organizationId, accountType, externalAccountId, previousStatus: current?.salesStatus ?? null, newStatus: status, changedAt, changedByUserId: changedByUserId ?? null, source, loggedVisitId: loggedVisitId ?? null, context: context ?? null, purchaseSourceKey: purchaseSourceKey ?? null },
  });
  return { changed: true, previousStatus: current?.salesStatus ?? null, status };
}

export async function getLatestPurchaseAt({ accountType, externalAccountId, organizationId, db = prisma }: { accountType: SalesAccountType; externalAccountId: string; organizationId: string; db?: SalesStatusDb }) {
  await assertEntitled(db, organizationId);
  if (accountType === SalesAccountType.WHOLESALE) {
    const purchase = await db.accountSalesEvent.findFirst({ where: { organizationId, wholesaleAccountId: externalAccountId, isTenantProduct: true, bottles: { gt: 0 } }, orderBy: { reportDate: 'desc' }, select: { reportDate: true } });
    return purchase?.reportDate ?? null;
  }
  const agency = await db.agency.findUnique({ where: { id: externalAccountId }, select: { agencyId: true } });
  if (!agency) return null;
  const config = await getOrganizationTenantConfig(organizationId, db);
  const purchase = await db.ohlqAnnualSalesRow.findFirst({ where: { agencyId: agency.agencyId, retailBottlesSold: { gt: 0 }, ...getTenantSalesWhere(config) }, orderBy: { reportDate: 'desc' }, select: { reportDate: true } });
  return purchase?.reportDate ?? null;
}

export async function getAccountSalesStatusSummary({ accountType, externalAccountId, organizationId, db = prisma, now = new Date() }: { accountType: SalesAccountType; externalAccountId: string; organizationId: string; db?: SalesStatusDb; now?: Date }) {
  await assertEntitled(db, organizationId);
  const [overlay, lastPurchaseAt] = await Promise.all([
    db.organizationAccountOverlay.findUnique({ where: { organizationId_accountType_externalAccountId: { organizationId, accountType, externalAccountId } }, select: { assignedUserId: true, salesStatus: true, salesStatusUpdatedAt: true, salesStatusUpdatedBy: true } }),
    getLatestPurchaseAt({ accountType, externalAccountId, organizationId, db }),
  ]);
  const changedBy = overlay?.salesStatusUpdatedBy ? await db.user.findFirst({ where: { id: overlay.salesStatusUpdatedBy, organizationId }, select: { email: true, name: true, firstName: true, lastName: true } }) : null;
  return {
    assignedUserId: overlay?.assignedUserId ?? null,
    buyingState: getBuyingState(lastPurchaseAt, now),
    changedBy,
    lastPurchaseAt,
    status: overlay?.salesStatus ?? AccountSalesStatus.TARGET,
    statusIsExplicit: Boolean(overlay?.salesStatus),
    statusUpdatedAt: overlay?.salesStatusUpdatedAt ?? null,
  };
}

export async function transitionEligibleSalesStatusPurchases({ db, organizationId, accountType, purchases }: { db: PrismaClient; organizationId: string; accountType: SalesAccountType; purchases: Array<{ externalAccountId: string; occurredAt: Date; sourceKey: string }> }) {
  const overlays = await db.organizationAccountOverlay.findMany({ where: { organizationId, accountType, salesStatus: { in: [...SALES_AUTOMATION_ELIGIBLE_STATUSES] } }, select: { externalAccountId: true, salesStatus: true, salesStatusUpdatedAt: true } });
  const eligible = new Map(overlays.map((overlay) => [overlay.externalAccountId, overlay]));
  let transitioned = 0;
  for (const purchase of purchases) {
    const overlay = eligible.get(purchase.externalAccountId);
    if (!overlay || (overlay.salesStatusUpdatedAt && purchase.occurredAt < overlay.salesStatusUpdatedAt)) continue;
    try {
      const result = await db.$transaction((tx) => setAccountSalesStatus({ accountType, changedAt: purchase.occurredAt, db: tx, externalAccountId: purchase.externalAccountId, organizationId, purchaseSourceKey: purchase.sourceKey, source: AccountSalesStatusSource.SALES_DATA, status: AccountSalesStatus.PURCHASING, context: 'Qualifying tenant purchase detected.' }));
      if (result.changed) transitioned += 1;
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
    }
    eligible.delete(purchase.externalAccountId);
  }
  return transitioned;
}

export async function reconcileAccountSalesStatusAfterImport({ db = prisma, reportDate }: { db?: PrismaClient; reportDate: Date }) {
  const organizations = await db.organization.findMany({ where: { active: true, features: { some: { featureKey: 'ACCOUNT_SALES_STATUS', enabled: true } } }, select: { id: true } });
  const results = [];
  for (const organization of organizations) {
    const wholesaleCapture = await captureWholesaleSalesEvents({ db, organizationId: organization.id, reportDate });
    const config = await getOrganizationTenantConfig(organization.id, db);
    const [wholesaleRows, agencyRows, agencies] = await Promise.all([
      db.accountSalesEvent.findMany({ where: { organizationId: organization.id, reportDate, isTenantProduct: true, bottles: { gt: 0 } }, select: { wholesaleAccountId: true, reportDate: true, sourceKey: true } }),
      db.ohlqAnnualSalesRow.findMany({ where: { reportDate, retailBottlesSold: { gt: 0 }, ...getTenantSalesWhere(config) }, select: { agencyId: true, reportDate: true, vendor: true, brand: true } }),
      db.agency.findMany({ select: { id: true, agencyId: true } }),
    ]);
    const agencyByExternalId = new Map(agencies.map((agency) => [agency.agencyId.toUpperCase(), agency.id]));
    const agencyPurchases = agencyRows.flatMap((row) => {
      const externalAccountId = agencyByExternalId.get(row.agencyId.toUpperCase());
      return externalAccountId ? [{ externalAccountId, occurredAt: row.reportDate, sourceKey: `AGENCY:${row.reportDate.toISOString().slice(0, 10)}:${row.agencyId}:${row.vendor}:${row.brand}` }] : [];
    });
    const wholesaleTransitions = await transitionEligibleSalesStatusPurchases({ db, organizationId: organization.id, accountType: SalesAccountType.WHOLESALE, purchases: wholesaleRows.map((row) => ({ externalAccountId: row.wholesaleAccountId, occurredAt: row.reportDate, sourceKey: row.sourceKey })) });
    const agencyTransitions = await transitionEligibleSalesStatusPurchases({ db, organizationId: organization.id, accountType: SalesAccountType.AGENCY, purchases: agencyPurchases });
    results.push({ organizationId: organization.id, capturedWholesaleEvents: wholesaleCapture.created, wholesaleTransitions, agencyTransitions });
  }
  return { organizations: results, transitioned: results.reduce((total, result) => total + result.wholesaleTransitions + result.agencyTransitions, 0) };
}

export async function getAccountAttentionContext({ accountType, externalAccountId, organizationId, status, statusUpdatedAt, lastPurchaseAt, now = new Date(), db = prisma }: { accountType: SalesAccountType; externalAccountId: string; organizationId: string; status: AccountSalesStatus; statusUpdatedAt: Date; lastPurchaseAt: Date | null; now?: Date; db?: SalesStatusDb }) {
  const locationWhere = accountType === SalesAccountType.AGENCY ? { agencyId: externalAccountId } : { wholesaleAccountId: externalAccountId };
  const [lastVisit, nextAction] = await Promise.all([
    db.loggedVisit.findFirst({ where: { organizationId, ...locationWhere }, orderBy: { visitAt: 'desc' }, select: { visitAt: true } }),
    db.worklistItem.findFirst({ where: { organizationId, ...locationWhere, status: { in: [WorklistStatus.OPEN, WorklistStatus.IN_PROGRESS] }, dueDate: { gte: now } }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }], select: { dueDate: true, title: true } }),
  ]);
  return { lastActivityAt: lastVisit?.visitAt ?? null, nextAction, reasons: getNeedsAttentionReasons({ status, statusUpdatedAt, lastActivityAt: lastVisit?.visitAt ?? null, lastPurchaseAt, nextActionAt: nextAction?.dueDate ?? null, now }) };
}
