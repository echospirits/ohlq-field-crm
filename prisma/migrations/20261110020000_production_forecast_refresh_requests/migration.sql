-- Additive request status/history only. Existing source and forecast facts are unchanged.
-- Production does not have the unrelated TST tasting index. This compatible
-- identity index supports only the tenant-scoped requester foreign key below.
CREATE UNIQUE INDEX IF NOT EXISTS "User_organizationId_id_key" ON "User"("organizationId", "id");
CREATE TABLE "ProductionForecastRefreshRequest" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "stage" TEXT NOT NULL DEFAULT 'QUEUED',
  "activeKey" TEXT,
  "leaseToken" TEXT,
  "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3),
  "expiresAt" TIMESTAMPTZ(3),
  "heartbeatAt" TIMESTAMPTZ(3),
  "workflowRunId" TEXT,
  "failureCode" TEXT,
  "result" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "ProductionForecastRefreshRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "forecast_refresh_status_check" CHECK ("status" IN ('QUEUED','RUNNING','SUCCEEDED','PARTIAL','FAILED','TIMED_OUT')),
  CONSTRAINT "forecast_refresh_stage_check" CHECK ("stage" IN ('QUEUED','BAILMENT','GUIDANCE','FORECAST','OPERATIONS','COMPLETE')),
  CONSTRAINT "forecast_refresh_lifecycle_check" CHECK (
    ("status" = 'QUEUED' AND "activeKey" IS NOT NULL AND "activeKey" = "organizationId" AND "expiresAt" IS NOT NULL AND "startedAt" IS NULL AND "completedAt" IS NULL AND "leaseToken" IS NULL)
    OR ("status" = 'RUNNING' AND "activeKey" IS NOT NULL AND "activeKey" = "organizationId" AND "expiresAt" IS NOT NULL AND "startedAt" IS NOT NULL AND "completedAt" IS NULL AND "leaseToken" IS NOT NULL)
    OR ("status" IN ('SUCCEEDED','PARTIAL','FAILED','TIMED_OUT') AND "activeKey" IS NULL AND "expiresAt" IS NULL AND "completedAt" IS NOT NULL AND "leaseToken" IS NULL)
  )
);
CREATE UNIQUE INDEX "forecast_refresh_active_tenant_key" ON "ProductionForecastRefreshRequest"("activeKey");
CREATE UNIQUE INDEX "forecast_refresh_tenant_id_key" ON "ProductionForecastRefreshRequest"("organizationId","id");
CREATE INDEX "forecast_refresh_history_idx" ON "ProductionForecastRefreshRequest"("organizationId","requestedAt");
ALTER TABLE "ProductionForecastRefreshRequest" ADD CONSTRAINT "forecast_refresh_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionForecastRefreshRequest" ADD CONSTRAINT "forecast_refresh_requester_fkey" FOREIGN KEY ("organizationId","requestedByUserId") REFERENCES "User"("organizationId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
