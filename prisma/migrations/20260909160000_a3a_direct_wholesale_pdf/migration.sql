ALTER TABLE "OrganizationA3aStoreIdentifier"
ADD COLUMN "name" TEXT,
ADD COLUMN "dba" TEXT,
ADD COLUMN "permitNumber" TEXT,
ADD COLUMN "addressLine1" TEXT,
ADD COLUMN "addressLine2" TEXT,
ADD COLUMN "city" TEXT,
ADD COLUMN "state" TEXT NOT NULL DEFAULT 'OH',
ADD COLUMN "postalCode" TEXT,
ADD COLUMN "phone" TEXT,
ADD COLUMN "email" TEXT,
ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "OrganizationA3aStoreIdentifier_organizationId_isDefault_active_idx"
ON "OrganizationA3aStoreIdentifier"("organizationId", "isDefault", "active");
