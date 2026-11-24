import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from './prisma';
import { ECHO_ORGANIZATION_ID, assertEchoOrganization } from './echoAccess';
import { getOrganizationTenantConfig } from './tenantConfig';
import { isRestaurantProductRestricted, loadRestaurantProductRestrictions } from './restaurantProductEligibility';
import { buildDailyPurchaseEvents } from './opportunitySalesLedger';
import { hasResearchIdentityChanged, readResearchEvidence } from './accountResearchQueue';
import { isOutsideOhio, normalizeUsState } from './usStates';
import { assessWholesaleAccount, ASSESSMENT_VERSION, type Assessment, type AssessmentInput, type UseEvidence } from './wholesaleAssessment';
import { aggregatePurchases, marketPortfolio, storedResearchUses, storedResearchSignals, wholesaleAssessmentConfigurationId } from './wholesaleAssessmentInputs';
import { assessmentDay, identityCoverage, isoDay, reportRevision, sourceCoverage, windowDates, representedWindow } from './wholesaleAssessmentCoverage';
import { summarizePurchaseOutcome } from './wholesaleAssessmentOutcomes';
import { forEachInBatches } from './forEachInBatches';
import { persistAssessmentBatch, type AssessmentWrite } from './wholesaleAssessmentPersistence';

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const DAY = 86_400_000;
const LEASE_MS = 10 * 60_000;
const BATCH_SIZE = 100;
class AssessmentSourceChangedError extends Error {}
export const enabledAssessmentTenants = { id: ECHO_ORGANIZATION_ID, active: true, accountStatus: { notIn: ['SUSPENDED', 'CANCELLED'] }, features: { some: { enabled: true, featureKey: 'WHOLESALE_OPPORTUNITIES' } } } satisfies Prisma.OrganizationWhereInput;
const groupByAccount = <T extends { wholesaleAccountId: string | null }>(rows: T[]) => {
  const map = new Map<string, T[]>();
  for (const row of rows) if (row.wholesaleAccountId) { const list = map.get(row.wholesaleAccountId) ?? []; list.push(row); map.set(row.wholesaleAccountId, list); }
  return map;
};

