-- Additive operational context only. Existing forecasts and source facts are untouched.
CREATE TABLE "OrganizationOperationalCredential" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "usernameEncrypted" TEXT NOT NULL,
  "passwordEncrypted" TEXT NOT NULL,
  "usernameHint" TEXT NOT NULL,
  "configuredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedByUserId" TEXT,
  CONSTRAINT "OrganizationOperationalCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "operational_credential_provider_check" CHECK (length("provider") BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX "operational_credential_tenant_provider_key" ON "OrganizationOperationalCredential"("organizationId", "provider");
ALTER TABLE "OrganizationOperationalCredential" ADD CONSTRAINT "OrganizationOperationalCredential_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DeliveryAvailabilityObservation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "market" TEXT NOT NULL,
  "locationCode" TEXT NOT NULL,
  "locationName" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "loadTypeId" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "observedOn" DATE NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL,
  "earliestAvailableAt" TIMESTAMP(3),
  "earliestAvailableDate" DATE,
  "rawEarliestAvailableAt" TEXT,
  "calendarDays" INTEGER,
  "businessDays" INTEGER,
  "businessDayMethod" TEXT,
  "checkedThrough" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryAvailabilityObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_observation_range_check" CHECK ("checkedThrough" >= "observedAt"),
  CONSTRAINT "delivery_observation_value_check" CHECK (
    ("status" = 'SUCCESS' AND "earliestAvailableAt" IS NOT NULL AND "earliestAvailableDate" IS NOT NULL
      AND "rawEarliestAvailableAt" IS NOT NULL AND "calendarDays" IS NOT NULL AND "calendarDays" >= 0
      AND "earliestAvailableAt" >= "observedAt" AND "earliestAvailableAt" <= "checkedThrough")
    OR ("status" = 'NO_AVAILABILITY' AND "earliestAvailableAt" IS NULL AND "earliestAvailableDate" IS NULL
      AND "rawEarliestAvailableAt" IS NULL AND "calendarDays" IS NULL AND "businessDays" IS NULL AND "businessDayMethod" IS NULL)
  ),
  CONSTRAINT "delivery_business_days_check" CHECK (
    ("businessDays" IS NULL AND "businessDayMethod" IS NULL)
    OR ("businessDays" IS NOT NULL AND "businessDayMethod" IS NOT NULL AND "businessDays" >= 0 AND "businessDays" <= "calendarDays" AND "businessDayMethod" = 'SOURCE_OPERATING_CALENDAR')
  )
);
CREATE UNIQUE INDEX "delivery_observation_tenant_location_day_key" ON "DeliveryAvailabilityObservation"("organizationId", "market", "locationCode", "source", "observedOn");
CREATE UNIQUE INDEX "delivery_observation_tenant_id_key" ON "DeliveryAvailabilityObservation"("organizationId", "id");
CREATE INDEX "delivery_observation_history_idx" ON "DeliveryAvailabilityObservation"("organizationId", "market", "locationCode", "source", "observedAt");
ALTER TABLE "DeliveryAvailabilityObservation" ADD CONSTRAINT "DeliveryAvailabilityObservation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DeliveryAvailabilityCheck" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "market" TEXT NOT NULL,
  "locationCode" TEXT NOT NULL,
  "locationName" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "loadTypeId" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "observedOn" DATE NOT NULL,
  "attemptedAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL,
  "diagnosticCode" TEXT,
  "checkedThrough" TIMESTAMP(3),
  "attemptCount" INTEGER NOT NULL DEFAULT 1,
  "observationId" TEXT,
  CONSTRAINT "DeliveryAvailabilityCheck_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_check_status_check" CHECK ("status" IN ('SUCCESS','NO_AVAILABILITY','AUTH_FAILED','UNAVAILABLE','INVALID_RESPONSE','NOT_CONFIGURED')),
  CONSTRAINT "delivery_check_count_check" CHECK ("attemptCount" > 0)
);
CREATE UNIQUE INDEX "delivery_check_tenant_location_day_key" ON "DeliveryAvailabilityCheck"("organizationId", "market", "locationCode", "source", "observedOn");
CREATE INDEX "delivery_check_history_idx" ON "DeliveryAvailabilityCheck"("organizationId", "market", "locationCode", "source", "attemptedAt");
ALTER TABLE "DeliveryAvailabilityCheck" ADD CONSTRAINT "DeliveryAvailabilityCheck_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliveryAvailabilityCheck" ADD CONSTRAINT "DeliveryAvailabilityCheck_organizationId_observationId_fkey"
  FOREIGN KEY ("organizationId", "observationId") REFERENCES "DeliveryAvailabilityObservation"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CurrentDemandObservation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "market" TEXT NOT NULL,
  "itemCode" TEXT NOT NULL,
  "businessDate" DATE NOT NULL,
  "sourceObservedAt" TIMESTAMPTZ(3) NOT NULL,
  "sourceUpdatedAt" TIMESTAMPTZ(3),
  "source" TEXT NOT NULL DEFAULT 'OPS_OHLQ_ITEM_COVERAGE',
  "calculationVersion" TEXT NOT NULL DEFAULT 'agency-min-v1',
  "locationCode" TEXT NOT NULL DEFAULT 'UNASSIGNED',
  "grossCases" DECIMAL(14,4) NOT NULL,
  "inboundCases" DECIMAL(14,4),
  "demandCases" DECIMAL(14,4),
  "cases" DECIMAL(14,4),
  "bottlesPerCase" INTEGER NOT NULL,
  "agencyCount" INTEGER NOT NULL,
  "summary" JSONB NOT NULL DEFAULT '{}',
  "evidence" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CurrentDemandObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "current_demand_quantities_check" CHECK (
    "grossCases" >= 0 AND ("inboundCases" IS NULL OR "inboundCases" >= 0)
    AND ("demandCases" IS NULL OR "demandCases" >= 0) AND ("cases" IS NULL OR "cases" >= 0)
    AND "bottlesPerCase" > 0 AND "agencyCount" >= 0
    AND ("cases" IS NOT DISTINCT FROM "demandCases")
  )
);
CREATE UNIQUE INDEX "current_demand_tenant_product_day_key" ON "CurrentDemandObservation"("organizationId", "productId", "businessDate");
CREATE UNIQUE INDEX "current_demand_tenant_id_key" ON "CurrentDemandObservation"("organizationId", "id");
CREATE INDEX "current_demand_history_idx" ON "CurrentDemandObservation"("organizationId", "market", "productId", "sourceObservedAt");
ALTER TABLE "CurrentDemandObservation" ADD CONSTRAINT "CurrentDemandObservation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CurrentDemandObservation" ADD CONSTRAINT "CurrentDemandObservation_organizationId_productId_fkey"
  FOREIGN KEY ("organizationId", "productId") REFERENCES "OrganizationProduct"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CurrentDemandCheck" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "businessDate" DATE NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'OPS_OHLQ_ITEM_COVERAGE',
  "checkedAt" TIMESTAMPTZ(3) NOT NULL,
  "status" TEXT NOT NULL,
  "reason" TEXT,
  "evidence" JSONB,
  "observationId" TEXT,
  CONSTRAINT "CurrentDemandCheck_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "current_demand_check_status_check" CHECK ("status" IN ('AVAILABLE','PARTIAL','UNAVAILABLE','FAILED'))
);
CREATE UNIQUE INDEX "current_demand_check_tenant_product_day_key" ON "CurrentDemandCheck"("organizationId", "productId", "businessDate");
CREATE INDEX "current_demand_check_history_idx" ON "CurrentDemandCheck"("organizationId", "productId", "checkedAt");
ALTER TABLE "CurrentDemandCheck" ADD CONSTRAINT "CurrentDemandCheck_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CurrentDemandCheck" ADD CONSTRAINT "CurrentDemandCheck_organizationId_productId_fkey"
  FOREIGN KEY ("organizationId", "productId") REFERENCES "OrganizationProduct"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CurrentDemandCheck" ADD CONSTRAINT "CurrentDemandCheck_organizationId_observationId_fkey"
  FOREIGN KEY ("organizationId", "observationId") REFERENCES "CurrentDemandObservation"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
