-- CreateEnum
CREATE TYPE "AgencyMarketRecommendationType" AS ENUM ('ENTRY', 'EXPANSION', 'CURRENT_PLACEMENT');

-- CreateEnum
CREATE TYPE "AgencyMarketConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'INSUFFICIENT_DATA');

-- CreateTable
CREATE TABLE "AgencyMarketProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "asOfDate" DATE NOT NULL,
    "observedSince" DATE,
    "observedDayCount" INTEGER NOT NULL DEFAULT 0,
    "totalRetailEqBottles" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tenantRetailEqBottles" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "nonTenantRetailEqBottles" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "categoryMix" JSONB NOT NULL DEFAULT '{}',
    "priceCoverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "medianPrice750" DOUBLE PRECISION,
    "localRetailEqBottles" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "localShare" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" "AgencyMarketConfidence" NOT NULL,
    "signalSnapshot" JSONB NOT NULL,
    "scoringVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyMarketProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyProductMarketFit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "asOfDate" DATE NOT NULL,
    "recommendationType" "AgencyMarketRecommendationType" NOT NULL,
    "currentPlacement" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT,
    "targetPrice750" DOUBLE PRECISION,
    "categoryEqBottles" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "comparableEqBottles" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "comparableShare" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "localComparableEqBottles" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "peerBuyerCount" INTEGER NOT NULL DEFAULT 0,
    "peerComparableShare" DOUBLE PRECISION,
    "fitScore" INTEGER NOT NULL,
    "fitBand" "AgencyIntelligenceBand" NOT NULL,
    "confidence" "AgencyMarketConfidence" NOT NULL,
    "reasons" JSONB NOT NULL,
    "initialSignalSnapshot" JSONB NOT NULL,
    "signalSnapshot" JSONB NOT NULL,
    "scoringVersion" TEXT NOT NULL,
    "shadow" BOOLEAN NOT NULL DEFAULT true,
    "firstScoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastScoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyProductMarketFit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgencyMarketProfile_organizationId_agencyId_key" ON "AgencyMarketProfile"("organizationId", "agencyId");

-- CreateIndex
CREATE INDEX "AgencyMarketProfile_organizationId_confidence_idx" ON "AgencyMarketProfile"("organizationId", "confidence");

-- CreateIndex
CREATE INDEX "AgencyMarketProfile_organizationId_asOfDate_idx" ON "AgencyMarketProfile"("organizationId", "asOfDate");

-- CreateIndex
CREATE INDEX "AgencyMarketProfile_agencyId_asOfDate_idx" ON "AgencyMarketProfile"("agencyId", "asOfDate");

-- CreateIndex
CREATE INDEX "AgencyMarketProfile_scoringVersion_idx" ON "AgencyMarketProfile"("scoringVersion");

-- CreateIndex
CREATE UNIQUE INDEX "AgencyProductMarketFit_org_agency_item_key" ON "AgencyProductMarketFit"("organizationId", "agencyId", "itemCode");

-- CreateIndex
CREATE INDEX "AgencyProductMarketFit_org_type_score_idx" ON "AgencyProductMarketFit"("organizationId", "recommendationType", "fitScore");

-- CreateIndex
CREATE INDEX "AgencyProductMarketFit_org_item_score_idx" ON "AgencyProductMarketFit"("organizationId", "itemCode", "fitScore");

-- CreateIndex
CREATE INDEX "AgencyProductMarketFit_organizationId_confidence_idx" ON "AgencyProductMarketFit"("organizationId", "confidence");

-- CreateIndex
CREATE INDEX "AgencyProductMarketFit_agencyId_fitScore_idx" ON "AgencyProductMarketFit"("agencyId", "fitScore");

-- CreateIndex
CREATE INDEX "AgencyProductMarketFit_asOfDate_idx" ON "AgencyProductMarketFit"("asOfDate");

-- CreateIndex
CREATE INDEX "AgencyProductMarketFit_scoringVersion_idx" ON "AgencyProductMarketFit"("scoringVersion");

-- AddForeignKey
ALTER TABLE "AgencyMarketProfile" ADD CONSTRAINT "AgencyMarketProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyMarketProfile" ADD CONSTRAINT "AgencyMarketProfile_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyProductMarketFit" ADD CONSTRAINT "AgencyProductMarketFit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyProductMarketFit" ADD CONSTRAINT "AgencyProductMarketFit_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
