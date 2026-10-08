BEGIN;

-- AlterTable
ALTER TABLE "OrganizationProduct" ADD COLUMN     "distributionStatus" TEXT,
ADD COLUMN     "opportunityRole" TEXT;

-- AlterTable
ALTER TABLE "MenuPlacement" ADD COLUMN     "demandEvidence" TEXT,
ADD COLUMN     "pouredProduct" TEXT,
ADD COLUMN     "useFamily" TEXT;

-- AlterTable
ALTER TABLE "SalesOpportunity" ADD COLUMN     "outcomeSummary" JSONB;

-- CreateTable
CREATE TABLE "WholesaleAccountAssessment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "wholesaleAccountId" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "configurationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "asOfDate" DATE NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL,
    "researchAt" TIMESTAMP(3),
    "evidenceMode" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "priority" DOUBLE PRECISION NOT NULL,
    "priorityBand" TEXT NOT NULL,
    "effort" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "assessment" JSONB NOT NULL,
    "dismissedKey" TEXT,
    "dismissalReason" TEXT,
    "snoozedUntil" TIMESTAMP(3),
    "refreshRequestedAt" TIMESTAMP(3),

    CONSTRAINT "WholesaleAccountAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WholesaleAssessmentRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "activeKey" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "modelVersion" TEXT NOT NULL,
    "configurationId" TEXT NOT NULL,
    "fullSweep" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "asOfDate" DATE,
    "expected" INTEGER NOT NULL DEFAULT 0,
    "evaluated" INTEGER NOT NULL DEFAULT 0,
    "persisted" INTEGER NOT NULL DEFAULT 0,
    "ineligible" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "evidenceCounts" JSONB NOT NULL,
    "sourceCoverage" JSONB NOT NULL,
    "errors" JSONB NOT NULL,

    CONSTRAINT "WholesaleAssessmentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WholesaleSalesLedgerDay" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "sourceRevision" TEXT NOT NULL,
    "sourceRows" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WholesaleSalesLedgerDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WholesaleAccountAssessment_organizationId_evidenceMode_prio_idx" ON "WholesaleAccountAssessment"("organizationId", "evidenceMode", "priority");

-- CreateIndex
CREATE INDEX "WholesaleAccountAssessment_organizationId_state_priority_idx" ON "WholesaleAccountAssessment"("organizationId", "state", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "WholesaleAccountAssessment_organizationId_wholesaleAccountI_key" ON "WholesaleAccountAssessment"("organizationId", "wholesaleAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "WholesaleAssessmentRun_activeKey_key" ON "WholesaleAssessmentRun"("activeKey");

-- CreateIndex
CREATE INDEX "WholesaleAssessmentRun_organizationId_startedAt_idx" ON "WholesaleAssessmentRun"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "WholesaleAssessmentRun_organizationId_fullSweep_status_comp_idx" ON "WholesaleAssessmentRun"("organizationId", "fullSweep", "status", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WholesaleSalesLedgerDay_organizationId_reportDate_key" ON "WholesaleSalesLedgerDay"("organizationId", "reportDate");

-- AddForeignKey
ALTER TABLE "WholesaleAccountAssessment" ADD CONSTRAINT "WholesaleAccountAssessment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WholesaleAccountAssessment" ADD CONSTRAINT "WholesaleAccountAssessment_wholesaleAccountId_fkey" FOREIGN KEY ("wholesaleAccountId") REFERENCES "WholesaleAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WholesaleAccountAssessment" ADD CONSTRAINT "WholesaleAccountAssessment_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WholesaleAssessmentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WholesaleAssessmentRun" ADD CONSTRAINT "WholesaleAssessmentRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WholesaleSalesLedgerDay" ADD CONSTRAINT "WholesaleSalesLedgerDay_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant-specific initial policy; every explicit priority/role is preserved.
UPDATE "OrganizationProduct" p SET "opportunityRole" = CASE
  WHEN COALESCE(b."name", p."displayName", '') ~* 'vodka' THEN 'OPPORTUNISTIC'
  ELSE 'FOCUS' END
FROM "Organization" o, "OhlqBrandMasterItem" b
WHERE p."organizationId" = o.id AND o.slug = 'echo-spirits'
  AND b."itemCode" = p."externalItemCode"
  AND p.active AND NOT p.discontinued AND p.status IN ('OWNED', 'REPRESENTED')
  AND p."opportunityRole" IS NULL AND p."strategicPriority" IS NULL
  AND COALESCE(b.name, p."displayName", '') !~* 'RTD|ready.to.drink|cocktail'
  AND (COALESCE(b.category, p.category, '') ~* 'rum|rye|bourbon|vodka'
    OR COALESCE(b.name, p."displayName", '') ~* 'elusive|rye|bourbon');

COMMIT;
