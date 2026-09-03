import { createHash } from 'crypto';
import { OpportunityEventType, OpportunityRankingMode, OpportunityStatus, WorklistCategory, WorklistSource, WorklistStatus, type PrismaClient } from '@prisma/client';
import { prisma } from './prisma';
import { getOhlqLicenseeMatchKeys } from './ohlqWholesaleMatching';
import { isConfiguredTenantItem } from './ohlqSalesData';
import { normalizeOpportunityCategory, OPPORTUNITY_RANKING_VERSION, OPPORTUNITY_RULES_VERSION, OPPORTUNITY_SIGNAL_VERSION, opportunityRules } from './opportunityConfig';
import { detectOpportunityHypotheses, RuleBasedOpportunityRanker, selectPrimaryOpportunity, type AccountOpportunitySignals } from './opportunityIntelligence';
import { ECHO_ORGANIZATION_ID } from './organizations';

const DAY = 86400000;
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
const daysBetween = (later: Date, earlier?: Date | null) => earlier ? Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / DAY)) : null;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const numberValue = (value: unknown) => value === null || value === undefined ? null : Number(value);
const jsonNumber = (value: unknown, key: string) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return numberValue((value as Record<string, unknown>)[key]);
};
const stringList = (value: unknown) => Array.isArray(value) ? value.map(String).filter(Boolean) : [];
const activeOpportunityStatuses = [OpportunityStatus.OPEN, OpportunityStatus.ACTIONED, OpportunityStatus.SNOOZED];

export async function captureWholesaleSalesEvents({ db = prisma, reportDate, organizationId = ECHO_ORGANIZATION_ID }: { db?: PrismaClient; reportDate: Date; organizationId?: string }) {
  const previous = await db.ohlqAnnualSalesByWholesaleRow.findFirst({
    where: { reportDate: { lt: reportDate } }, orderBy: { reportDate: 'desc' }, select: { reportDate: true },
  });
  if (!previous) return { created: 0, skippedWithoutBaseline: true };
  const [currentRows, previousRows, accounts] = await Promise.all([
    db.ohlqAnnualSalesByWholesaleRow.findMany({ where: { reportDate } }),
    db.ohlqAnnualSalesByWholesaleRow.findMany({ where: { reportDate: previous.reportDate } }),
    db.wholesaleAccount.findMany({ where: { mergedIntoId: null }, select: { id: true, licenseeId: true, licenseeIds: { select: { licenseeId: true } } } }),
  ]);
  const accountByKey = new Map<string, string>();
  accounts.forEach((account) => [account.licenseeId, ...account.licenseeIds.map((v) => v.licenseeId)].forEach((id) =>
    getOhlqLicenseeMatchKeys(id).forEach((key) => accountByKey.set(key, account.id))));
  const previousByKey = new Map(previousRows.map((row) =>
    [`${row.permitNumber}|${row.agencyId}|${row.vendor}|${row.brand}`, row.wholesaleBottlesSold]));
  const positive = currentRows.flatMap((row) => {
    const accountId = getOhlqLicenseeMatchKeys(row.permitNumber).map((key) => accountByKey.get(key)).find(Boolean);
    const before = previousByKey.get(`${row.permitNumber}|${row.agencyId}|${row.vendor}|${row.brand}`) ?? 0;
    const bottles = row.wholesaleBottlesSold - before;
    return accountId && bottles > 0 ? [{ row, accountId, bottles }] : [];
  });
  const masters = await db.ohlqBrandMasterItem.findMany({
    where: { itemCode: { in: [...new Set(positive.map(({ row }) => row.brand))] } },
    select: { itemCode: true, name: true, category: true },
  });
  const masterByCode = new Map(masters.map((item) => [item.itemCode, item]));
  const result = await db.accountSalesEvent.createMany({
    skipDuplicates: true,
    data: positive.map(({ row, accountId, bottles }) => {
      const master = masterByCode.get(row.brand);
      const rawKey = `${organizationId}|${accountId}|${dateOnly(reportDate)}|${row.agencyId}|${row.vendor}|${row.brand}`;
      return {
        organizationId, wholesaleAccountId: accountId, reportDate, agencyId: row.agencyId, vendor: row.vendor,
        itemCode: row.brand, itemName: master?.name ?? 'Name pending', category: normalizeOpportunityCategory(master?.category, master?.name),
        bottles, annualBottlesAfter: row.wholesaleBottlesSold, isTenantProduct: isConfiguredTenantItem(row.vendor, row.brand), sourceKey: hash(rawKey),
      };
    }),
  });
  return { created: result.count, skippedWithoutBaseline: false };
}

const eventKey = (type: OpportunityEventType, suffix: string) => `${type}:${suffix}`;

