import {
  AgencyProductOpportunityState,
  OhlqReportDataSource,
  OhlqReportRunStatus,
  OpportunityStatus,
  Prisma,
  type PrismaClient,
} from '@prisma/client';
import {
  analyzeAgencyProduct,
  analyzeWholesaleInfluence,
  calculatePeerComparison,
  getMeaningfulAgencyChange,
  isActionableAgencyOpportunity,
  type AgencyProductAnalysis,
  type AgencyProductSignals,
  type IntelligenceBand,
  type WholesaleInfluenceAnalysis,
} from './agencyIntelligence';
import { agencyIntelligenceConfig } from './agencyIntelligenceConfig';
import { getTenantAgencyInventoryWhere } from './ohlqAgencyInventory';
import { getTenantSalesWhere } from './ohlqSalesData';
import { normalizeOhlqId } from './ohlqWholesaleMatching';
import { prisma } from './prisma';
import { getTenantConfig } from './tenantConfig';

const DAY = 86_400_000;
const INPUT_SOURCES = [
  OhlqReportDataSource.ANNUAL_SALES_SUMMARY,
  OhlqReportDataSource.ANNUAL_SALES_SUMMARY_BY_WHOLESALE,
  OhlqReportDataSource.AGENCY_INVENTORY_REPORT,
] as const;

type InputStatus = { dataSource: OhlqReportDataSource; status: OhlqReportRunStatus };

type RefreshOptions = {
  db?: PrismaClient;
  inventoryReportDate: Date;
  salesReportDate: Date;
};

type MutableSales = {
  lastSaleDate: Date | null;
  retailSales7: number;
  retailSales30: number;
  wholesaleSales30: number;
};

type ProductResult = {
  analysis: AgencyProductAnalysis;
  signals: AgencyProductSignals;
  inventory: {
    coverageGroup: string | null;
    snapshotDate: Date | null;
  };
  lastSaleDate: Date | null;
};

export function agencyIntelligenceInputsComplete(statuses: InputStatus[]) {
  return INPUT_SOURCES.every((source) =>
    statuses.some((status) => status.dataSource === source && status.status === OhlqReportRunStatus.COMPLETED),
  );
}

export const buildAgencyIntelligenceEventKey = ({
  agencyId,
  asOfDate,
  eventType,
  itemCode,
}: {
  agencyId: string;
  asOfDate: Date;
  eventType: string;
  itemCode: string;
}) => `${agencyId}:${itemCode}:${eventType}:${asOfDate.toISOString().slice(0, 10)}`;

export function getNextAgencyOpportunityStatus({
  actionable,
  asOfDate,
  changed,
  previous,
}: {
  actionable: boolean;
  asOfDate: Date;
  changed: boolean;
  previous?: { status: OpportunityStatus; snoozedUntil: Date | null } | null;
}) {
  if (!actionable) return OpportunityStatus.RESOLVED;
  if (!previous || changed) return OpportunityStatus.OPEN;
  if (previous.status === OpportunityStatus.SNOOZED && previous.snoozedUntil && previous.snoozedUntil > asOfDate) {
    return OpportunityStatus.SNOOZED;
  }
  if (previous.status === OpportunityStatus.DISMISSED) return OpportunityStatus.DISMISSED;
  if (previous.status === OpportunityStatus.ACTIONED) return OpportunityStatus.ACTIONED;
  return OpportunityStatus.OPEN;
}

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY);
const daysBetween = (later: Date, earlier: Date | null) =>
  earlier ? Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / DAY)) : null;
const key = (agencyNumber: string, itemCode: string) => `${agencyNumber}|${itemCode}`;
const asJson = (value: unknown) => value as Prisma.InputJsonValue;

const retailBandForProducts = (products: ProductResult[]): IntelligenceBand => {
  if (products.length === 0) return 'INSUFFICIENT_DATA';
  const actionable = products.filter((product) => isActionableAgencyOpportunity(product.analysis.opportunityState));
  if (actionable.some((product) => product.analysis.priorityBand === 'HIGH') || actionable.length >= 2) return 'HIGH';
  if (actionable.length > 0 || products.some((product) => product.signals.retailSales30 > 0)) return 'MEDIUM';
  return 'LOW';
};

