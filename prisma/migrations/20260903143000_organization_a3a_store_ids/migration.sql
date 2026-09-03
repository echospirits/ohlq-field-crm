-- Store organization-owned A3A locations independently from shared OHLQ account data.
CREATE TABLE "OrganizationA3aStoreIdentifier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'OH',
    "storeId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationA3aStoreIdentifier_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationA3aStoreIdentifier_organizationId_market_storeId_key"
ON "OrganizationA3aStoreIdentifier"("organizationId", "market", "storeId");

CREATE INDEX "OrganizationA3aStoreIdentifier_market_storeId_idx"
ON "OrganizationA3aStoreIdentifier"("market", "storeId");

CREATE INDEX "OrganizationA3aStoreIdentifier_organizationId_active_idx"
ON "OrganizationA3aStoreIdentifier"("organizationId", "active");

ALTER TABLE "OrganizationA3aStoreIdentifier"
ADD CONSTRAINT "OrganizationA3aStoreIdentifier_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TYPE "OrganizationAuditAction" ADD VALUE 'A3A_STORE_CONFIGURATION_CHANGED';