export async function evaluateOpportunityIntelligence({ db = prisma, asOfDate = new Date(), accountIds, organizationId = ECHO_ORGANIZATION_ID }: { db?: PrismaClient; asOfDate?: Date; accountIds?: string[]; organizationId?: string } = {}) {
  const start90 = new Date(asOfDate.getTime() - 89 * DAY);
  const [accounts, events, visits, worklist] = await Promise.all([
    db.wholesaleAccount.findMany({
      where: { mergedIntoId: null, ...(accountIds?.length ? { id: { in: accountIds } } : {}) },
      select: {
        id: true,
        name: true,
        ohlqLastEchoPurchaseDate: true,
        targetProfiles: { where: { organizationId }, take: 1, select: { assignedUserId: true, researchStatus: true, ownershipGroup: { select: { name: true } } } },
        targetScores: { orderBy: { scoringDate: 'desc' }, take: 1, select: { dataScore: true, publicFitScore: true, componentScores: true } },
        targetMetrics: { orderBy: { periodEnd: 'desc' }, take: 1, select: { priceFitPercent: true, ohioCraft9L: true, ohioCraftAffinity: true, purchaseConsistency: true, momentumScore: true } },
        targetPublicResearch: { select: { patioOutdoor: true, cocktailProgram: true, popularitySignal: true, ownershipVerification: true, buyerStructure: true, isNationalChain: true, googleRating: true, googleReviewCount: true, yelpRating: true, yelpReviewCount: true, localBrandsOnMenu: true, sourceUrls: true } },
        tags: { where: { organizationId }, select: { tag: { select: { name: true } } } },
        opportunitySignals: { where: { organizationId }, take: 1 },
      },
    }),
    db.accountSalesEvent.findMany({ where: { organizationId, reportDate: { gte: start90, lte: asOfDate } }, orderBy: { reportDate: 'asc' } }),
    db.loggedVisit.findMany({ where: { organizationId, locationType: 'wholesale', wholesaleAccountId: { not: null }, visitAt: { lte: asOfDate } }, select: { id: true, wholesaleAccountId: true, visitAt: true } }),
    db.worklistItem.findMany({ where: { organizationId, wholesaleAccountId: { not: null }, status: { in: [WorklistStatus.OPEN, WorklistStatus.IN_PROGRESS] } }, select: { wholesaleAccountId: true } }),
  ]);
  const eventsByAccount = new Map<string, typeof events>();
  events.forEach((event) => eventsByAccount.set(event.wholesaleAccountId, [...(eventsByAccount.get(event.wholesaleAccountId) ?? []), event]));
  const visitsByAccount = new Map<string, typeof visits>();
  visits.forEach((visit) => visitsByAccount.set(visit.wholesaleAccountId!, [...(visitsByAccount.get(visit.wholesaleAccountId!) ?? []), visit]));
  const openWork = new Map<string, number>();
  worklist.forEach((item) => openWork.set(item.wholesaleAccountId!, (openWork.get(item.wholesaleAccountId!) ?? 0) + 1));
  const ranker = new RuleBasedOpportunityRanker();
  let detected = 0; let converted = 0; let worklistCreated = 0;

  let model = await db.opportunityModelVersion.findFirst({ where: { name: 'RuleBasedOpportunityRanker', version: OPPORTUNITY_RANKING_VERSION, mode: OpportunityRankingMode.ACTIVE } });
  model ??= await db.opportunityModelVersion.create({ data: { name: 'RuleBasedOpportunityRanker', version: OPPORTUNITY_RANKING_VERSION, mode: OpportunityRankingMode.ACTIVE, configuration: opportunityRules, activatedAt: asOfDate } });
  await db.salesOpportunity.updateMany({ where: { organizationId, status: OpportunityStatus.SNOOZED, snoozedUntil: { lte: asOfDate } }, data: { status: OpportunityStatus.OPEN, snoozedUntil: null } });

  for (const account of accounts) {
    const targetProfile = account.targetProfiles[0];
    const opportunitySignal = account.opportunitySignals[0];
    const accountEvents = eventsByAccount.get(account.id) ?? [];
    const accountVisits = visitsByAccount.get(account.id) ?? [];
    const lastVisit = accountVisits.at(-1)?.visitAt ?? null;
    const purchaseItems = new Map<string, (typeof accountEvents)[number][]>();
    accountEvents.forEach((event) => purchaseItems.set(event.itemCode, [...(purchaseItems.get(event.itemCode) ?? []), event]));
    const purchases = [...purchaseItems.entries()].map(([itemCode, itemEvents]) => {
      const sample = itemEvents[0]; const sumSince = (days: number) => itemEvents.filter((e) => e.reportDate >= new Date(asOfDate.getTime() - (days - 1) * DAY)).reduce((n, e) => n + e.bottles, 0);
      return { category: normalizeOpportunityCategory(sample.category, sample.itemName), itemCode, itemName: sample.itemName, isEcho: sample.isTenantProduct,
        lastPurchaseAt: dateOnly(itemEvents.at(-1)!.reportDate), bottles30: sumSince(30), bottles60: sumSince(60), bottles90: sumSince(90), currentAnnualBottles: itemEvents.at(-1)!.annualBottlesAfter };
    });
    const echoEvents = accountEvents.filter((event) => event.isTenantProduct);
    const firstObserved = opportunitySignal?.firstEchoPurchaseAt ?? echoEvents[0]?.reportDate ?? null;
    const lastEcho = account.ohlqLastEchoPurchaseDate ?? echoEvents.at(-1)?.reportDate ?? null;
    const latestTargetScore = account.targetScores[0];
    const latestTargetMetric = account.targetMetrics[0];
    const research = account.targetPublicResearch;
    const normalizedTags = new Set(account.tags.map(({ tag }) => tag.name.toUpperCase().replace(/[\s-]+/g, '_')));
    const signal: AccountOpportunitySignals = {
      accountName: account.name, asOfDate: dateOnly(asOfDate), accountStatus: normalizedTags.has('DO_NOT_PURSUE') ? 'DO_NOT_PURSUE' : 'ACTIVE',
      assignedUserId: targetProfile?.assignedUserId ?? null, daysSinceLastEchoPurchase: daysBetween(asOfDate, lastEcho), daysSinceLastVisit: daysBetween(asOfDate, lastVisit),
      echoBottles30: echoEvents.filter((e) => e.reportDate >= new Date(asOfDate.getTime() - 29 * DAY)).reduce((n, e) => n + e.bottles, 0),
      echoBottles60: echoEvents.filter((e) => e.reportDate >= new Date(asOfDate.getTime() - 59 * DAY)).reduce((n, e) => n + e.bottles, 0), echoBottles90: echoEvents.reduce((n, e) => n + e.bottles, 0), echoPurchaseEvents90: echoEvents.length,
      firstEchoPurchaseAt: firstObserved ? dateOnly(firstObserved) : null, historyComplete: opportunitySignal?.historyComplete ?? false,
      lastEchoPurchaseAt: lastEcho ? dateOnly(lastEcho) : null, lastVisitAt: lastVisit?.toISOString() ?? null, openWorklistCount: openWork.get(account.id) ?? 0, purchases,
      targetStatus: targetProfile?.researchStatus ?? null, visits30: accountVisits.filter((v) => v.visitAt >= new Date(asOfDate.getTime() - 29 * DAY)).length,
      visits60: accountVisits.filter((v) => v.visitAt >= new Date(asOfDate.getTime() - 59 * DAY)).length, visits90: accountVisits.filter((v) => v.visitAt >= start90).length,
      targetDataScore: numberValue(latestTargetScore?.dataScore), targetPublicFitScore: numberValue(latestTargetScore?.publicFitScore),
      targetPriceFitPercent: numberValue(latestTargetMetric?.priceFitPercent), targetTotalVolumePercentile: jsonNumber(latestTargetScore?.componentScores, 'totalVolumePercentile'),
      targetConsistencyScore: numberValue(latestTargetMetric?.purchaseConsistency), targetMomentumScore: numberValue(latestTargetMetric?.momentumScore),
      ohioCraft9L: numberValue(latestTargetMetric?.ohioCraft9L), ohioCraftAffinity: numberValue(latestTargetMetric?.ohioCraftAffinity),
      ownershipGroupName: targetProfile?.ownershipGroup?.name ?? null,
      isNationalChain: normalizedTags.has('NATIONAL_CHAIN') ? true : normalizedTags.has('LOCAL_INDEPENDENT') ? false : research?.isNationalChain ?? null,
      ownershipVerification: research?.ownershipVerification ?? null, buyerStructure: research?.buyerStructure ?? null,
      patioOutdoor: research?.patioOutdoor ?? null, cocktailProgram: research?.cocktailProgram ?? null, popularitySignal: research?.popularitySignal ?? null,
      googleRating: numberValue(research?.googleRating), googleReviewCount: research?.googleReviewCount ?? null,
      yelpRating: numberValue(research?.yelpRating), yelpReviewCount: research?.yelpReviewCount ?? null,
      localBrandsOnMenu: stringList(research?.localBrandsOnMenu), publicResearchSourceUrls: stringList(research?.sourceUrls),
    };
    await db.opportunityAccountSignal.upsert({ where: { organizationId_wholesaleAccountId: { organizationId, wholesaleAccountId: account.id } }, create: { organizationId, wholesaleAccountId: account.id, asOfDate, signalVersion: OPPORTUNITY_SIGNAL_VERSION, features: signal, firstEchoPurchaseAt: firstObserved, lastEchoPurchaseAt: lastEcho, historyComplete: false }, update: { asOfDate, signalVersion: OPPORTUNITY_SIGNAL_VERSION, features: signal, firstEchoPurchaseAt: firstObserved, lastEchoPurchaseAt: lastEcho } });

    const primary = selectPrimaryOpportunity(detectOpportunityHypotheses(signal), signal, ranker);
    if (primary) {
      const { hypothesis, ranking } = primary;
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
        opportunity = await db.salesOpportunity.update({ where: { id: opportunity.id }, data: { activeAccountKey: `${organizationId}:${account.id}`, type: hypothesis.type, cycleKey: hypothesis.cycleKey, targetCategory: hypothesis.targetCategory, title: hypothesis.title, recommendedAction: hypothesis.recommendedAction, explanation: ranking.factors, signalSnapshot: signal, rulesVersion: OPPORTUNITY_RULES_VERSION, scoringVersion: ranking.version, productionScore: ranking.score, priorityBand: ranking.priorityBand, lastDetectedAt: asOfDate } });
      } else {
        const previouslyClosed = await db.salesOpportunity.findFirst({
          where: { organizationId, wholesaleAccountId: account.id, type: hypothesis.type, cycleKey: hypothesis.cycleKey },
          select: { id: true },
        });
        if (previouslyClosed) continue;
        opportunity = await db.salesOpportunity.create({ data: { organizationId, wholesaleAccountId: account.id, activeAccountKey: `${organizationId}:${account.id}`, type: hypothesis.type, cycleKey: hypothesis.cycleKey, targetCategory: hypothesis.targetCategory, title: hypothesis.title, recommendedAction: hypothesis.recommendedAction, explanation: ranking.factors, signalSnapshot: signal, rulesVersion: OPPORTUNITY_RULES_VERSION, scoringVersion: ranking.version, productionScore: ranking.score, priorityBand: ranking.priorityBand, assignedToUserId: signal.assignedUserId, detectedAt: asOfDate, lastDetectedAt: asOfDate } });
        detected++;
        await db.opportunityEvent.create({ data: { organizationId, opportunityId: opportunity.id, eventType: OpportunityEventType.DETECTED, eventKey: eventKey(OpportunityEventType.DETECTED, hypothesis.cycleKey), wholesaleAccountId: account.id, metadata: { explanation: ranking.factors, rulesVersion: OPPORTUNITY_RULES_VERSION }, occurredAt: asOfDate } });
      }
      await db.opportunityScore.upsert({ where: { opportunityId_modelVersionId: { opportunityId: opportunity.id, modelVersionId: model.id } }, create: { opportunityId: opportunity.id, modelVersionId: model.id, mode: OpportunityRankingMode.ACTIVE, score: ranking.score, priorityBand: ranking.priorityBand, factors: ranking.factors }, update: { score: ranking.score, priorityBand: ranking.priorityBand, factors: ranking.factors, scoredAt: asOfDate } });
      if (opportunityRules.autoCreateWorklist[hypothesis.type] && !await db.worklistItem.findFirst({ where: { organizationId, salesOpportunityId: opportunity.id } })) {
        const task = await db.worklistItem.create({ data: { organizationId, title: hypothesis.recommendedAction, detail: ranking.factors.join('\n'), status: WorklistStatus.OPEN, source: WorklistSource.OPPORTUNITY_INTELLIGENCE, category: WorklistCategory.WHOLESALE, wholesaleAccountId: account.id, salesOpportunityId: opportunity.id, assignedToUserId: signal.assignedUserId, dueDate: new Date(asOfDate.getTime() + 7 * DAY), createdBy: 'Opportunity intelligence' } });
        await db.opportunityEvent.create({ data: { organizationId, opportunityId: opportunity.id, eventType: OpportunityEventType.WORKLIST_CREATED, eventKey: eventKey(OpportunityEventType.WORKLIST_CREATED, task.id), wholesaleAccountId: account.id, worklistItemId: task.id, occurredAt: asOfDate } }); worklistCreated++;
      }
    }

    const openOpportunities = await db.salesOpportunity.findMany({ where: { organizationId, wholesaleAccountId: account.id, status: { in: [OpportunityStatus.OPEN, OpportunityStatus.ACTIONED] } } });
    for (const opportunity of openOpportunities) {
      const subsequent = accountEvents.filter((e) => e.reportDate > opportunity.detectedAt && e.isTenantProduct && (!opportunity.targetCategory || normalizeOpportunityCategory(e.category, e.itemName) === opportunity.targetCategory));
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
  return { accountsEvaluated: accounts.length, detected, converted, worklistCreated, rulesVersion: OPPORTUNITY_RULES_VERSION, scoringVersion: OPPORTUNITY_RANKING_VERSION };
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