export async function evaluateWholesaleAssessments({ db = prisma, asOfDate = new Date(), accountIds, organizationId, dryRun = false, reconcileLedger = false }: {
  db?: PrismaClient; asOfDate?: Date; accountIds?: string[]; organizationId: string; dryRun?: boolean; reconcileLedger?: boolean;
}) {
  assertEchoOrganization(organizationId);
  const eligible = await db.organization.findFirst({ where: enabledAssessmentTenants, select: { id: true } });
  if (!eligible) throw new Error('Restaurant intelligence is unavailable for this organization.');
  const startedAt = new Date();
  let runId: string | null = null;
  let expected = 0, evaluated = 0, persisted = 0, ineligible = 0, skipped = 0, failed = 0, sourceBlocked = 0;
  const errors: Array<{ accountId?: string; message: string }> = [];
  const counts = { SALES_BACKED: 0, RESEARCH_ONLY: 0, PARTIAL_SALES: 0 };
  const previews: Array<{ accountId: string; name: string; assessment: Assessment; previousPriority: number | null; previousRating: number | null; previousTitle: string | null; input: AssessmentInput }> = [];
  const result = () => ({ runId, expected, accountsEvaluated: evaluated, evaluated, persisted, ineligible, skipped, failed, sourceBlocked, evidenceCounts: counts,
    detected: 0, converted: 0, worklistCreated: 0, rulesVersion: ASSESSMENT_VERSION, scoringVersion: ASSESSMENT_VERSION,
    learning: { active: false, reason: 'Shadow outcomes only; no score adjustment' }, previews, errors });
  // Each publish transaction checks and renews the unique tenant lease. A replaced
  // worker cannot overwrite a newer run, even after a crash and lease takeover.
  const renew = async (tx: Prisma.TransactionClient) => {
    if (!runId) return;
    const owned = await tx.wholesaleAssessmentRun.updateMany({ where: { id: runId, activeKey: organizationId, leaseUntil: { gt: new Date() } }, data: { leaseUntil: new Date(Date.now() + LEASE_MS) } });
    if (owned.count !== 1) throw new Error('Assessment lease lost; retry the score-only refresh.');
  };
  const markUnavailable = async (accountId: string, assessmentStatus: 'SOURCE_ERROR' | 'ERROR', assessmentReason: string) => {
    if (dryRun) return;
    await db.$transaction(async tx => {
      await renew(tx);
      await tx.wholesaleAccountAssessment.updateMany({ where: { organizationId, wholesaleAccountId: accountId }, data: { assessmentStatus, assessmentReason, refreshRequestedAt: startedAt } });
    });
  };
  try {
    if (!dryRun) {
      await db.wholesaleAssessmentRun.updateMany({ where: { activeKey: organizationId, leaseUntil: { lte: startedAt } }, data: { activeKey: null, status: 'ABANDONED', completedAt: startedAt } });
      const run = await db.wholesaleAssessmentRun.create({ data: { organizationId, activeKey: organizationId, leaseUntil: new Date(Date.now() + LEASE_MS),
        modelVersion: ASSESSMENT_VERSION, configurationId: 'loading', fullSweep: !accountIds, status: 'RUNNING', evidenceCounts: {}, sourceCoverage: {}, errors: [] } });
      runId = run.id;
    }
    const [config, decisions, catalog, latestReport, prior, inventoryStatus, available, identities] = await Promise.all([
      getOrganizationTenantConfig(organizationId, db), db.organizationProduct.findMany({ where: { organizationId } }), db.ohlqBrandMasterItem.findMany(),
      db.ohlqReportImportStatus.findFirst({ where: { dataSource: 'ANNUAL_SALES_SUMMARY_BY_WHOLESALE', status: 'COMPLETED' }, orderBy: { reportDate: 'desc' } }),
      db.wholesaleAccountAssessment.findFirst({ where: { organizationId }, orderBy: { asOfDate: 'desc' }, select: { asOfDate: true } }),
      db.ohlqTenantInventoryImportStatus.findFirst({ where: { organizationId }, orderBy: [{ reportDate: 'desc' }, { updatedAt: 'desc' }] }),
      db.ohlqAgencyInventoryCurrent.findMany({ where: { organizationId }, distinct: ['itemCode'], select: { itemCode: true } }),
      db.wholesaleAccount.findMany({ where: { mergedIntoId: null, OR: [{ state: { in: ['OH','Ohio'], mode: 'insensitive' } }, { state: null }, { state: '' }] }, select: { id: true, licenseeId: true, licenseeIds: { select: { licenseeId: true } } } }),
    ]);
    // Age on wall-clock days, but never move a live assessment backwards for a backfill.
    const easternToday = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(startedAt)}T00:00:00Z`);
    const yesterday = new Date(easternToday.getTime() - DAY);
    const asOf = assessmentDay(new Date(Math.max(yesterday.getTime(), Math.min(asOfDate.getTime(), yesterday.getTime()), latestReport?.reportDate.getTime() ?? 0, prior?.asOfDate.getTime() ?? 0)));
    const start90 = new Date(asOf.getTime() - 89 * DAY);
    const masters = new Map(catalog.map(p => [p.itemCode, p]));
    const restrictedItemCodes = await loadRestaurantProductRestrictions(organizationId, db, catalog);
    const tenantCodes = new Set(decisions.filter(p => ['OWNED','REPRESENTED'].includes(p.status)).map(p => p.externalItemCode));
    const identitiesById = identityCoverage(identities);
    config.productFilter.mode = 'item-list';
    const configurationId = wholesaleAssessmentConfigurationId(decisions, catalog, restrictedItemCodes);
    const inventory = {
      trusted: inventoryStatus?.status === 'COMPLETED' && inventoryStatus.reportDate >= new Date(asOf.getTime() - 2 * DAY),
      available: new Set(available.map(a => a.itemCode)),
    };
    const portfoliosByMarket = new Map<string | null, ReturnType<typeof marketPortfolio>>();
    const getMarketPortfolio = (state: string | null) => {
      const market = normalizeUsState(state);
      const cached = portfoliosByMarket.get(market);
      if (cached) return cached;
      const portfolio = marketPortfolio(decisions, masters, market, inventory, restrictedItemCodes);
      portfoliosByMarket.set(market, portfolio);
      return portfolio;
    };
    const captureStart = new Date(Math.min(start90.getTime(), assessmentDay(asOfDate).getTime()));
    const reports = await db.ohlqReportImportStatus.findMany({ where: { dataSource: 'ANNUAL_SALES_SUMMARY_BY_WHOLESALE', reportDate: { gte: captureStart, lte: asOf } }, orderBy: { reportDate: 'asc' } });
    const sourceFingerprint = (rows: Array<{ reportDate: Date; updatedAt: Date; rowCount: number; status: string }>) => rows
      .filter(r => r.reportDate >= start90 && r.reportDate <= asOf)
      .map(r => `${isoDay(r.reportDate)}:${r.status}:${reportRevision(r)}`).sort().join('|');
    const inputsSourceRevision = sourceFingerprint(reports);
    // Targeted scoring reads account-scoped ledger history, never statewide raw rows.
    if (reconcileLedger && !dryRun) {
      const captured = new Map((await db.wholesaleSalesLedgerDay.findMany({ where: { organizationId, reportDate: { gte: captureStart } } })).map(d => [isoDay(d.reportDate), d]));
      for (const report of reports.filter(r => r.status === 'COMPLETED')) {
        if (captured.get(isoDay(report.reportDate))?.sourceRevision === reportRevision(report)) continue;
        await db.$transaction(async tx => {
          await renew(tx);
          const fresh = await tx.ohlqReportImportStatus.findUnique({ where: { id: report.id } });
          if (!fresh || fresh.status !== 'COMPLETED' || reportRevision(fresh) !== reportRevision(report)) throw new Error('Sales report changed; retry capture.');
          const raw = await tx.ohlqAnnualSalesByWholesaleRow.findMany({ where: { reportDate: report.reportDate } });
          if (raw.length !== report.rowCount || report.skippedRows > 0) return; // Pruned/unavailable: never certify coverage.
          const events = buildDailyPurchaseEvents(raw, identities, catalog, config);
          await tx.accountSalesEvent.deleteMany({ where: { organizationId, reportDate: report.reportDate, sourceKey: { startsWith: 'DAILY_V3:' } } });
          for (let i = 0; i < events.length; i += 1000) await tx.accountSalesEvent.createMany({ data: events.slice(i, i + 1000), skipDuplicates: true });
          await tx.wholesaleSalesLedgerDay.upsert({ where: { organizationId_reportDate: { organizationId, reportDate: report.reportDate } },
            create: { organizationId, reportDate: report.reportDate, sourceRevision: reportRevision(report), sourceRows: raw.length },
            update: { sourceRevision: reportRevision(report), sourceRows: raw.length, capturedAt: new Date() } });
        }, { timeout: 60_000, isolationLevel: 'Serializable' });
      }
    }
    const ledgerDays = await db.wholesaleSalesLedgerDay.findMany({ where: { organizationId, reportDate: { gte: start90, lte: asOf } } });
    const reportByDate = new Map(reports.map(r => [isoDay(r.reportDate), r]));
    const completeDates = new Set(ledgerDays.filter(d => { const r = reportByDate.get(isoDay(d.reportDate)); return r?.status === 'COMPLETED' && !(r.skippedRows > 0) && d.sourceRevision === reportRevision(r); }).map(d => isoDay(d.reportDate)));
    const selected = representedWindow(asOf, completeDates);
    const latestSourceDate = [...completeDates].sort().at(-1) ?? null;
    const latestSourceReport = reports.filter(r => r.reportDate >= start90).at(-1);
    const sourceFailed = Boolean(latestSourceReport && (latestSourceReport.status !== 'COMPLETED' || !completeDates.has(isoDay(latestSourceReport.reportDate))));
    const source = { status: sourceFailed ? 'SOURCE_ERROR' : selected.days ? 'REPRESENTED_PERIOD_COMPLETE' : 'UNAVAILABLE', through: selected.through,
      from: selected.from, representedDays: selected.days, latestSourceDate, latestCompletedReport: latestReport ? isoDay(latestReport.reportDate) : null, completeDays: completeDates.size, expectedDays: selected.days,
      missingDates: windowDates(asOf).filter(d => !completeDates.has(d)), inventoryStatus: inventoryStatus?.status ?? 'UNAVAILABLE' };
    const where: Prisma.WholesaleAccountWhereInput = { mergedIntoId: null, ...(accountIds ? { id: { in: [...new Set(accountIds)] } } : {}) };
    expected = await db.wholesaleAccount.count({ where });
    if (runId) await db.wholesaleAssessmentRun.update({ where: { id: runId }, data: { expected, asOfDate: asOf, configurationId, sourceCoverage: source } });
    let cursor: string | undefined;
    for (;;) {
      const accounts = await db.wholesaleAccount.findMany({ where, orderBy: { id: 'asc' }, take: BATCH_SIZE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: { targetPublicResearch: true, tags: { where: { organizationId }, include: { tag: true } }, currentAssessments: { where: { organizationId } } } });
      if (!accounts.length) break;
      cursor = accounts.at(-1)!.id;
      const ids = accounts.map(a => a.id);
      const [events, overlays, placements, visits, work, pursuits] = await Promise.all([
        db.accountSalesEvent.findMany({ where: { organizationId, wholesaleAccountId: { in: ids }, sourceKey: { startsWith: 'DAILY_V3:' }, reportDate: { gte: start90, lte: asOf } } }),
        db.organizationAccountOverlay.findMany({ where: { organizationId, accountType: 'WHOLESALE', externalAccountId: { in: ids } } }),
        db.menuPlacement.findMany({ where: { organizationId, wholesaleAccountId: { in: ids } } }),
        db.loggedVisit.findMany({ where: { organizationId, wholesaleAccountId: { in: ids }, visitAt: { gte: start90 } }, orderBy: { visitAt: 'desc' }, select: { wholesaleAccountId: true, visitAt: true } }),
        db.worklistItem.findMany({ where: { organizationId, wholesaleAccountId: { in: ids }, status: { in: ['OPEN','IN_PROGRESS'] } }, select: { wholesaleAccountId: true } }),
        db.salesOpportunity.findMany({ where: { organizationId, wholesaleAccountId: { in: ids } }, select: { id: true, wholesaleAccountId: true, status: true, title: true, productionScore: true, detectedAt: true, outcomeSummary: true, events: { where: { eventType: 'DETECTED' }, take: 1, select: { metadata: true } } } }),
      ]);
      const eventMap = groupByAccount(events), placementMap = groupByAccount(placements), visitMap = groupByAccount(visits), workMap = groupByAccount(work), pursuitMap = groupByAccount(pursuits);
      const overlayMap = new Map(overlays.map(o => [o.externalAccountId, o]));
      const writes: AssessmentWrite[] = [];
      const outcomes: Array<{ id: string; data: Prisma.SalesOpportunityUpdateInput }> = [];
      await forEachInBatches(accounts, 4, async (account) => {
        try {
          const research = account.targetPublicResearch;
          const validIdentity = Boolean(research?.identitySnapshot && !hasResearchIdentityChanged(account, research.identitySnapshot));
          const observedAt = research?.lastRefreshedAt?.toISOString() ?? null;
          const accountEvents = eventMap.get(account.id) ?? [];
          const previous = account.currentAssessments[0];
          const previousCoverage = (previous?.assessment as { coverage?: { identity?: string; representedFrom?: string; through?: string } } | null)?.coverage;
          // A certified account-linked source association is stronger than a state
          // label. Foreign license numbers alone must not certify an Ohio zero.
          const linkedSalesSource = accountEvents.some(e => completeDates.has(isoDay(e.reportDate)))
            || previous?.evidenceMode === 'SALES_BACKED' && previousCoverage?.identity === 'MATCHED';
          const identity = isOutsideOhio(account.state) ? linkedSalesSource ? 'MATCHED' : 'UNAVAILABLE' : identitiesById.get(account.id) ?? 'UNMATCHED';
          const { products, excludedItemCodes } = getMarketPortfolio(account.state);
          const eligibleEvents = accountEvents.filter(e => !isRestaurantProductRestricted(e.itemCode, excludedItemCodes));
          const purchases = identity !== 'MATCHED' || !selected.through ? [] : aggregatePurchases(eligibleEvents.filter(e => selected.dates.has(isoDay(e.reportDate))), masters, tenantCodes, new Date(`${selected.through}T00:00:00Z`));
          const privateUses: UseEvidence[] = (placementMap.get(account.id) ?? []).filter(p => ['PROMISED','ACTIVE'].includes(p.status)).map(p => ({
            productCode: products.find(product => product.name.toLowerCase() === p.product.toLowerCase() || product.itemCode === p.product)?.itemCode ?? null,
            category: null, subtype: null, use: p.useFamily ?? p.menuItemName, kind: p.demandEvidence ? 'BUYER_PLAN' : 'PLACEMENT',
            claim: p.demandEvidence ?? `${p.status === 'PROMISED' ? 'Agreed' : 'Live'} placement: ${p.menuItemName}`, source: p.proofUrl ?? `Rep-confirmed placement ${p.id}`,
            observedAt: (p.lastVerifiedAt ?? p.firstSeenAt ?? p.createdAt).toISOString(), exactLocation: true, pouredProduct: p.pouredProduct, status: p.status }));
          const publicEvidence = validIdentity ? readResearchEvidence(research?.identitySnapshot) : [];
          const overlay = overlayMap.get(account.id);
          const coverage = sourceCoverage({ asOf, completeDates, identity, hasPurchases: accountEvents.some(e => selected.dates.has(isoDay(e.reportDate))), through: selected.through });
          if (coverage.mode === 'SALES_BACKED' && eligibleEvents.length < accountEvents.length) {
            coverage.limitations.push('Assessment purchasing totals cover products eligible for restaurant analysis. Full sales history is available on the restaurant account.');
          }
          const contextPeriod = (offset: number) => {
            const through = new Date(asOf.getTime() - offset * DAY), dates = new Set(windowDates(through, 30));
            return { from: [...dates].at(-1)!, through: isoDay(through), coveredDays: [...dates].filter(d => completeDates.has(d)).length,
              bottles: eligibleEvents.filter(e => dates.has(isoDay(e.reportDate)) && completeDates.has(isoDay(e.reportDate))).reduce((n,e) => n + e.bottles, 0) };
          };
          coverage.latestSourceDate = identity === 'MATCHED' ? latestSourceDate : null;
          if (identity === 'MATCHED') coverage.contextPeriods = { latest30: contextPeriod(0), previous30: contextPeriod(30) };
          const input: AssessmentInput = { asOf: isoDay(asOf), calculatedAt: new Date().toISOString(), accountId: account.id, organizationId, name: account.name,
            suppressed: Boolean(overlay?.opportunitySuppressed || overlay?.active === false || account.tags.some(t => /DO.NOT.PURSUE/i.test(t.tag.name))),
            closed: account.isActive === false || validIdentity && research?.openStatus === 'Closed', buyerStructure: validIdentity ? research?.buyerStructure ?? null : null,
            nationalChain: account.tags.some(t => t.tag.name === 'NATIONAL_CHAIN') ? true : validIdentity ? research?.isNationalChain ?? null : null,
            researchAt: observedAt, researchIdentityValid: validIdentity, researchConfidence: research?.researchConfidence ?? null,
            cocktailProgram: research?.cocktailProgram ?? null, operatingStatus: research?.openStatus ?? null,
            scaleEvidence: publicEvidence.find(e => e.exactLocation && /traffic|capacity|attendance/i.test(e.field) && !/review|rating|patio|meeting/i.test(`${e.field} ${e.claim}`))?.claim ?? null,
            coverage, researchSignals: validIdentity ? storedResearchSignals(research, masters, excludedItemCodes) : undefined,
            products, purchases, uses: [...storedResearchUses(research?.identitySnapshot, observedAt, validIdentity), ...privateUses],
            lastVisitAt: visitMap.get(account.id)?.[0]?.visitAt.toISOString() ?? null, plannedWork: workMap.has(account.id) };
          const priorCoverage = previousCoverage;
          const correctedPeriodUnavailable = Boolean(priorCoverage?.representedFrom && priorCoverage.through && reports.some(r => {
            const date = isoDay(r.reportDate);
            return date >= priorCoverage.representedFrom! && date <= priorCoverage.through! && date >= isoDay(start90) && !completeDates.has(date);
          }));
          const blocked = identity === 'MATCHED' && (sourceFailed || correctedPeriodUnavailable || !selected.days && previous && previous.evidenceMode !== 'RESEARCH_ONLY');
          if (blocked) {
            sourceBlocked++;
            if (previous) {
              skipped++;
              errors.push({ accountId: account.id, message: 'Source refresh is unavailable; previous assessment retained.' });
              await markUnavailable(account.id, 'SOURCE_ERROR', 'Sales source failed or a corrected period is not captured. Last valid rating is retained.');
              return;
            }
          }
          const computed = assessWholesaleAccount(input);
          const assessment: Assessment = blocked ? { ...computed, rating: null, state: 'UNRATED', ratingReason: 'Sales source failed or is not captured; awaiting source recovery.', title: 'Commercial opportunity unavailable' } : computed;
          evaluated++;
          if (dryRun) { counts[assessment.evidenceMode]++; if (assessment.state === 'INELIGIBLE') ineligible++;
            previews.push({ accountId: account.id, name: account.name, assessment, previousPriority: account.currentAssessments[0]?.priority ?? pursuitMap.get(account.id)?.[0]?.productionScore ?? null,
            previousRating: previous?.rating ?? null, previousTitle: account.currentAssessments[0]?.title ?? pursuitMap.get(account.id)?.[0]?.title ?? null, input }); return; }
          writes.push({ organizationId, accountId: account.id, runId: runId!, configurationId, inputsReadAt: startedAt, assessment, ...(blocked ? { status: 'SOURCE_ERROR' } : {}) });
            // Only add shadow outcome observations. Never rewrite pursuit/detection/task state.
            for (const pursuit of pursuitMap.get(account.id) ?? []) {
              if (blocked || pursuit.status !== 'ACTIONED' || assessment.evidenceMode === 'RESEARCH_ONLY') continue;
              const metadata = pursuit.events[0]?.metadata as { hypothesis?: { targetProduct?: { itemCode?: string } } } | null;
              const code = metadata?.hypothesis?.targetProduct?.itemCode;
              if (!code || isRestaurantProductRestricted(code, excludedItemCodes)) continue;
              const priorOutcome = pursuit.outcomeSummary as { purchaseDates?: string[] } | null;
              const outcome = summarizePurchaseOutcome({ detectedAt: pursuit.detectedAt, asOf, purchaseDates: [...accountEvents.filter(e => e.itemCode === code).map(e => e.reportDate), ...(priorOutcome?.purchaseDates ?? []).map(d => new Date(d))], completeDates,
                baseline750: null, observed750: null, placementStatuses: (placementMap.get(account.id) ?? []).filter(p => p.product === code || p.product === products.find(x => x.itemCode === code)?.name).map(p => p.status) });
              outcomes.push({ id: pursuit.id, data: { outcomeSummary: outcome } });
            }

        } catch (error) {
          failed++; errors.push({ accountId: account.id, message: error instanceof Prisma.PrismaClientKnownRequestError ? `Database error ${error.code}` : 'Assessment failed; retry this account.' });
          await markUnavailable(account.id, 'ERROR', 'Recalculation failed; last valid assessment retained.').catch(() => undefined);
        }
      });
      const publish = async (batch: AssessmentWrite[]) => db.$transaction(async tx => {
        await renew(tx);
        const currentReports = await tx.ohlqReportImportStatus.findMany({ where: { dataSource: 'ANNUAL_SALES_SUMMARY_BY_WHOLESALE', reportDate: { gte: start90, lte: asOf } },
          select: { reportDate: true, status: true, updatedAt: true, rowCount: true } });
        if (sourceFingerprint(currentReports) !== inputsSourceRevision) throw new AssessmentSourceChangedError('Sales source changed while scoring; retry the score-only refresh.');
        const written = await persistAssessmentBatch(tx, batch);
        if (written !== batch.length) throw new Error('Assessment batch count mismatch; retry.');
        for (const outcome of outcomes.filter(o => batch.some(w => (pursuitMap.get(w.accountId) ?? []).some(p => p.id === o.id)))) {
          await tx.salesOpportunity.update({ where: { id: outcome.id }, data: outcome.data });
        }
      }, { timeout: 30_000 });
      const counted = (batch: AssessmentWrite[]) => { for (const w of batch) { persisted++; counts[w.assessment.evidenceMode]++; if (w.assessment.state === 'INELIGIBLE') ineligible++; } };
      if (writes.length) {
        try { await publish(writes); counted(writes); }
        catch (error) {
          if (error instanceof AssessmentSourceChangedError) throw error;
          // Isolate a bad row while recording partial coverage, without losing the rest.
          for (const write of writes) try { await publish([write]); counted([write]); }
          catch (error) { if (error instanceof AssessmentSourceChangedError) throw error;
            failed++; errors.push({ accountId: write.accountId, message: 'Persistence failed; retry this account.' });
            await markUnavailable(write.accountId, 'ERROR', 'Persistence failed; last valid assessment retained.').catch(() => undefined); }
        }
      }
      if (runId) await db.wholesaleAssessmentRun.update({ where: { id: runId }, data: { evaluated, persisted, ineligible, skipped, failed, evidenceCounts: counts, errors: json(errors.slice(0,100)) } });
      console.log(`Restaurant assessments ${organizationId}: ${persisted}/${expected} persisted; ${failed} failed.`);
    }
    if (!dryRun && persisted + skipped + failed !== expected) errors.push({ message: 'Account count changed during refresh; a full retry is required.' });
    if (runId) await db.wholesaleAssessmentRun.update({ where: { id: runId }, data: { activeKey: null, leaseUntil: null, status: failed || persisted + skipped !== expected ? 'PARTIAL' : sourceBlocked ? 'SOURCE_ERROR' : 'COMPLETED', completedAt: new Date(), errors: json(errors.slice(0,100)) } });
    return result();
  } catch (error) {
    if (error instanceof AssessmentSourceChangedError && !dryRun) {
      await db.$transaction(async tx => {
        await renew(tx);
        await tx.wholesaleAccountAssessment.updateMany({ where: { organizationId, ...(accountIds ? { wholesaleAccountId: { in: accountIds } } : {}) },
          data: { assessmentStatus: 'SOURCE_ERROR', assessmentReason: 'Sales source changed during recalculation; cached rating retained until score-only retry.', refreshRequestedAt: new Date() } });
      }).catch(() => undefined);
    }
    if (runId) await db.wholesaleAssessmentRun.update({ where: { id: runId }, data: { activeKey: null, leaseUntil: null, status: 'FAILED', completedAt: new Date(), evaluated, persisted, failed: Math.max(failed, expected - persisted), errors: [{ message: 'Refresh failed; use score-only retry.' }] } });
    throw error;
  }
}

export async function runWholesaleAssessmentSweep({ db = prisma, reportDate = new Date() }: { db?: PrismaClient; reportDate?: Date } = {}) {
  const organizations = await db.organization.findMany({ where: enabledAssessmentTenants, select: { id: true } });
  const results = [];
  const failures: string[] = [];
  for (const organization of organizations) {
    if (organization.id !== ECHO_ORGANIZATION_ID) continue;
    try {
      const intelligence = await evaluateWholesaleAssessments({ db, asOfDate: reportDate, organizationId: organization.id, reconcileLedger: true });
      results.push({ organizationId: organization.id, intelligence });
      if (intelligence.failed || intelligence.sourceBlocked || intelligence.persisted !== intelligence.expected) failures.push(organization.id);
    } catch { failures.push(organization.id); }
  }
  if (failures.length) throw new Error(`Restaurant assessment refresh incomplete for ${failures.length} tenant(s): ${failures.join(', ')}. Inspect assessment runs and retry scoring; research was not requested.`);
  return { organizations: results, salesEvents: { created: 0, skippedWithoutBaseline: false }, intelligence: {
    accountsEvaluated: results.reduce((n,r) => n + r.intelligence.evaluated, 0), persisted: results.reduce((n,r) => n + r.intelligence.persisted, 0),
    detected: 0, converted: 0, worklistCreated: 0, rulesVersion: ASSESSMENT_VERSION, scoringVersion: ASSESSMENT_VERSION } };
}

/** Ingestion health changes freshness only. A failed historical backfill must not
 * mark a newer current feed as failed, and no rating or pursuit is rewritten. */
export async function markWholesaleAssessmentSourceFailure({ db = prisma, reportDate }: { db?: PrismaClient; reportDate: Date }) {
  const latest = await db.ohlqReportImportStatus.findFirst({ where: { dataSource: 'ANNUAL_SALES_SUMMARY_BY_WHOLESALE', status: 'COMPLETED' }, orderBy: { reportDate: 'desc' }, select: { reportDate: true } });
  if (latest && latest.reportDate > reportDate) return { count: 0 };
  const organizations = await db.organization.findMany({ where: enabledAssessmentTenants, select: { id: true } });
  return db.wholesaleAccountAssessment.updateMany({ where: { organizationId: { in: organizations.filter(o => o.id === ECHO_ORGANIZATION_ID).map(o => o.id) }, evidenceMode: { in: ['SALES_BACKED', 'PARTIAL_SALES'] } },
    data: { assessmentStatus: 'SOURCE_ERROR', assessmentReason: 'Latest restaurant sales import failed; last valid commercial rating retained until recovery.', refreshRequestedAt: new Date() } });
}