const actionLabel: Record<AgencyProductAnalysis['recommendedAction'], string> = {
  INVESTIGATE: 'Investigate',
  MAINTAIN: 'Maintain',
  MONITOR: 'Monitor',
  NO_ACTION: 'No action',
  PURSUE_PLACEMENT: 'Pursue placement',
  REDUCE_PRIORITY: 'Reduce priority',
  RESTOCK: 'Restock',
  SCHEDULE_TASTING: 'Schedule tasting',
};

const recommendedFocusForAgency = (products: ProductResult[], wholesale: WholesaleInfluenceAnalysis) => {
  const focus = products
    .filter((product) => isActionableAgencyOpportunity(product.analysis.opportunityState))
    .sort((left, right) => right.analysis.priorityScore - left.analysis.priorityScore)
    .slice(0, 4)
    .map((product) => `${actionLabel[product.analysis.recommendedAction]} ${product.signals.itemName}`);
  if (wholesale.lapsedWholesaleCount > 0) focus.push(`Follow up with ${wholesale.lapsedWholesaleCount} lapsed wholesale buyer${wholesale.lapsedWholesaleCount === 1 ? '' : 's'}`);
  else if (wholesale.openWholesaleOpportunityCount > 0) focus.push(`Advance ${wholesale.openWholesaleOpportunityCount} linked wholesale opportunit${wholesale.openWholesaleOpportunityCount === 1 ? 'y' : 'ies'}`);
  return focus.slice(0, 5);
};

export async function assertAgencyIntelligenceInputsComplete({
  db,
  inventoryReportDate,
  salesReportDate,
}: Required<RefreshOptions>) {
  const statuses = await db.ohlqReportImportStatus.findMany({
    where: {
      OR: [
        {
          dataSource: {
            in: [
              OhlqReportDataSource.ANNUAL_SALES_SUMMARY,
              OhlqReportDataSource.ANNUAL_SALES_SUMMARY_BY_WHOLESALE,
            ],
          },
          reportDate: salesReportDate,
        },
        { dataSource: OhlqReportDataSource.AGENCY_INVENTORY_REPORT, reportDate: inventoryReportDate },
      ],
    },
    select: { dataSource: true, status: true },
  });
  if (!agencyIntelligenceInputsComplete(statuses)) {
    throw new Error('Agency intelligence skipped because all required OHLQ inputs have not completed successfully.');
  }
}

