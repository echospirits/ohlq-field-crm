import { createHash } from 'crypto';
import { OpportunityEventType, OpportunityRankingMode, OpportunityStatus, WorklistCategory, WorklistSource, WorklistStatus, type PrismaClient } from '@prisma/client';
import { prisma } from './prisma';
import { getOrganizationTenantConfig, matchesTenantProduct } from './tenantConfig';
import { catalogLiters, compareWithBuyers, toAffinityProduct, type BuyerBasket } from './opportunityAffinity';
import { learnedAdjustment, labelMatureOutcome, outcomeSegment, trainOutcomeModel, type OutcomeExample } from './opportunityLearning';
import { buildDailyPurchaseEvents } from './opportunitySalesLedger';
import { normalizeOpportunityCategory, OPPORTUNITY_RANKING_VERSION, OPPORTUNITY_RULES_VERSION, OPPORTUNITY_SIGNAL_VERSION, opportunityRules } from './opportunityConfig';
import { detectOpportunityHypotheses, RuleBasedOpportunityRanker, selectPrimaryOpportunity, type AccountOpportunitySignals } from './opportunityIntelligence';
import { ECHO_ORGANIZATION_ID } from './organizations';

const DAY = 86400000;
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
const daysBetween = (later: Date, earlier?: Date | null) => earlier ? Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / DAY)) : null;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const numberValue = (value: unknown) => value === null || value === undefined ? null : Number(value);
const stringList = (value: unknown) => Array.isArray(value) ? value.map(String).filter(Boolean) : [];
const activeOpportunityStatuses = [OpportunityStatus.OPEN, OpportunityStatus.ACTIONED, OpportunityStatus.SNOOZED];

export async function captureWholesaleSalesEvents({ db = prisma, reportDate, organizationId = ECHO_ORGANIZATION_ID }: { db?: PrismaClient; reportDate: Date; organizationId?: string }) {
  const config = await getOrganizationTenantConfig(organizationId, db);
  config.productFilter.mode = 'item-list';
  const [currentRows, accounts, masters] = await Promise.all([
    db.ohlqAnnualSalesByWholesaleRow.findMany({ where: { reportDate } }),
    db.wholesaleAccount.findMany({ where: { mergedIntoId: null }, select: { id: true, licenseeId: true, licenseeIds: { select: { licenseeId: true } } } }),
    db.ohlqBrandMasterItem.findMany({ select: { itemCode: true, name: true, category: true } }),
  ]);
  const data = buildDailyPurchaseEvents(currentRows, accounts, masters, config);
  let created = 0;
  for (let i = 0; i < data.length; i += 1000) created += (await db.accountSalesEvent.createMany({ skipDuplicates: true, data: data.slice(i, i + 1000) })).count;
  return { created, skippedWithoutBaseline: false };
}

const eventKey = (type: OpportunityEventType, suffix: string) => `${type}:${suffix}`;

