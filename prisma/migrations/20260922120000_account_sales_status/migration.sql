CREATE TYPE "SalesAccountType" AS ENUM ('AGENCY', 'WHOLESALE');
CREATE TYPE "AccountSalesStatus" AS ENUM ('TARGET', 'CONTACTED', 'ENGAGED', 'INTERESTED', 'WAITING_ON_ORDER', 'PURCHASING', 'NURTURE', 'LOST');
CREATE TYPE "AccountSalesStatusSource" AS ENUM ('USER', 'VISIT', 'SALES_DATA', 'SYSTEM');

ALTER TABLE "OrganizationAccountOverlay"
  ADD COLUMN "salesStatus" "AccountSalesStatus",
  ADD COLUMN "salesStatusUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "salesStatusUpdatedBy" TEXT;

CREATE TABLE "AccountSalesStatusHistory" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "accountType" "SalesAccountType" NOT NULL,
  "externalAccountId" TEXT NOT NULL,
  "previousStatus" "AccountSalesStatus",
  "newStatus" "AccountSalesStatus" NOT NULL,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "changedByUserId" TEXT,
  "source" "AccountSalesStatusSource" NOT NULL,
  "loggedVisitId" TEXT,
  "context" TEXT,
  "purchaseSourceKey" TEXT,
  CONSTRAINT "AccountSalesStatusHistory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountSalesStatusHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "OrganizationAccountOverlay_organizationId_salesStatus_idx" ON "OrganizationAccountOverlay"("organizationId", "salesStatus");
CREATE UNIQUE INDEX "AccountSalesStatusHistory_organizationId_purchaseSourceKey_key" ON "AccountSalesStatusHistory"("organizationId", "purchaseSourceKey");
CREATE INDEX "AccountSalesStatusHistory_organizationId_accountType_externalAccountId_changedAt_idx" ON "AccountSalesStatusHistory"("organizationId", "accountType", "externalAccountId", "changedAt");
CREATE INDEX "AccountSalesStatusHistory_organizationId_newStatus_changedAt_idx" ON "AccountSalesStatusHistory"("organizationId", "newStatus", "changedAt");
CREATE INDEX "AccountSalesStatusHistory_loggedVisitId_idx" ON "AccountSalesStatusHistory"("loggedVisitId");

INSERT INTO "OrganizationFeature" ("id", "organizationId", "featureKey", "enabled", "source", "createdAt", "updatedAt")
SELECT 'org_echo_account_sales_status', "id", 'ACCOUNT_SALES_STATUS', true, 'migration', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Organization"
WHERE "id" = 'org_echo_spirits'
ON CONFLICT ("organizationId", "featureKey") DO UPDATE
SET "enabled" = true, "source" = 'migration', "updatedAt" = CURRENT_TIMESTAMP;