export async function refreshAgencyIntelligence({
  db = prisma,
  inventoryReportDate,
  salesReportDate,
}: RefreshOptions) {
  await assertAgencyIntelligenceInputsComplete({ db, inventoryReportDate, salesReportDate });
  const tenantConfig = getTenantConfig();
  const salesStart = addDays(salesReportDate, -29);
  const sales7Start = addDays(salesReportDate, -6);
  const placementHistoryStart = addDays(inventoryReportDate, -179);

  const [agencies, inventory, salesRows, placementHistory, visits, wholesaleAccounts, previousProducts] =
    await Promise.all([
      db.agency.findMany({
        select: { id: true, agencyId: true, name: true, county: true, d8Permit: true },
      }),
      db.ohlqAgencyInventoryCurrent.findMany({
        where: getTenantAgencyInventoryWhere(tenantConfig),
        select: {
          agencyNumber: true,
          itemCode: true,
          itemName: true,
          onHand: true,
          minimum: true,
          status: true,
          coverageGroup: true,
          district: true,
          snapshotDate: true,
        },
      }),
      db.ohlqAnnualSalesRow.findMany({
        where: {
          ...getTenantSalesWhere(tenantConfig),
          reportDate: { gte: salesStart, lte: salesReportDate },
        },
        select: {
          agencyId: true,
          brand: true,
          reportDate: true,
          retailBottlesSold: true,
          wholesaleBottlesSold: true,
        },
      }),
      db.ohlqAgencyInventorySnapshot.findMany({
        where: {
          ...getTenantAgencyInventoryWhere(tenantConfig),
          snapshotDate: { gte: placementHistoryStart, lt: inventoryReportDate },
        },
        distinct: ['agencyNumber', 'itemCode'],
        select: { agencyNumber: true, itemCode: true },
      }),
      db.loggedVisit.findMany({
        where: { locationType: 'agency', agencyId: { not: null }, visitAt: { lte: inventoryReportDate } },
        orderBy: { visitAt: 'desc' },
        distinct: ['agencyId'],
        select: { agencyId: true, visitAt: true },
      }),
      db.wholesaleAccount.findMany({
        where: { agencyId: { not: null }, mergedIntoId: null },
        select: {
          id: true,
          agencyId: true,
          isActive: true,
          ohlqLastEchoPurchaseDate: true,
          opportunities: {
            where: { status: { in: [OpportunityStatus.OPEN, OpportunityStatus.ACTIONED] } },
            select: { id: true },
          },
        },
      }),
      db.agencyProductIntelligence.findMany({
        select: {
          id: true,
          agencyId: true,
          itemCode: true,
          inventoryState: true,
          opportunityState: true,
          status: true,
          inventoryStatus: true,
          onHand: true,
          snoozedUntil: true,
          detectedAt: true,
          stateChangedAt: true,
        },
      }),
    ]);

  const normalizedAgencies = agencies.flatMap((agency) => {
    const agencyNumber = normalizeOhlqId(agency.agencyId);
    return agencyNumber ? [{ ...agency, agencyNumber }] : [];
  });
  const inventoryByKey = new Map(inventory.flatMap((row) => {
    const agencyNumber = normalizeOhlqId(row.agencyNumber);
    return agencyNumber ? [[key(agencyNumber, row.itemCode), row] as const] : [];
  }));
  const itemNames = new Map<string, string>();
  inventory.forEach((row) => itemNames.set(row.itemCode, row.itemName));
  const salesByKey = new Map<string, MutableSales>();
  salesRows.forEach((row) => {
    const agencyNumber = normalizeOhlqId(row.agencyId);
    if (!agencyNumber) return;
    const salesKey = key(agencyNumber, row.brand);
    const value = salesByKey.get(salesKey) ?? {
      lastSaleDate: null,
      retailSales7: 0,
      retailSales30: 0,
      wholesaleSales30: 0,
    };
    value.retailSales30 += row.retailBottlesSold;
    value.wholesaleSales30 += row.wholesaleBottlesSold;
    if (row.reportDate >= sales7Start) value.retailSales7 += row.retailBottlesSold;
    if (row.retailBottlesSold > 0 && (!value.lastSaleDate || row.reportDate > value.lastSaleDate)) value.lastSaleDate = row.reportDate;
    salesByKey.set(salesKey, value);
  });
  const observedItemCodes = new Set([
    ...inventory.map((row) => row.itemCode),
    ...salesRows.map((row) => row.brand),
    ...placementHistory.map((row) => row.itemCode),
  ]);
  const masters = observedItemCodes.size
    ? await db.ohlqBrandMasterItem.findMany({
        where: { itemCode: { in: [...observedItemCodes] } },
        select: { itemCode: true, name: true },
      })
    : [];
  masters.forEach((item) => itemNames.set(item.itemCode, item.name));
  const itemCodes = [...observedItemCodes].sort();
  const previousPlacement = new Set(placementHistory.flatMap((row) => {
    const agencyNumber = normalizeOhlqId(row.agencyNumber);
    return agencyNumber ? [key(agencyNumber, row.itemCode)] : [];
  }));
  const latestVisitByAgencyId = new Map(visits.map((visit) => [visit.agencyId!, visit.visitAt]));
  const previousByKey = new Map(previousProducts.map((row) => [key(row.agencyId, row.itemCode), row]));

  const districtByAgency = new Map<string, string>();
  inventory.forEach((row) => {
    const agencyNumber = normalizeOhlqId(row.agencyNumber);
    if (!agencyNumber) return;
    if (row.district && !districtByAgency.has(agencyNumber)) districtByAgency.set(agencyNumber, row.district.trim());
  });
  const groupByAgency = new Map(
    normalizedAgencies.map((agency) => [agency.agencyNumber, districtByAgency.get(agency.agencyNumber) || agency.county || 'STATEWIDE']),
  );
  const agenciesByGroup = new Map<string, typeof normalizedAgencies>();
  normalizedAgencies.forEach((agency) => {
    const group = groupByAgency.get(agency.agencyNumber)!;
    agenciesByGroup.set(group, [...(agenciesByGroup.get(group) ?? []), agency]);
  });

  const wholesaleByAgencyNumber = new Map<string, typeof wholesaleAccounts>();
  wholesaleAccounts.forEach((account) => {
    const agencyNumber = normalizeOhlqId(account.agencyId);
    if (!agencyNumber) return;
    wholesaleByAgencyNumber.set(agencyNumber, [...(wholesaleByAgencyNumber.get(agencyNumber) ?? []), account]);
  });
  const wholesaleAccountIds = wholesaleAccounts.map((account) => account.id);
  const wholesaleEvents = wholesaleAccountIds.length
    ? await db.accountSalesEvent.findMany({
        where: {
          wholesaleAccountId: { in: wholesaleAccountIds },
          isTenantProduct: true,
          reportDate: { gte: salesStart, lte: salesReportDate },
        },
        select: { wholesaleAccountId: true, bottles: true },
      })
    : [];
  const bottlesByWholesaleAccount = new Map<string, number>();
  wholesaleEvents.forEach((event) => bottlesByWholesaleAccount.set(
    event.wholesaleAccountId,
    (bottlesByWholesaleAccount.get(event.wholesaleAccountId) ?? 0) + event.bottles,
  ));

  const peerTotals = new Map<string, { carry: number; inventory: number; sales30: number }>();
  agenciesByGroup.forEach((peerAgencies, group) => {
    itemCodes.forEach((itemCode) => {
      const total = { carry: 0, inventory: 0, sales30: 0 };
      peerAgencies.forEach((agency) => {
        const row = inventoryByKey.get(key(agency.agencyNumber, itemCode));
        if (row) total.carry += 1;
        total.inventory += row?.onHand ?? 0;
        total.sales30 += salesByKey.get(key(agency.agencyNumber, itemCode))?.retailSales30 ?? 0;
      });
      peerTotals.set(key(group, itemCode), total);
    });
  });

  let eventsCreated = 0;
  let productsProcessed = 0;
  let summariesProcessed = 0;
  const now = new Date();

  const persistenceConcurrency = 8;
  for (let offset = 0; offset < normalizedAgencies.length; offset += persistenceConcurrency) {
    await Promise.all(normalizedAgencies.slice(offset, offset + persistenceConcurrency).map(async (agency) => {
    const linkedWholesale = wholesaleByAgencyNumber.get(agency.agencyNumber) ?? [];
    const wholesale = analyzeWholesaleInfluence({
      linkedWholesaleCount: linkedWholesale.length,
      activeWholesaleCount: linkedWholesale.filter((account) => account.isActive).length,
      echoBuyerCount: linkedWholesale.filter((account) =>
        account.ohlqLastEchoPurchaseDate && account.ohlqLastEchoPurchaseDate >= salesStart,
      ).length,
      echoBottles30: linkedWholesale.reduce((total, account) => total + (bottlesByWholesaleAccount.get(account.id) ?? 0), 0),
      lapsedWholesaleCount: linkedWholesale.filter((account) =>
        account.ohlqLastEchoPurchaseDate && account.ohlqLastEchoPurchaseDate < salesStart,
      ).length,
      openWholesaleOpportunityCount: linkedWholesale.reduce((total, account) => total + account.opportunities.length, 0),
    });
    const group = groupByAgency.get(agency.agencyNumber)!;
    const groupAgencies = agenciesByGroup.get(group) ?? [];
    const productResults: ProductResult[] = [];

    for (const itemCode of itemCodes) {
      const inventoryRow = inventoryByKey.get(key(agency.agencyNumber, itemCode));
      const sales = salesByKey.get(key(agency.agencyNumber, itemCode)) ?? {
        lastSaleDate: null,
        retailSales7: 0,
        retailSales30: 0,
        wholesaleSales30: 0,
      };
      const totals = peerTotals.get(key(group, itemCode)) ?? { carry: 0, inventory: 0, sales30: 0 };
      const ownCarry = inventoryRow ? 1 : 0;
      const ownInventory = inventoryRow?.onHand ?? 0;
      const ownSales = sales.retailSales30;
      const peer = calculatePeerComparison({
        currentCarries: Boolean(ownCarry),
        currentInventory: ownInventory,
        currentSales30: ownSales,
        groupAgencyCount: groupAgencies.length,
        groupCarryCount: totals.carry,
        groupInventory: totals.inventory,
        groupSales30: totals.sales30,
      });
      const signals: AgencyProductSignals = {
        itemCode,
        itemName: itemNames.get(itemCode) ?? inventoryRow?.itemName ?? 'Name pending',
        onHand: inventoryRow?.onHand ?? null,
        minimum: inventoryRow?.minimum ?? null,
        inventoryStatus: inventoryRow?.status ?? null,
        currentPlacement: Boolean(inventoryRow),
        previousPlacement: previousPlacement.has(key(agency.agencyNumber, itemCode)),
        retailSales7: sales.retailSales7,
        retailSales30: sales.retailSales30,
        historicalRetailSales: sales.retailSales30,
        daysSinceLastSale: daysBetween(salesReportDate, sales.lastSaleDate),
        peerAgencyCount: peer.peerAgencyCount,
        peerCarryPercent: peer.peerCarryPercent,
        peerAverageSales30: peer.peerAverageSales30,
        peerAverageInventory: peer.peerAverageInventory,
        d8Eligible: agency.d8Permit,
        daysSinceLastVisit: daysBetween(inventoryReportDate, latestVisitByAgencyId.get(agency.id) ?? null),
        wholesaleInfluenceBand: wholesale.band,
      };
      productResults.push({
        analysis: analyzeAgencyProduct(signals),
        signals,
        inventory: { coverageGroup: inventoryRow?.coverageGroup ?? null, snapshotDate: inventoryRow?.snapshotDate ?? null },
        lastSaleDate: sales.lastSaleDate,
      });
    }

    for (const product of productResults) {
      const previous = previousByKey.get(key(agency.id, product.signals.itemCode));
      const actionable = isActionableAgencyOpportunity(product.analysis.opportunityState);
      const stateEventType = previous || actionable ? getMeaningfulAgencyChange(previous ?? null, product.analysis) : null;
      const eventType = stateEventType ?? (
        previous && previous.inventoryStatus !== product.signals.inventoryStatus ? 'INVENTORY_STATUS_CHANGED' : null
      );
      const status = getNextAgencyOpportunityStatus({
        actionable,
        asOfDate: inventoryReportDate,
        changed: Boolean(eventType && eventType !== 'DETECTED'),
        previous,
      });
      const changed = Boolean(eventType && eventType !== 'DETECTED');
      const snapshot = {
        agencyNumber: agency.agencyNumber,
        analysis: product.analysis,
        signals: product.signals,
        wholesaleInfluence: wholesale,
      };
      const persisted = await db.agencyProductIntelligence.upsert({
        where: { agencyId_itemCode: { agencyId: agency.id, itemCode: product.signals.itemCode } },
        create: {
          agencyId: agency.id,
          itemCode: product.signals.itemCode,
          itemName: product.signals.itemName,
          asOfDate: inventoryReportDate,
          inventorySnapshotDate: product.inventory.snapshotDate,
          onHand: product.signals.onHand,
          minimum: product.signals.minimum,
          inventoryStatus: product.signals.inventoryStatus,
          coverageGroup: product.inventory.coverageGroup,
          retailSales7: product.signals.retailSales7,
          retailSales30: product.signals.retailSales30,
          historicalRetailSales: product.signals.historicalRetailSales,
          lastSaleDate: product.lastSaleDate,
          daysSinceLastSale: product.signals.daysSinceLastSale,
          estimatedMonthlyVelocity: product.analysis.estimatedMonthlyVelocity,
          daysOfSupply: product.analysis.daysOfSupply,
          peerGroupKey: group,
          peerAgencyCount: product.signals.peerAgencyCount,
          peerCarryPercent: product.signals.peerCarryPercent,
          peerAverageSales30: product.signals.peerAverageSales30,
          peerAverageInventory: product.signals.peerAverageInventory,
          fitScore: product.analysis.fitScore,
          fitBand: product.analysis.fitBand,
          inventoryState: product.analysis.inventoryState,
          opportunityState: product.analysis.opportunityState,
          recommendedAction: product.analysis.recommendedAction,
          priorityScore: product.analysis.priorityScore,
          priorityBand: product.analysis.priorityBand,
          tastingEligible: product.signals.d8Eligible,
          tastingOpportunity: product.analysis.tastingOpportunity,
          reasons: asJson(product.analysis.reasons),
          signalSnapshot: asJson(snapshot),
          rulesVersion: product.analysis.rulesVersion,
          scoringVersion: product.analysis.scoringVersion,
          status,
          detectedAt: now,
          lastDetectedAt: now,
          stateChangedAt: now,
          resolvedAt: actionable ? null : now,
        },
        update: {
          itemName: product.signals.itemName,
          asOfDate: inventoryReportDate,
          inventorySnapshotDate: product.inventory.snapshotDate,
          onHand: product.signals.onHand,
          minimum: product.signals.minimum,
          inventoryStatus: product.signals.inventoryStatus,
          coverageGroup: product.inventory.coverageGroup,
          retailSales7: product.signals.retailSales7,
          retailSales30: product.signals.retailSales30,
          historicalRetailSales: product.signals.historicalRetailSales,
          lastSaleDate: product.lastSaleDate,
          daysSinceLastSale: product.signals.daysSinceLastSale,
          estimatedMonthlyVelocity: product.analysis.estimatedMonthlyVelocity,
          daysOfSupply: product.analysis.daysOfSupply,
          peerGroupKey: group,
          peerAgencyCount: product.signals.peerAgencyCount,
          peerCarryPercent: product.signals.peerCarryPercent,
          peerAverageSales30: product.signals.peerAverageSales30,
          peerAverageInventory: product.signals.peerAverageInventory,
          fitScore: product.analysis.fitScore,
          fitBand: product.analysis.fitBand,
          inventoryState: product.analysis.inventoryState,
          opportunityState: product.analysis.opportunityState,
          recommendedAction: product.analysis.recommendedAction,
          priorityScore: product.analysis.priorityScore,
          priorityBand: product.analysis.priorityBand,
          tastingEligible: product.signals.d8Eligible,
          tastingOpportunity: product.analysis.tastingOpportunity,
          reasons: asJson(product.analysis.reasons),
          signalSnapshot: asJson(snapshot),
          rulesVersion: product.analysis.rulesVersion,
          scoringVersion: product.analysis.scoringVersion,
          status,
          lastDetectedAt: now,
          stateChangedAt: changed ? now : previous?.stateChangedAt,
          resolvedAt: actionable ? null : previous?.status === OpportunityStatus.RESOLVED ? undefined : now,
          ...(changed ? { dismissedAt: null, dismissalReason: null, snoozedUntil: null } : {}),
        },
        select: { id: true },
      });
      productsProcessed += 1;

      if (!actionable) {
        await db.worklistItem.updateMany({
          where: {
            agencyProductIntelligenceId: persisted.id,
            status: { in: ['OPEN', 'IN_PROGRESS'] },
          },
          data: { completedAt: now, status: 'COMPLETED' },
        });
      }

      if (eventType) {
        const result = await db.agencyIntelligenceEvent.createMany({
          skipDuplicates: true,
          data: [{
            agencyId: agency.id,
            agencyProductIntelligenceId: persisted.id,
            itemCode: product.signals.itemCode,
            eventType,
            eventKey: buildAgencyIntelligenceEventKey({ agencyId: agency.id, asOfDate: inventoryReportDate, eventType, itemCode: product.signals.itemCode }),
            previousInventoryState: previous?.inventoryState,
            inventoryState: product.analysis.inventoryState,
            previousOpportunityState: previous?.opportunityState,
            opportunityState: product.analysis.opportunityState,
            snapshot: asJson(snapshot),
            occurredAt: now,
          }],
        });
        eventsCreated += result.count;
      }
    }

    const retailBand = retailBandForProducts(productResults);
    const recommendedFocus = recommendedFocusForAgency(productResults, wholesale);
    const openProducts = productResults.filter((product) => isActionableAgencyOpportunity(product.analysis.opportunityState));
    const retailSales30 = productResults.reduce((total, product) => total + product.signals.retailSales30, 0);
    const lastEchoSaleDate = productResults.reduce<Date | null>(
      (latest, product) => !latest || (product.lastSaleDate && product.lastSaleDate > latest) ? product.lastSaleDate ?? latest : latest,
      null,
    );
    await db.agencyIntelligenceSummary.upsert({
      where: { agencyId: agency.id },
      create: {
        agencyId: agency.id,
        asOfDate: inventoryReportDate,
        retailBand,
        wholesaleInfluenceBand: wholesale.band,
        currentSkuCount: productResults.filter((product) => product.signals.currentPlacement).length,
        retailSales30,
        lastEchoSaleDate,
        openProductOpportunityCount: openProducts.length,
        stockoutCount: productResults.filter((product) => product.analysis.inventoryState === 'STOCKOUT').length,
        placementOpportunityCount: productResults.filter((product) => product.analysis.opportunityState === 'PLACEMENT_OPPORTUNITY').length,
        tastingOpportunityCount: productResults.filter((product) => product.analysis.tastingOpportunity).length,
        deadInventoryCount: productResults.filter((product) => product.analysis.inventoryState === 'DEAD_INVENTORY').length,
        linkedWholesaleCount: wholesale.linkedWholesaleCount,
        activeWholesaleCount: wholesale.activeWholesaleCount,
        echoWholesaleBuyerCount: wholesale.echoBuyerCount,
        wholesaleEchoBottles30: wholesale.echoBottles30,
        lapsedWholesaleCount: wholesale.lapsedWholesaleCount,
        openWholesaleOpportunityCount: wholesale.openWholesaleOpportunityCount,
        recommendedFocus: asJson(recommendedFocus),
        retailReasons: asJson(openProducts.sort((a, b) => b.analysis.priorityScore - a.analysis.priorityScore).flatMap((product) => product.analysis.reasons).slice(0, 4)),
        wholesaleReasons: asJson(wholesale.reasons),
        signalSnapshot: asJson({ products: productResults.map((product) => ({ analysis: product.analysis, signals: product.signals })), wholesale }),
        rulesVersion: productResults[0]?.analysis.rulesVersion ?? 'AGENCY_RULES_V1',
        scoringVersion: productResults[0]?.analysis.scoringVersion ?? 'AGENCY_RETAIL_FIT_V1',
      },
      update: {
        asOfDate: inventoryReportDate,
        retailBand,
        wholesaleInfluenceBand: wholesale.band,
        currentSkuCount: productResults.filter((product) => product.signals.currentPlacement).length,
        retailSales30,
        lastEchoSaleDate,
        openProductOpportunityCount: openProducts.length,
        stockoutCount: productResults.filter((product) => product.analysis.inventoryState === 'STOCKOUT').length,
        placementOpportunityCount: productResults.filter((product) => product.analysis.opportunityState === 'PLACEMENT_OPPORTUNITY').length,
        tastingOpportunityCount: productResults.filter((product) => product.analysis.tastingOpportunity).length,
        deadInventoryCount: productResults.filter((product) => product.analysis.inventoryState === 'DEAD_INVENTORY').length,
        linkedWholesaleCount: wholesale.linkedWholesaleCount,
        activeWholesaleCount: wholesale.activeWholesaleCount,
        echoWholesaleBuyerCount: wholesale.echoBuyerCount,
        wholesaleEchoBottles30: wholesale.echoBottles30,
        lapsedWholesaleCount: wholesale.lapsedWholesaleCount,
        openWholesaleOpportunityCount: wholesale.openWholesaleOpportunityCount,
        recommendedFocus: asJson(recommendedFocus),
        retailReasons: asJson(openProducts.sort((a, b) => b.analysis.priorityScore - a.analysis.priorityScore).flatMap((product) => product.analysis.reasons).slice(0, 4)),
        wholesaleReasons: asJson(wholesale.reasons),
        signalSnapshot: asJson({ products: productResults.map((product) => ({ analysis: product.analysis, signals: product.signals })), wholesale }),
        rulesVersion: productResults[0]?.analysis.rulesVersion ?? 'AGENCY_RULES_V1',
        scoringVersion: productResults[0]?.analysis.scoringVersion ?? 'AGENCY_RETAIL_FIT_V1',
      },
    });
      summariesProcessed += 1;
    }));
  }

  return {
    agenciesProcessed: summariesProcessed,
    eventsCreated,
    productsProcessed,
    rulesVersion: 'AGENCY_RULES_V1',
    scoringVersion: 'AGENCY_RETAIL_FIT_V1',
  };
}

export const actionableAgencyOpportunityStates: AgencyProductOpportunityState[] = [
  AgencyProductOpportunityState.STOCKOUT,
  AgencyProductOpportunityState.RESTOCK,
  AgencyProductOpportunityState.PLACEMENT_OPPORTUNITY,
  AgencyProductOpportunityState.ACTIVATION_OPPORTUNITY,
  AgencyProductOpportunityState.AT_RISK,
  AgencyProductOpportunityState.DEAD_INVENTORY,
];
