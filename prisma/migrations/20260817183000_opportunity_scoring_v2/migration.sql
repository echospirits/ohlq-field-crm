ALTER TABLE "SalesOpportunity" ADD COLUMN "activeAccountKey" TEXT;

DROP INDEX "SalesOpportunity_wholesaleAccountId_type_cycleKey_key";
CREATE INDEX "SalesOpportunity_wholesaleAccountId_type_cycleKey_idx" ON "SalesOpportunity"("wholesaleAccountId", "type", "cycleKey");
CREATE UNIQUE INDEX "SalesOpportunity_activeAccountKey_key" ON "SalesOpportunity"("activeAccountKey");

ALTER TABLE "TargetPublicResearch"
  ADD COLUMN "websiteUrl" TEXT,
  ADD COLUMN "cocktailMenuUrl" TEXT,
  ADD COLUMN "localBrandsOnMenu" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "googleRating" DECIMAL(3,2),
  ADD COLUMN "googleReviewCount" INTEGER,
  ADD COLUMN "yelpRating" DECIMAL(3,2),
  ADD COLUMN "yelpReviewCount" INTEGER,
  ADD COLUMN "isNationalChain" BOOLEAN,
  ADD COLUMN "researchConfidence" TEXT,
  ADD COLUMN "lastAttemptedAt" TIMESTAMP(3),
  ADD COLUMN "lastRefreshedAt" TIMESTAMP(3),
  ADD COLUMN "refreshStatus" TEXT,
  ADD COLUMN "refreshError" TEXT,
  ADD COLUMN "researchModel" TEXT,
  ADD COLUMN "researchResponseId" TEXT;

CREATE INDEX "TargetPublicResearch_lastRefreshedAt_idx" ON "TargetPublicResearch"("lastRefreshedAt");
CREATE INDEX "TargetPublicResearch_refreshStatus_lastAttemptedAt_idx" ON "TargetPublicResearch"("refreshStatus", "lastAttemptedAt");