export async function evaluateOpportunityIntelligence({ db = prisma, asOfDate = new Date(), accountIds, organizationId = ECHO_ORGANIZATION_ID, dryRun = false }: { db?: PrismaClient; asOfDate?: Date; accountIds?: string[]; organizationId?: string; dryRun?: boolean } = {}) {
  const start90 = new Date(asOfDate.getTime() - 89 * DAY);
  const config = await getOrganizationTenantConfig(organizationId, db);
  config.productFilter.mode = 'item-list';
  const [catalog, productDecisions, identities, rawRows, historic, overlays] = await Promise.all([
    db.ohlqBrandMasterItem.findMany(),
    db.organizationProduct.findMany({ where: { organizationId, active: true, market: 'OH', discontinued: false, status: { in: ['OWNED', 'REPRESENTED'] } } }),
    db.wholesaleAccount.findMany({ where: { mergedIntoId: null }, select: { id: true, licenseeId: true, licenseeIds: { select: { licenseeId: true } } } }),
    db.ohlqAnnualSalesByWholesaleRow.findMany({ where: { reportDate: { gte: start90, lte: asOfDate } }, select: { reportDate: true, permitNumber: true, agencyId: true, vendor: true, brand: true, wholesaleBottlesSold: true } }),
    db.salesOpportunity.findMany({ where: { organizationId, rulesVersion: OPPORTUNITY_RULES_VERSION, detectedAt: { lte: new Date(asOfDate.getTime() - 90 * DAY) } }, select: { wholesaleAccountId: true, detectedAt: true, convertedAt: true, type: true, signalSnapshot: true, events: { where: { eventType: 'DETECTED' }, select: { metadata: true }, take: 1 } } }),
    db.organizationAccountOverlay.findMany({ where: { organizationId, accountType: 'WHOLESALE' } }),
  ]);
  const masterByCode = new Map(catalog.map(c => [c.itemCode,c]));
  const portfolio = productDecisions.flatMap(p => { const master = masterByCode.get(p.externalItemCode); return master ? [toAffinityProduct(master, p.strategicPriority ?? 1)] : []; });
  const oldestDetection = historic.length ? new Date(Math.min(...historic.map(h => h.detectedAt.getTime()))) : asOfDate;
  const [outcomePurchases, completedReports, ledgerDates] = historic.length ? await Promise.all([
    db.accountSalesEvent.findMany({ where: { organizationId, sourceKey: { startsWith: 'DAILY_V3:' }, wholesaleAccountId: { in: historic.map(h => h.wholesaleAccountId) }, reportDate: { gte: oldestDetection, lte: asOfDate } }, select: { wholesaleAccountId: true, itemCode: true, reportDate: true } }),
    db.ohlqReportImportStatus.findMany({ where: { dataSource: 'ANNUAL_SALES_SUMMARY_BY_WHOLESALE', status: 'COMPLETED', reportDate: { gte: oldestDetection, lte: asOfDate } }, select: { reportDate: true, rowCount: true } }),
    db.accountSalesEvent.findMany({ where: { organizationId, sourceKey: { startsWith: 'DAILY_V3:' }, reportDate: { gte: oldestDetection, lte: asOfDate } }, distinct: ['reportDate'], select: { reportDate: true } }),
  ]) : [[], [], []];
  const capturedDates = new Set(ledgerDates.map(r => dateOnly(r.reportDate)));
  const completeDates = new Set(completedReports.filter(r => r.rowCount === 0 || capturedDates.has(dateOnly(r.reportDate))).map(r => dateOnly(r.reportDate)));
  const examples: OutcomeExample[] = historic.flatMap(row => {
    const metadata = row.events[0]?.metadata as unknown as { hypothesis?: ReturnType<typeof detectOpportunityHypotheses>[number]; signalVersion?: string } | null;
    if (metadata?.signalVersion !== OPPORTUNITY_SIGNAL_VERSION || !metadata.hypothesis?.targetProduct) return [];
    const key = outcomeSegment(row.signalSnapshot as unknown as AccountOpportunitySignals, metadata.hypothesis);
    const purchasedAt = outcomePurchases.filter(p => p.wholesaleAccountId === row.wholesaleAccountId && p.itemCode === metadata.hypothesis!.targetProduct!.itemCode).map(p => p.reportDate);
    const converted = labelMatureOutcome(row.detectedAt, asOfDate, completeDates, purchasedAt);
    return key && converted !== null ? [{ accountId: row.wholesaleAccountId, detectedAt: row.detectedAt.toISOString(), converted, key }] : [];
  });
  const learning = trainOutcomeModel(examples);
  const [accounts, savedEvents, visits, worklist] = await Promise.all([
    db.wholesaleAccount.findMany({
      where: { mergedIntoId: null, ...(accountIds?.length ? { id: { in: accountIds } } : {}) },
      select: {
        id: true,
        name: true,
        targetProfiles: { where: { organizationId }, take: 1, select: { assignedUserId: true, researchStatus: true, ownershipGroup: { select: { name: true } } } },
        targetPublicResearch: { select: { patioOutdoor: true, cocktailProgram: true, popularitySignal: true, ownershipVerification: true, buyerStructure: true, isNationalChain: true, googleRating: true, googleReviewCount: true, yelpRating: true, yelpReviewCount: true, localBrandsOnMenu: true, sourceUrls: true } },
        tags: { where: { organizationId }, select: { tag: { select: { name: true } } } },
        opportunitySignals: { where: { organizationId }, take: 1 },
      },
    }),
    db.accountSalesEvent.findMany({ where: { organizationId, sourceKey: { startsWith: 'DAILY_V3:' }, reportDate: { gte: start90, lte: asOfDate } }, orderBy: { reportDate: 'asc' } }),
    db.loggedVisit.findMany({ where: { organizationId, locationType: 'wholesale', wholesaleAccountId: { not: null }, visitAt: { lte: asOfDate } }, orderBy: { visitAt: 'asc' }, select: { id: true, wholesaleAccountId: true, visitAt: true } }),
    db.worklistItem.findMany({ where: { organizationId, wholesaleAccountId: { not: null }, status: { in: [WorklistStatus.OPEN, WorklistStatus.IN_PROGRESS] } }, select: { wholesaleAccountId: true } }),
  ]);
  // Reconstruct retained daily reports and prefer their corrected quantities over
  // ledger copies. Never train on the legacy cumulative-delta interpretation.
  const dailyEvents = buildDailyPurchaseEvents(rawRows, identities, catalog, config);
  if (!dryRun) {
    const savedKeys = new Set(savedEvents.map(e => e.sourceKey));
    const missing = dailyEvents.filter(e => !savedKeys.has(e.sourceKey));
    for (let i = 0; i < missing.length; i += 1000) await db.accountSalesEvent.createMany({ skipDuplicates: true, data: missing.slice(i, i + 1000) });
  }
  const events = [...new Map([...savedEvents, ...dailyEvents].map(e => [e.sourceKey, e])).values()]
    .map(e => ({ ...e, isTenantProduct: matchesTenantProduct({ config, vendor: e.vendor, itemCode: e.itemCode }) }))
    .sort((a,b) => a.reportDate.getTime() - b.reportDate.getTime());
  const eventsByAccount = new Map<string, typeof events>();
  events.forEach((event) => eventsByAccount.set(event.wholesaleAccountId, [...(eventsByAccount.get(event.wholesaleAccountId) ?? []), event]));
  const purchasesByAccount = new Map<string, AccountOpportunitySignals['purchases']>();
  for (const [id, accountEvents] of eventsByAccount) {
    const items = new Map<string, typeof accountEvents>();
    accountEvents.forEach(e => items.set(e.itemCode, [...(items.get(e.itemCode) ?? []), e]));
    purchasesByAccount.set(id, [...items].map(([itemCode, itemEvents]) => {
      const sample = itemEvents[0]; const master = masterByCode.get(itemCode); const detail = master ? toAffinityProduct(master) : null;
      const sumSince = (days: number) => itemEvents.filter(e => e.reportDate >= new Date(asOfDate.getTime() - (days - 1) * DAY)).reduce((n,e) => n + e.bottles, 0);
      return { itemCode, itemName: master?.name ?? sample.itemName, category: detail?.category ?? normalizeOpportunityCategory(sample.category, sample.itemName),
        isEcho: sample.isTenantProduct, lastPurchaseAt: dateOnly(itemEvents.at(-1)!.reportDate), bottles30: sumSince(30), bottles60: sumSince(60), bottles90: sumSince(90),
        currentAnnualBottles: sumSince(90), price750: detail?.price750 ?? null, liters: catalogLiters(master?.productVolume) ?? .75, isLocal: detail?.isLocal ?? false };
    }));
  }
  const buyerCohorts = new Map<string, BuyerBasket[]>();
  for (const [accountId, purchases] of purchasesByAccount) for (const p of purchases.filter(p => p.isEcho && p.bottles90 >= 2)) {
    buyerCohorts.set(p.itemCode, [...(buyerCohorts.get(p.itemCode) ?? []), { accountId, purchases }]);
  }
  const visitsByAccount = new Map<string, typeof visits>();
  visits.forEach((visit) => visitsByAccount.set(visit.wholesaleAccountId!, [...(visitsByAccount.get(visit.wholesaleAccountId!) ?? []), visit]));
  const openWork = new Map<string, number>();
  worklist.forEach((item) => openWork.set(item.wholesaleAccountId!, (openWork.get(item.wholesaleAccountId!) ?? 0) + 1));
  const ranker = new RuleBasedOpportunityRanker();
  let detected = 0; let converted = 0; let worklistCreated = 0;
  const previews: { accountId: string; name: string; primary: ReturnType<typeof selectPrimaryOpportunity>; alternatives: { item: string; score: number; peers: unknown; factors: string[] }[]; purchases: AccountOpportunitySignals['purchases'] }[] = [];

  const modelName = `${organizationId}:PriceAffinityRanker`;
  const modelVersion = `${OPPORTUNITY_RANKING_VERSION}:${hash(JSON.stringify(portfolio)).slice(0,12)}:${learning.version}`;
  let model = dryRun ? null : await db.opportunityModelVersion.findFirst({ where: { name: modelName, version: modelVersion, mode: OpportunityRankingMode.ACTIVE } });
  if (!dryRun) {
    model ??= await db.opportunityModelVersion.create({ data: { name: modelName, version: modelVersion, mode: OpportunityRankingMode.ACTIVE, configuration: { organizationId, portfolio, learning }, evaluation: learning, activatedAt: asOfDate } });
    await db.salesOpportunity.updateMany({ where: { organizationId, status: OpportunityStatus.SNOOZED, snoozedUntil: { lte: asOfDate } }, data: { status: OpportunityStatus.OPEN, snoozedUntil: null } });
  }

  for (const account of accounts) {
    const overlay = overlays.find(o => o.externalAccountId === account.id);
    const targetProfile = account.targetProfiles[0];
    const opportunitySignal = account.opportunitySignals[0];
    const accountEvents = eventsByAccount.get(account.id) ?? [];
    const accountVisits = visitsByAccount.get(account.id) ?? [];
    const lastVisit = accountVisits.at(-1)?.visitAt ?? null;
    const purchases = purchasesByAccount.get(account.id) ?? [];
    const echoEvents = accountEvents.filter((event) => event.isTenantProduct);
    const firstObserved = (opportunitySignal?.signalVersion === OPPORTUNITY_SIGNAL_VERSION ? opportunitySignal.firstEchoPurchaseAt : null) ?? echoEvents[0]?.reportDate ?? null;
    const lastEcho = echoEvents.at(-1)?.reportDate ?? null;
    const research = account.targetPublicResearch;
    const normalizedTags = new Set(account.tags.map(({ tag }) => tag.name.toUpperCase().replace(/[\s-]+/g, '_')));
    const signal: AccountOpportunitySignals = {
      organizationId, productLabel: config.productLabel, portfolio, observedSince: events[0] ? dateOnly(events[0].reportDate) : null,
      peerEvidence: Object.fromEntries(portfolio.map(p => [p.itemCode, compareWithBuyers(account.id, purchases, p, buyerCohorts.get(p.itemCode) ?? [])])),
      accountName: account.name, asOfDate: dateOnly(asOfDate), accountStatus: normalizedTags.has('DO_NOT_PURSUE') || overlay?.opportunitySuppressed || overlay?.active === false ? 'DO_NOT_PURSUE' : 'ACTIVE',
      assignedUserId: overlay?.assignedUserId ?? targetProfile?.assignedUserId ?? null, daysSinceLastEchoPurchase: daysBetween(asOfDate, lastEcho), daysSinceLastVisit: daysBetween(asOfDate, lastVisit),
      echoBottles30: echoEvents.filter((e) => e.reportDate >= new Date(asOfDate.getTime() - 29 * DAY)).reduce((n, e) => n + e.bottles, 0),
      echoBottles60: echoEvents.filter((e) => e.reportDate >= new Date(asOfDate.getTime() - 59 * DAY)).reduce((n, e) => n + e.bottles, 0), echoBottles90: echoEvents.reduce((n, e) => n + e.bottles, 0), echoPurchaseEvents90: echoEvents.length,
      firstEchoPurchaseAt: firstObserved ? dateOnly(firstObserved) : null, historyComplete: opportunitySignal?.signalVersion === OPPORTUNITY_SIGNAL_VERSION && opportunitySignal.historyComplete || false,
      lastEchoPurchaseAt: lastEcho ? dateOnly(lastEcho) : null, lastVisitAt: lastVisit?.toISOString() ?? null, openWorklistCount: openWork.get(account.id) ?? 0, purchases,
      targetStatus: overlay?.targetStatus ?? targetProfile?.researchStatus ?? null, visits30: accountVisits.filter((v) => v.visitAt >= new Date(asOfDate.getTime() - 29 * DAY)).length,
      visits60: accountVisits.filter((v) => v.visitAt >= new Date(asOfDate.getTime() - 59 * DAY)).length, visits90: accountVisits.filter((v) => v.visitAt >= start90).length,
      targetDataScore: null, targetPublicFitScore: null,
      targetPriceFitPercent: null, targetTotalVolumePercentile: null,
      targetConsistencyScore: null, targetMomentumScore: null,
      ohioCraft9L: null, ohioCraftAffinity: null,
      ownershipGroupName: targetProfile?.ownershipGroup?.name ?? null,
      isNationalChain: normalizedTags.has('NATIONAL_CHAIN') ? true : normalizedTags.has('LOCAL_INDEPENDENT') ? false : research?.isNationalChain ?? null,
      ownershipVerification: research?.ownershipVerification ?? null, buyerStructure: research?.buyerStructure ?? null,
      patioOutdoor: research?.patioOutdoor ?? null, cocktailProgram: research?.cocktailProgram ?? null, popularitySignal: research?.popularitySignal ?? null,
      googleRating: numberValue(research?.googleRating), googleReviewCount: research?.googleReviewCount ?? null,
      yelpRating: numberValue(research?.yelpRating), yelpReviewCount: research?.yelpReviewCount ?? null,
      localBrandsOnMenu: stringList(research?.localBrandsOnMenu), publicResearchSourceUrls: stringList(research?.sourceUrls),
    };
    const hypotheses = detectOpportunityHypotheses(signal);
    signal.learningAdjustment = Object.fromEntries(hypotheses.flatMap(h => h.targetProduct ? [[h.targetProduct.itemCode, learnedAdjustment(learning, outcomeSegment(signal, h))]] : []));
    const primary = selectPrimaryOpportunity(hypotheses, signal, ranker);
    if (dryRun) { previews.push({ accountId: account.id, name: account.name, primary, alternatives: hypotheses.filter(h => h.targetProduct).map(h => ({ item: h.targetProduct!.name, score: ranker.rank(h,signal).score, peers: signal.peerEvidence?.[h.targetProduct!.itemCode], factors: ranker.rank(h,signal).factors })), purchases }); continue; }
    await db.opportunityAccountSignal.upsert({ where: { organizationId_wholesaleAccountId: { organizationId, wholesaleAccountId: account.id } }, create: { organizationId, wholesaleAccountId: account.id, asOfDate, signalVersion: OPPORTUNITY_SIGNAL_VERSION, features: signal, firstEchoPurchaseAt: firstObserved, lastEchoPurchaseAt: lastEcho, historyComplete: false }, update: { asOfDate, signalVersion: OPPORTUNITY_SIGNAL_VERSION, features: signal, firstEchoPurchaseAt: firstObserved, lastEchoPurchaseAt: lastEcho } });
    if (primary) {
      let { hypothesis, ranking } = primary;
      const active = await db.salesOpportunity.findMany({
        where: { organizationId, wholesaleAccountId: account.id, status: { in: activeOpportunityStatuses } },
        orderBy: [{ actionedAt: 'asc' }, { productionScore: 'desc' }, { detectedAt: 'asc' }],
      });
      const statusOrder = new Map<OpportunityStatus, number>([[OpportunityStatus.ACTIONED, 0], [OpportunityStatus.SNOOZED, 1], [OpportunityStatus.OPEN, 2]]);
      active.sort((left, right) => (statusOrder.get(left.status) ?? 9) - (statusOrder.get(right.status) ?? 9) || right.productionScore - left.productionScore || left.detectedAt.getTime() - right.detectedAt.getTime());
      let opportunity = active[0];
      const duplicates = active.slice(1);
      if (opportunity && duplicates.length > 0) {
        for (const duplicate of duplicates) {
          await db.worklistItem.updateMany({ where: { organizationId, salesOpportunityId: duplicate.id }, data: { salesOpportunityId: opportunity.id } });
          await db.salesOpportunity.update({ where: { id: duplicate.id }, data: { status: OpportunityStatus.RESOLVED, activeAccountKey: null, resolvedAt: asOfDate } });
          await db.opportunityEvent.create({ data: { organizationId, opportunityId: duplicate.id, eventType: OpportunityEventType.RESOLVED, eventKey: 'RESOLVED:DEDUPED_V2', wholesaleAccountId: account.id, metadata: { deduplicatedIntoOpportunityId: opportunity.id }, occurredAt: asOfDate } }).catch(() => undefined);
        }
        const duplicateTasks = await db.worklistItem.findMany({ where: { organizationId, salesOpportunityId: opportunity.id, status: { in: [WorklistStatus.OPEN, WorklistStatus.IN_PROGRESS] } }, orderBy: { createdAt: 'asc' }, select: { id: true } });
        if (duplicateTasks.length > 1) await db.worklistItem.updateMany({ where: { id: { in: duplicateTasks.slice(1).map((item) => item.id) } }, data: { status: WorklistStatus.CANCELLED, cancelledAt: asOfDate } });
      }
      if (opportunity) {
        const detection = await db.opportunityEvent.findFirst({ where: { organizationId, opportunityId: opportunity.id, eventType: 'DETECTED' }, select: { metadata: true } });
        const original = (detection?.metadata as unknown as { hypothesis?: typeof hypothesis } | null)?.hypothesis;
        if (original?.targetProduct) {
          hypothesis = { ...original, targetProduct: portfolio.find(p => p.itemCode === original.targetProduct!.itemCode) ?? original.targetProduct };
          ranking = ranker.rank(hypothesis, signal);
        }
        // Detection features remain immutable for honest outcome learning. Current
        // features live in OpportunityAccountSignal, not the historical snapshot.
        opportunity = await db.salesOpportunity.update({ where: { id: opportunity.id }, data: { activeAccountKey: `${organizationId}:${account.id}`, type: hypothesis.type, cycleKey: hypothesis.cycleKey, targetCategory: hypothesis.targetCategory, title: hypothesis.title, recommendedAction: hypothesis.recommendedAction, explanation: ranking.factors, scoringVersion: ranking.version, productionScore: ranking.score, priorityBand: ranking.priorityBand, lastDetectedAt: asOfDate } });
      } else {
        const previouslyClosed = await db.salesOpportunity.findFirst({
          where: { organizationId, wholesaleAccountId: account.id, type: hypothesis.type, cycleKey: hypothesis.cycleKey },
          select: { id: true },
        });
        if (previouslyClosed) continue;
        opportunity = await db.salesOpportunity.create({ data: { organizationId, wholesaleAccountId: account.id, activeAccountKey: `${organizationId}:${account.id}`, type: hypothesis.type, cycleKey: hypothesis.cycleKey, targetCategory: hypothesis.targetCategory, title: hypothesis.title, recommendedAction: hypothesis.recommendedAction, explanation: ranking.factors, signalSnapshot: signal, rulesVersion: OPPORTUNITY_RULES_VERSION, scoringVersion: ranking.version, productionScore: ranking.score, priorityBand: ranking.priorityBand, assignedToUserId: signal.assignedUserId, detectedAt: asOfDate, lastDetectedAt: asOfDate } });
        detected++;
        await db.opportunityEvent.create({ data: { organizationId, opportunityId: opportunity.id, eventType: OpportunityEventType.DETECTED, eventKey: eventKey(OpportunityEventType.DETECTED, hypothesis.cycleKey), wholesaleAccountId: account.id, metadata: { explanation: ranking.factors, rulesVersion: OPPORTUNITY_RULES_VERSION, signalVersion: OPPORTUNITY_SIGNAL_VERSION, hypothesis }, occurredAt: asOfDate } });
      }
      await db.opportunityScore.upsert({ where: { opportunityId_modelVersionId: { opportunityId: opportunity.id, modelVersionId: model!.id } }, create: { opportunityId: opportunity.id, modelVersionId: model!.id, mode: OpportunityRankingMode.ACTIVE, score: ranking.score, priorityBand: ranking.priorityBand, factors: ranking.factors }, update: { score: ranking.score, priorityBand: ranking.priorityBand, factors: ranking.factors, scoredAt: asOfDate } });
      if (opportunityRules.autoCreateWorklist[hypothesis.type] && !await db.worklistItem.findFirst({ where: { organizationId, salesOpportunityId: opportunity.id } })) {
        const task = await db.worklistItem.create({ data: { organizationId, title: hypothesis.recommendedAction, detail: ranking.factors.join('\n'), status: WorklistStatus.OPEN, source: WorklistSource.OPPORTUNITY_INTELLIGENCE, category: WorklistCategory.WHOLESALE, wholesaleAccountId: account.id, salesOpportunityId: opportunity.id, assignedToUserId: signal.assignedUserId, dueDate: new Date(asOfDate.getTime() + 7 * DAY), createdBy: 'Opportunity intelligence' } });
        await db.opportunityEvent.create({ data: { organizationId, opportunityId: opportunity.id, eventType: OpportunityEventType.WORKLIST_CREATED, eventKey: eventKey(OpportunityEventType.WORKLIST_CREATED, task.id), wholesaleAccountId: account.id, worklistItemId: task.id, occurredAt: asOfDate } }); worklistCreated++;
      }
    }

    const openOpportunities = await db.salesOpportunity.findMany({ where: { organizationId, wholesaleAccountId: account.id, status: { in: [OpportunityStatus.OPEN, OpportunityStatus.ACTIONED] } } });
    for (const opportunity of openOpportunities) {
      const detection = await db.opportunityEvent.findFirst({ where: { organizationId, opportunityId: opportunity.id, eventType: 'DETECTED' }, select: { metadata: true } });
      const targetItemCode = (detection?.metadata as unknown as { hypothesis?: { targetProduct?: { itemCode: string } } } | null)?.hypothesis?.targetProduct?.itemCode;
      const subsequent = accountEvents.filter((e) => e.reportDate > opportunity.detectedAt && e.isTenantProduct && (targetItemCode ? e.itemCode === targetItemCode : !opportunity.targetCategory || normalizeOpportunityCategory(masterByCode.get(e.itemCode)?.category ?? e.category, e.itemName) === opportunity.targetCategory));
      const visit = accountVisits.find((v) => v.visitAt > opportunity.detectedAt);
      const salesConversion = opportunity.type !== 'NO_RECENT_TOUCH' && subsequent[0];
      const touchResolution = opportunity.type === 'NO_RECENT_TOUCH' && visit;
      if (salesConversion || touchResolution) {
        const occurredAt = salesConversion ? salesConversion.reportDate : visit!.visitAt;
        const status = salesConversion ? OpportunityStatus.CONVERTED : OpportunityStatus.RESOLVED;
        await db.salesOpportunity.update({ where: { id: opportunity.id }, data: { status, activeAccountKey: null, convertedAt: salesConversion ? occurredAt : null, resolvedAt: occurredAt, conversionPurchaseAt: salesConversion ? occurredAt : null, conversionVisitId: visit?.id } });
        await db.opportunityEvent.create({ data: { organizationId, opportunityId: opportunity.id, eventType: salesConversion ? OpportunityEventType.CONVERTED : OpportunityEventType.RESOLVED, eventKey: eventKey(salesConversion ? OpportunityEventType.CONVERTED : OpportunityEventType.RESOLVED, dateOnly(occurredAt)), wholesaleAccountId: account.id, loggedVisitId: visit?.id, purchaseReportDate: salesConversion ? occurredAt : null, occurredAt } }).catch(() => undefined);
        await db.worklistItem.updateMany({ where: { organizationId, salesOpportunityId: opportunity.id, status: { in: [WorklistStatus.OPEN, WorklistStatus.IN_PROGRESS] } }, data: { status: WorklistStatus.COMPLETED, completedAt: occurredAt } }); converted++;
      } else if (daysBetween(asOfDate, opportunity.detectedAt)! >= opportunityRules.expirationDays) {
        await db.salesOpportunity.update({ where: { id: opportunity.id }, data: { status: OpportunityStatus.EXPIRED, activeAccountKey: null, expiredAt: asOfDate, resolvedAt: asOfDate } });
        await db.opportunityEvent.create({ data: { organizationId, opportunityId: opportunity.id, eventType: OpportunityEventType.EXPIRED, eventKey: eventKey(OpportunityEventType.EXPIRED, dateOnly(asOfDate)), wholesaleAccountId: account.id, occurredAt: asOfDate } }).catch(() => undefined);
      }
    }
  }
  return { accountsEvaluated: accounts.length, detected, converted, worklistCreated, rulesVersion: OPPORTUNITY_RULES_VERSION, scoringVersion: OPPORTUNITY_RANKING_VERSION, learning, ...(dryRun ? { previews } : {}) };
}

