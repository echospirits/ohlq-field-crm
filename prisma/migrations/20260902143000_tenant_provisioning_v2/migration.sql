-- CreateEnum
CREATE TYPE "ProvisioningRunStatus" AS ENUM ('PENDING', 'RUNNING', 'WAITING_FOR_INPUT', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "ProvisioningStepStatus" AS ENUM ('PENDING', 'RUNNING', 'WAITING_FOR_INPUT', 'COMPLETE', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ProvisioningStepKind" AS ENUM ('VALIDATE_CONFIGURATION', 'DISCOVER_PRODUCTS', 'CONFIRM_PRODUCTS', 'APPLY_ENTITLEMENTS', 'CREATE_INITIAL_ADMIN', 'SEND_INITIAL_INVITATION', 'BACKFILL_SALES', 'BACKFILL_AGENCY_INTELLIGENCE', 'BACKFILL_OPPORTUNITIES', 'FINALIZE');

-- CreateEnum
CREATE TYPE "InvitationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'SUPPRESSED', 'FAILED');

-- AlterEnum
ALTER TYPE "OrganizationProductStatus" ADD VALUE 'PENDING_REVIEW';

-- DropIndex
DROP INDEX "AccountSalesEvent_sourceKey_key";

-- DropIndex
DROP INDEX "AgencyIntelligenceEvent_eventKey_key";

-- DropIndex
DROP INDEX "AgencyIntelligenceSummary_agencyId_key";

-- DropIndex
DROP INDEX "AgencyProductIntelligence_agencyId_itemCode_key";

-- DropIndex
DROP INDEX "LocationTag_tagId_agencyId_key";

-- DropIndex
DROP INDEX "LocationTag_tagId_wholesaleAccountId_key";

-- DropIndex
DROP INDEX "LoggedVisit_submissionKey_key";

-- DropIndex
DROP INDEX "OpportunityAccountSignal_wholesaleAccountId_key";

-- DropIndex
DROP INDEX "Recipe_importKey_key";

-- DropIndex
DROP INDEX "RecipeSuggestion_recipeId_wholesaleAccountId_key";

-- DropIndex
DROP INDEX "SalesOpportunity_activeAccountKey_key";

-- DropIndex
DROP INDEX "Tag_name_key";

-- DropIndex
DROP INDEX "TargetAccountProfile_wholesaleAccountId_key";

-- DropIndex
DROP INDEX "WeeklyDigestLog_digestType_recipientEmail_periodStart_perio_key";

-- DropIndex
DROP INDEX "WorklistItem_submissionKey_key";

-- Preserve legacy ownership before tenant ownership becomes mandatory. Rows
-- with an attributable user or parent inherit that organization; remaining
-- pre-tenancy rows belong to the explicitly bootstrapped Echo organization.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Organization" WHERE "id" = 'org_echo_spirits') THEN
    RAISE EXCEPTION 'Tenant migration requires the bootstrapped Echo organization';
  END IF;
END $$;

UPDATE "WeeklyDigestLog" AS target SET "organizationId" = usr."organizationId"
FROM "User" AS usr WHERE target."organizationId" IS NULL AND target."recipientUserId" = usr."id" AND usr."organizationId" IS NOT NULL;
UPDATE "Tag" AS target SET "organizationId" = usr."organizationId"
FROM "User" AS usr WHERE target."organizationId" IS NULL AND target."createdByUserId" = usr."id" AND usr."organizationId" IS NOT NULL;
UPDATE "MenuPlacement" AS target SET "organizationId" = usr."organizationId"
FROM "User" AS usr WHERE target."organizationId" IS NULL AND target."createdByUserId" = usr."id" AND usr."organizationId" IS NOT NULL;
UPDATE "Recipe" AS target SET "organizationId" = usr."organizationId"
FROM "User" AS usr WHERE target."organizationId" IS NULL AND target."createdByUserId" = usr."id" AND usr."organizationId" IS NOT NULL;
UPDATE "RecipeSuggestion" AS target SET "organizationId" = usr."organizationId"
FROM "User" AS usr WHERE target."organizationId" IS NULL AND target."createdByUserId" = usr."id" AND usr."organizationId" IS NOT NULL;
UPDATE "TargetAccountProfile" AS target SET "organizationId" = usr."organizationId"
FROM "User" AS usr WHERE target."organizationId" IS NULL AND target."assignedUserId" = usr."id" AND usr."organizationId" IS NOT NULL;
UPDATE "LocationTag" AS target SET "organizationId" = usr."organizationId"
FROM "User" AS usr WHERE target."organizationId" IS NULL AND target."createdByUserId" = usr."id" AND usr."organizationId" IS NOT NULL;
UPDATE "LocationContact" AS target SET "organizationId" = usr."organizationId"
FROM "User" AS usr WHERE target."organizationId" IS NULL AND target."createdByUserId" = usr."id" AND usr."organizationId" IS NOT NULL;
UPDATE "LoggedVisit" AS target SET "organizationId" = usr."organizationId"
FROM "User" AS usr WHERE target."organizationId" IS NULL AND target."createdByUserId" = usr."id" AND usr."organizationId" IS NOT NULL;
UPDATE "VisitPhoto" AS target SET "organizationId" = visit."organizationId"
FROM "LoggedVisit" AS visit WHERE target."organizationId" IS NULL AND target."loggedVisitId" = visit."id" AND visit."organizationId" IS NOT NULL;
UPDATE "WorklistItem" AS target SET "organizationId" = usr."organizationId"
FROM "User" AS usr WHERE target."organizationId" IS NULL AND target."createdByUserId" = usr."id" AND usr."organizationId" IS NOT NULL;
UPDATE "SalesOpportunity" AS target SET "organizationId" = usr."organizationId"
FROM "User" AS usr WHERE target."organizationId" IS NULL AND target."assignedToUserId" = usr."id" AND usr."organizationId" IS NOT NULL;
UPDATE "OpportunityEvent" AS target SET "organizationId" = opportunity."organizationId"
FROM "SalesOpportunity" AS opportunity WHERE target."organizationId" IS NULL AND target."opportunityId" = opportunity."id" AND opportunity."organizationId" IS NOT NULL;

UPDATE "WeeklyDigestLog" SET "organizationId" = 'org_echo_spirits' WHERE "organizationId" IS NULL;
UPDATE "Tag" SET "organizationId" = 'org_echo_spirits' WHERE "organizationId" IS NULL;
UPDATE "MenuPlacement" SET "organizationId" = 'org_echo_spirits' WHERE "organizationId" IS NULL;
UPDATE "Recipe" SET "organizationId" = 'org_echo_spirits' WHERE "organizationId" IS NULL;
UPDATE "RecipeSuggestion" SET "organizationId" = 'org_echo_spirits' WHERE "organizationId" IS NULL;
UPDATE "TargetAccountProfile" SET "organizationId" = 'org_echo_spirits' WHERE "organizationId" IS NULL;
UPDATE "LocationTag" SET "organizationId" = 'org_echo_spirits' WHERE "organizationId" IS NULL;
UPDATE "LocationContact" SET "organizationId" = 'org_echo_spirits' WHERE "organizationId" IS NULL;
UPDATE "LoggedVisit" SET "organizationId" = 'org_echo_spirits' WHERE "organizationId" IS NULL;
UPDATE "VisitPhoto" SET "organizationId" = 'org_echo_spirits' WHERE "organizationId" IS NULL;
UPDATE "WorklistItem" SET "organizationId" = 'org_echo_spirits' WHERE "organizationId" IS NULL;
UPDATE "AgencyProductIntelligence" SET "organizationId" = 'org_echo_spirits' WHERE "organizationId" IS NULL;
UPDATE "AgencyIntelligenceSummary" SET "organizationId" = 'org_echo_spirits' WHERE "organizationId" IS NULL;
UPDATE "AgencyIntelligenceEvent" SET "organizationId" = 'org_echo_spirits' WHERE "organizationId" IS NULL;
UPDATE "OpportunityAccountSignal" SET "organizationId" = 'org_echo_spirits' WHERE "organizationId" IS NULL;
UPDATE "AccountSalesEvent" SET "organizationId" = 'org_echo_spirits' WHERE "organizationId" IS NULL;
UPDATE "SalesOpportunity" SET "organizationId" = 'org_echo_spirits' WHERE "organizationId" IS NULL;
UPDATE "OpportunityEvent" SET "organizationId" = 'org_echo_spirits' WHERE "organizationId" IS NULL;

-- AlterTable
ALTER TABLE "AccountSalesEvent" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "AgencyIntelligenceEvent" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "AgencyIntelligenceSummary" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "AgencyProductIntelligence" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "LocationContact" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "LocationTag" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "LoggedVisit" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "MenuPlacement" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "OpportunityAccountSignal" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "OpportunityEvent" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "appName" TEXT NOT NULL DEFAULT 'Neat',
ADD COLUMN     "brandAccentColor" TEXT NOT NULL DEFAULT '#6d28d9',
ADD COLUMN     "brandPrimaryColor" TEXT NOT NULL DEFAULT '#2458ff',
ADD COLUMN     "contactEmail" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "contactPhone" TEXT,
ADD COLUMN     "digestName" TEXT NOT NULL DEFAULT 'Neat',
ADD COLUMN     "productLabel" TEXT NOT NULL DEFAULT 'product',
ADD COLUMN     "productPluralLabel" TEXT NOT NULL DEFAULT 'products',
ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "supportEmail" TEXT;

UPDATE "Organization"
SET "productLabel" = 'Echo', "productPluralLabel" = 'Echo items'
WHERE "id" = 'org_echo_spirits';

-- AlterTable
ALTER TABLE "Recipe" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "RecipeSuggestion" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "SalesOpportunity" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Tag" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "TargetAccountProfile" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "UserInvitation" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveredTo" TEXT,
ADD COLUMN     "deliveryStatus" "InvitationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "lastError" TEXT;

-- AlterTable
ALTER TABLE "VisitPhoto" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "WeeklyDigestLog" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "WorklistItem" ALTER COLUMN "organizationId" SET NOT NULL;

-- CreateTable
CREATE TABLE "OrganizationProvisioningRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "ProvisioningRunStatus" NOT NULL DEFAULT 'PENDING',
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "currentStep" "ProvisioningStepKind",
    "requestedByUserId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationProvisioningRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationProvisioningStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" "ProvisioningStepKind" NOT NULL,
    "status" "ProvisioningStepStatus" NOT NULL DEFAULT 'PENDING',
    "sequence" INTEGER NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "input" JSONB,
    "output" JSONB,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationProvisioningStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationProvisioningRun_organizationId_createdAt_idx" ON "OrganizationProvisioningRun"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "OrganizationProvisioningRun_status_createdAt_idx" ON "OrganizationProvisioningRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OrganizationProvisioningStep_status_updatedAt_idx" ON "OrganizationProvisioningStep"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationProvisioningStep_runId_kind_key" ON "OrganizationProvisioningStep"("runId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationProvisioningStep_runId_sequence_key" ON "OrganizationProvisioningStep"("runId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "AccountSalesEvent_organizationId_sourceKey_key" ON "AccountSalesEvent"("organizationId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "AgencyIntelligenceEvent_organizationId_eventKey_key" ON "AgencyIntelligenceEvent"("organizationId", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "AgencyIntelligenceSummary_organizationId_agencyId_key" ON "AgencyIntelligenceSummary"("organizationId", "agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "AgencyProductIntelligence_organizationId_agencyId_itemCode_key" ON "AgencyProductIntelligence"("organizationId", "agencyId", "itemCode");

-- CreateIndex
CREATE UNIQUE INDEX "LocationTag_organizationId_tagId_agencyId_key" ON "LocationTag"("organizationId", "tagId", "agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "LocationTag_organizationId_tagId_wholesaleAccountId_key" ON "LocationTag"("organizationId", "tagId", "wholesaleAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "LoggedVisit_organizationId_submissionKey_key" ON "LoggedVisit"("organizationId", "submissionKey");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityAccountSignal_organizationId_wholesaleAccountId_key" ON "OpportunityAccountSignal"("organizationId", "wholesaleAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Recipe_organizationId_importKey_key" ON "Recipe"("organizationId", "importKey");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeSuggestion_organizationId_recipeId_wholesaleAccountId_key" ON "RecipeSuggestion"("organizationId", "recipeId", "wholesaleAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOpportunity_organizationId_activeAccountKey_key" ON "SalesOpportunity"("organizationId", "activeAccountKey");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_organizationId_name_key" ON "Tag"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TargetAccountProfile_organizationId_wholesaleAccountId_key" ON "TargetAccountProfile"("organizationId", "wholesaleAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyDigestLog_organizationId_digestType_recipientEmail_pe_key" ON "WeeklyDigestLog"("organizationId", "digestType", "recipientEmail", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "WorklistItem_organizationId_submissionKey_key" ON "WorklistItem"("organizationId", "submissionKey");

-- AddForeignKey
ALTER TABLE "OrganizationProvisioningRun" ADD CONSTRAINT "OrganizationProvisioningRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationProvisioningStep" ADD CONSTRAINT "OrganizationProvisioningStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "OrganizationProvisioningRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyDigestLog" ADD CONSTRAINT "WeeklyDigestLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuPlacement" ADD CONSTRAINT "MenuPlacement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeSuggestion" ADD CONSTRAINT "RecipeSuggestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TargetAccountProfile" ADD CONSTRAINT "TargetAccountProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationTag" ADD CONSTRAINT "LocationTag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationContact" ADD CONSTRAINT "LocationContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoggedVisit" ADD CONSTRAINT "LoggedVisit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitPhoto" ADD CONSTRAINT "VisitPhoto_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorklistItem" ADD CONSTRAINT "WorklistItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyProductIntelligence" ADD CONSTRAINT "AgencyProductIntelligence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyIntelligenceSummary" ADD CONSTRAINT "AgencyIntelligenceSummary_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyIntelligenceEvent" ADD CONSTRAINT "AgencyIntelligenceEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityAccountSignal" ADD CONSTRAINT "OpportunityAccountSignal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountSalesEvent" ADD CONSTRAINT "AccountSalesEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOpportunity" ADD CONSTRAINT "SalesOpportunity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityEvent" ADD CONSTRAINT "OpportunityEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
