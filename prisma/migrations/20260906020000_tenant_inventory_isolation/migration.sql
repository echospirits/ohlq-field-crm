ALTER TYPE "OrganizationAuditAction" ADD VALUE IF NOT EXISTS 'OHLQ_INVENTORY_CREDENTIALS_CHANGED';

ALTER TABLE "OhlqAgencyInventorySnapshot" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "OhlqAgencyInventoryCurrent" ADD COLUMN "organizationId" TEXT;

UPDATE "OhlqAgencyInventorySnapshot" SET "organizationId" = 'org_echo_spirits' WHERE "organizationId" IS NULL;
UPDATE "OhlqAgencyInventoryCurrent" SET "organizationId" = 'org_echo_spirits' WHERE "organizationId" IS NULL;

ALTER TABLE "OhlqAgencyInventorySnapshot" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "OhlqAgencyInventoryCurrent" ALTER COLUMN "organizationId" SET NOT NULL;

ALTER TABLE "OhlqAgencyInventorySnapshot" DROP CONSTRAINT "OhlqAgencyInventorySnapshot_pkey";
ALTER TABLE "OhlqAgencyInventorySnapshot" ADD CONSTRAINT "OhlqAgencyInventorySnapshot_pkey" PRIMARY KEY ("organizationId", "snapshotDate", "agencyNumber", "itemCode");
ALTER TABLE "OhlqAgencyInventoryCurrent" DROP CONSTRAINT "OhlqAgencyInventoryCurrent_pkey";
ALTER TABLE "OhlqAgencyInventoryCurrent" ADD CONSTRAINT "OhlqAgencyInventoryCurrent_pkey" PRIMARY KEY ("organizationId", "agencyNumber", "itemCode");

ALTER TABLE "OhlqAgencyInventorySnapshot" ADD CONSTRAINT "OhlqAgencyInventorySnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OhlqAgencyInventoryCurrent" ADD CONSTRAINT "OhlqAgencyInventoryCurrent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "OhlqAgencyInventorySnapshot_organizationId_snapshotDate_idx" ON "OhlqAgencyInventorySnapshot"("organizationId", "snapshotDate");
CREATE INDEX "OhlqAgencyInventoryCurrent_organizationId_snapshotDate_idx" ON "OhlqAgencyInventoryCurrent"("organizationId", "snapshotDate");

CREATE TABLE "OrganizationOhlqCredentials" (
  "organizationId" TEXT NOT NULL,
  "usernameEncrypted" TEXT NOT NULL,
  "passwordEncrypted" TEXT NOT NULL,
  "usernameHint" TEXT NOT NULL,
  "configuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedByUserId" TEXT,
  CONSTRAINT "OrganizationOhlqCredentials_pkey" PRIMARY KEY ("organizationId"),
  CONSTRAINT "OrganizationOhlqCredentials_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "OhlqTenantInventoryImportStatus" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "reportDate" DATE NOT NULL,
  "status" "OhlqReportRunStatus" NOT NULL,
  "rowCount" INTEGER NOT NULL DEFAULT 0,
  "parsedRows" INTEGER NOT NULL DEFAULT 0,
  "skippedRows" INTEGER NOT NULL DEFAULT 0,
  "replacedRows" INTEGER NOT NULL DEFAULT 0,
  "sizeBytes" INTEGER NOT NULL DEFAULT 0,
  "filename" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "lastSuccessfulAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "diagnostics" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OhlqTenantInventoryImportStatus_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OhlqTenantInventoryImportStatus_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OhlqTenantInventoryImportStatus_organizationId_reportDate_key" ON "OhlqTenantInventoryImportStatus"("organizationId", "reportDate");
CREATE INDEX "OhlqTenantInventoryImportStatus_organizationId_status_idx" ON "OhlqTenantInventoryImportStatus"("organizationId", "status");
CREATE INDEX "OhlqTenantInventoryImportStatus_lastSuccessfulAt_idx" ON "OhlqTenantInventoryImportStatus"("lastSuccessfulAt");
