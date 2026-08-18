ALTER TYPE "WorklistSource" ADD VALUE 'AGENCY_INTELLIGENCE';

CREATE TYPE "AgencyInventoryState" AS ENUM ('HEALTHY', 'STOCKOUT', 'UNDERSTOCKED', 'DEAD_INVENTORY', 'MISSING_PLACEMENT', 'AT_RISK', 'INSUFFICIENT_DATA');
CREATE TYPE "AgencyProductOpportunityState" AS ENUM ('WINNING', 'MAINTAIN', 'RESTOCK', 'STOCKOUT', 'PLACEMENT_OPPORTUNITY', 'ACTIVATION_OPPORTUNITY', 'AT_RISK', 'DEAD_INVENTORY', 'LOW_PRIORITY', 'INSUFFICIENT_EVIDENCE');
CREATE TYPE "AgencyRecommendedAction" AS ENUM ('MAINTAIN', 'RESTOCK', 'PURSUE_PLACEMENT', 'SCHEDULE_TASTING', 'INVESTIGATE', 'REDUCE_PRIORITY', 'MONITOR', 'NO_ACTION');
CREATE TYPE "AgencyIntelligenceBand" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_DATA');

CREATE TABLE "AgencyProductIntelligence" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "asOfDate" DATE NOT NULL,
    "inventorySnapshotDate" DATE,
    "onHand" INTEGER,
    "minimum" INTEGER,
    "inventoryStatus" TEXT,
    "coverageGroup" TEXT,
    "retailSales7" INTEGER NOT NULL DEFAULT 0,
    "retailSales30" INTEGER NOT NULL DEFAULT 0,
    "historicalRetailSales" INTEGER NOT NULL DEFAULT 0,
    "lastSaleDate" DATE,
    "daysSinceLastSale" INTEGER,
    "estimatedMonthlyVelocity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "daysOfSupply" DOUBLE PRECISION,
    "peerGroupKey" TEXT,
    "peerAgencyCount" INTEGER NOT NULL DEFAULT 0,
    "peerCarryPercent" DOUBLE PRECISION,
    "peerAverageSales30" DOUBLE PRECISION,
    "peerAverageInventory" DOUBLE PRECISION,
    "fitScore" INTEGER NOT NULL,
    "fitBand" "AgencyIntelligenceBand" NOT NULL,
    "inventoryState" "AgencyInventoryState" NOT NULL,
    "opportunityState" "AgencyProductOpportunityState" NOT NULL,
    "recommendedAction" "AgencyRecommendedAction" NOT NULL,
    "priorityScore" INTEGER NOT NULL,
    "priorityBand" "AgencyIntelligenceBand" NOT NULL,
    "tastingEligible" BOOLEAN NOT NULL DEFAULT false,
    "tastingOpportunity" BOOLEAN NOT NULL DEFAULT false,
    "reasons" JSONB NOT NULL,
    "signalSnapshot" JSONB NOT NULL,
    "rulesVersion" TEXT NOT NULL,
    "scoringVersion" TEXT NOT NULL,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDetectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stateChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snoozedUntil" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "dismissalReason" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgencyProductIntelligence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgencyIntelligenceSummary" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "asOfDate" DATE NOT NULL,
    "retailBand" "AgencyIntelligenceBand" NOT NULL,
    "wholesaleInfluenceBand" "AgencyIntelligenceBand" NOT NULL,
    "currentSkuCount" INTEGER NOT NULL DEFAULT 0,
    "retailSales30" INTEGER NOT NULL DEFAULT 0,
    "lastEchoSaleDate" DATE,
    "openProductOpportunityCount" INTEGER NOT NULL DEFAULT 0,
    "stockoutCount" INTEGER NOT NULL DEFAULT 0,
    "placementOpportunityCount" INTEGER NOT NULL DEFAULT 0,
    "tastingOpportunityCount" INTEGER NOT NULL DEFAULT 0,
    "deadInventoryCount" INTEGER NOT NULL DEFAULT 0,
    "linkedWholesaleCount" INTEGER NOT NULL DEFAULT 0,
    "activeWholesaleCount" INTEGER NOT NULL DEFAULT 0,
    "echoWholesaleBuyerCount" INTEGER NOT NULL DEFAULT 0,
    "wholesaleEchoBottles30" INTEGER NOT NULL DEFAULT 0,
    "lapsedWholesaleCount" INTEGER NOT NULL DEFAULT 0,
    "openWholesaleOpportunityCount" INTEGER NOT NULL DEFAULT 0,
    "recommendedFocus" JSONB NOT NULL,
    "retailReasons" JSONB NOT NULL,
    "wholesaleReasons" JSONB NOT NULL,
    "signalSnapshot" JSONB NOT NULL,
    "rulesVersion" TEXT NOT NULL,
    "scoringVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgencyIntelligenceSummary_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgencyIntelligenceEvent" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "agencyProductIntelligenceId" TEXT,
    "itemCode" TEXT,
    "eventType" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "previousInventoryState" "AgencyInventoryState",
    "inventoryState" "AgencyInventoryState",
    "previousOpportunityState" "AgencyProductOpportunityState",
    "opportunityState" "AgencyProductOpportunityState",
    "snapshot" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgencyIntelligenceEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "WorklistItem" ADD COLUMN "agencyProductIntelligenceId" TEXT;