export async function runOpportunityIntelligenceAfterImport({ db = prisma, reportDate }: { db?: PrismaClient; reportDate: Date }) {
  const organizations = await db.organization.findMany({
    where: { active: true, features: { some: { enabled: true, featureKey: 'WHOLESALE_OPPORTUNITIES' } } },
    select: { id: true },
  });
  if (!organizations.length) return { salesEvents: { created: 0, skippedWithoutBaseline: false }, intelligence: { accountsEvaluated: 0, detected: 0, converted: 0, worklistCreated: 0, rulesVersion: OPPORTUNITY_RULES_VERSION, scoringVersion: OPPORTUNITY_RANKING_VERSION }, skipped: true, reason: 'WHOLESALE_OPPORTUNITIES disabled' };
  const results = [];
  for (const organization of organizations) {
    const salesEvents = await captureWholesaleSalesEvents({ db, reportDate, organizationId: organization.id });
    const intelligence = await evaluateOpportunityIntelligence({ db, asOfDate: reportDate, organizationId: organization.id });
    results.push({ organizationId: organization.id, salesEvents, intelligence });
  }
  return {
    organizations: results,
    salesEvents: { created: results.reduce((total, row) => total + row.salesEvents.created, 0), skippedWithoutBaseline: results.every((row) => row.salesEvents.skippedWithoutBaseline) },
    intelligence: {
      accountsEvaluated: results.reduce((total, row) => total + row.intelligence.accountsEvaluated, 0),
      detected: results.reduce((total, row) => total + row.intelligence.detected, 0),
      converted: results.reduce((total, row) => total + row.intelligence.converted, 0),
      worklistCreated: results.reduce((total, row) => total + row.intelligence.worklistCreated, 0),
      rulesVersion: OPPORTUNITY_RULES_VERSION,
      scoringVersion: OPPORTUNITY_RANKING_VERSION,
    },
  };
}
