CREATE TYPE "AccountResearchPilotStatus" AS ENUM ('RUNNING', 'PAUSED', 'READY_FOR_REVIEW', 'COMPLETE', 'CANCELLED', 'FAILED');

CREATE TYPE "AccountResearchJobStatus" AS ENUM ('QUEUED', 'SUBMITTED', 'RUNNING', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'FAILED', 'BLOCKED_BUDGET');

CREATE TYPE "AccountResearchTier" AS ENUM ('LIGHTWEIGHT', 'DEEP');

CREATE TABLE "AccountResearchPilot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "AccountResearchPilotStatus" NOT NULL DEFAULT 'RUNNING',
    "model" TEXT NOT NULL,
    "maxAccounts" INTEGER NOT NULL DEFAULT 50,
    "budgetLimitMicros" INTEGER NOT NULL DEFAULT 20000000,
    "reservedMicros" INTEGER NOT NULL DEFAULT 0,
    "estimatedSpendMicros" INTEGER NOT NULL DEFAULT 0,
    "pricingSnapshot" JSONB NOT NULL,
    "startedByUserId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPolledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountResearchPilot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountResearchJob" (
    "id" TEXT NOT NULL,
    "pilotId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "wholesaleAccountId" TEXT NOT NULL,
    "tier" "AccountResearchTier" NOT NULL,
    "status" "AccountResearchJobStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "responseId" TEXT,
    "result" JSONB,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "locationValidation" JSONB,
    "reservedMicros" INTEGER NOT NULL DEFAULT 400000,
    "estimatedCostMicros" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "webSearchCalls" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountResearchJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountResearchJob_responseId_key" ON "AccountResearchJob"("responseId");
CREATE UNIQUE INDEX "AccountResearchJob_pilotId_wholesaleAccountId_key" ON "AccountResearchJob"("pilotId", "wholesaleAccountId");
CREATE INDEX "AccountResearchPilot_organizationId_status_idx" ON "AccountResearchPilot"("organizationId", "status");
CREATE INDEX "AccountResearchPilot_startedAt_idx" ON "AccountResearchPilot"("startedAt");
CREATE INDEX "AccountResearchJob_pilotId_status_priority_idx" ON "AccountResearchJob"("pilotId", "status", "priority");
CREATE INDEX "AccountResearchJob_organizationId_status_idx" ON "AccountResearchJob"("organizationId", "status");
CREATE INDEX "AccountResearchJob_wholesaleAccountId_createdAt_idx" ON "AccountResearchJob"("wholesaleAccountId", "createdAt");

ALTER TABLE "AccountResearchPilot" ADD CONSTRAINT "AccountResearchPilot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountResearchJob" ADD CONSTRAINT "AccountResearchJob_pilotId_fkey" FOREIGN KEY ("pilotId") REFERENCES "AccountResearchPilot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountResearchJob" ADD CONSTRAINT "AccountResearchJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountResearchJob" ADD CONSTRAINT "AccountResearchJob_wholesaleAccountId_fkey" FOREIGN KEY ("wholesaleAccountId") REFERENCES "WholesaleAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
