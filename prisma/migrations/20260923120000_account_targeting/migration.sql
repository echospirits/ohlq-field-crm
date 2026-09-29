ALTER TABLE "OrganizationAccountOverlay"
  ADD COLUMN "isTargeting" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "targetingUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "targetingUpdatedBy" TEXT;
CREATE INDEX "OrganizationAccountOverlay_organizationId_accountType_isTar_idx"
  ON "OrganizationAccountOverlay"("organizationId", "accountType", "isTargeting");

CREATE TABLE "AccountTargetingHistory" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "accountType" "SalesAccountType" NOT NULL,
  "externalAccountId" TEXT NOT NULL,
  "isTargeting" BOOLEAN NOT NULL,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "changedByUserId" TEXT,
  "loggedVisitId" TEXT,
  CONSTRAINT "AccountTargetingHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccountTargetingHistory_organizationId_accountType_external_idx"
  ON "AccountTargetingHistory"("organizationId", "accountType", "externalAccountId", "changedAt");
CREATE INDEX "AccountTargetingHistory_loggedVisitId_idx"
  ON "AccountTargetingHistory"("loggedVisitId");
ALTER TABLE "AccountTargetingHistory"
  ADD CONSTRAINT "AccountTargetingHistory_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