CREATE UNIQUE INDEX "AgencyProductIntelligence_agencyId_itemCode_key" ON "AgencyProductIntelligence"("agencyId", "itemCode");
CREATE INDEX "AgencyProductIntelligence_agencyId_priorityScore_idx" ON "AgencyProductIntelligence"("agencyId", "priorityScore");
CREATE INDEX "AgencyProductIntelligence_itemCode_fitBand_idx" ON "AgencyProductIntelligence"("itemCode", "fitBand");
CREATE INDEX "AgencyProductIntelligence_asOfDate_idx" ON "AgencyProductIntelligence"("asOfDate");
CREATE INDEX "AgencyProductIntelligence_inventoryState_priorityScore_idx" ON "AgencyProductIntelligence"("inventoryState", "priorityScore");
CREATE INDEX "AgencyProductIntelligence_opportunityState_priorityScore_idx" ON "AgencyProductIntelligence"("opportunityState", "priorityScore");
CREATE INDEX "AgencyProductIntelligence_tastingOpportunity_priorityScore_idx" ON "AgencyProductIntelligence"("tastingOpportunity", "priorityScore");
CREATE INDEX "AgencyProductIntelligence_status_priorityScore_idx" ON "AgencyProductIntelligence"("status", "priorityScore");
CREATE INDEX "AgencyProductIntelligence_rulesVersion_idx" ON "AgencyProductIntelligence"("rulesVersion");
CREATE INDEX "AgencyProductIntelligence_scoringVersion_idx" ON "AgencyProductIntelligence"("scoringVersion");

CREATE UNIQUE INDEX "AgencyIntelligenceSummary_agencyId_key" ON "AgencyIntelligenceSummary"("agencyId");
CREATE INDEX "AgencyIntelligenceSummary_retailBand_asOfDate_idx" ON "AgencyIntelligenceSummary"("retailBand", "asOfDate");
CREATE INDEX "AgencyIntelligenceSummary_wholesaleInfluenceBand_asOfDate_idx" ON "AgencyIntelligenceSummary"("wholesaleInfluenceBand", "asOfDate");
CREATE INDEX "AgencyIntelligenceSummary_stockoutCount_idx" ON "AgencyIntelligenceSummary"("stockoutCount");
CREATE INDEX "AgencyIntelligenceSummary_placementOpportunityCount_idx" ON "AgencyIntelligenceSummary"("placementOpportunityCount");
CREATE INDEX "AgencyIntelligenceSummary_tastingOpportunityCount_idx" ON "AgencyIntelligenceSummary"("tastingOpportunityCount");
CREATE INDEX "AgencyIntelligenceSummary_deadInventoryCount_idx" ON "AgencyIntelligenceSummary"("deadInventoryCount");

CREATE UNIQUE INDEX "AgencyIntelligenceEvent_eventKey_key" ON "AgencyIntelligenceEvent"("eventKey");
CREATE INDEX "AgencyIntelligenceEvent_agencyId_occurredAt_idx" ON "AgencyIntelligenceEvent"("agencyId", "occurredAt");
CREATE INDEX "AgencyIntelligenceEvent_agencyProductIntelligenceId_occurredAt_idx" ON "AgencyIntelligenceEvent"("agencyProductIntelligenceId", "occurredAt");
CREATE INDEX "AgencyIntelligenceEvent_itemCode_occurredAt_idx" ON "AgencyIntelligenceEvent"("itemCode", "occurredAt");
CREATE INDEX "AgencyIntelligenceEvent_eventType_occurredAt_idx" ON "AgencyIntelligenceEvent"("eventType", "occurredAt");
CREATE INDEX "WorklistItem_agencyProductIntelligenceId_idx" ON "WorklistItem"("agencyProductIntelligenceId");
CREATE INDEX "WorklistItem_source_status_agencyId_idx" ON "WorklistItem"("source", "status", "agencyId");

ALTER TABLE "AgencyProductIntelligence" ADD CONSTRAINT "AgencyProductIntelligence_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgencyIntelligenceSummary" ADD CONSTRAINT "AgencyIntelligenceSummary_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgencyIntelligenceEvent" ADD CONSTRAINT "AgencyIntelligenceEvent_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorklistItem" ADD CONSTRAINT "WorklistItem_agencyProductIntelligenceId_fkey" FOREIGN KEY ("agencyProductIntelligenceId") REFERENCES "AgencyProductIntelligence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
