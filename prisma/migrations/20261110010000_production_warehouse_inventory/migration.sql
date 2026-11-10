-- Additive planning context only; no existing source, product or sales data changes.
CREATE TABLE "CurrentDcInventoryObservation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "market" TEXT NOT NULL DEFAULT 'OH',
  "itemCode" TEXT NOT NULL,
  "locationCode" TEXT NOT NULL,
  "businessDate" DATE NOT NULL,
  "sourceBusinessDate" DATE NOT NULL,
  "sourceObservedAt" TIMESTAMPTZ(3) NOT NULL,
  "sourceUpdatedAt" TIMESTAMPTZ(3),
  "source" TEXT NOT NULL DEFAULT 'OHLQ_POWER_BI_DC_INVENTORY',
  "reportId" TEXT NOT NULL,
  "adapterVersion" TEXT NOT NULL,
  "quantityCases" DECIMAL(14,4) NOT NULL,
  "pickedCases" DECIMAL(14,4) NOT NULL,
  "inventoryCases" DECIMAL(14,4) NOT NULL,
  "evidence" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CurrentDcInventoryObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dc_inventory_scope_check" CHECK ("market" = 'OH' AND "locationCode" IN ('GPT','GRN') AND "source" = 'OHLQ_POWER_BI_DC_INVENTORY'),
  CONSTRAINT "dc_inventory_date_check" CHECK ("sourceBusinessDate" = "businessDate" AND ("sourceUpdatedAt" IS NULL OR "sourceUpdatedAt" <= "sourceObservedAt")),
  CONSTRAINT "dc_inventory_quantity_check" CHECK ("quantityCases" >= 0 AND "pickedCases" >= 0 AND "inventoryCases" = "quantityCases" + "pickedCases")
);
CREATE UNIQUE INDEX "dc_inventory_tenant_product_location_day_key" ON "CurrentDcInventoryObservation"("organizationId","productId","locationCode","businessDate");
CREATE UNIQUE INDEX "dc_inventory_tenant_id_key" ON "CurrentDcInventoryObservation"("organizationId","id");
CREATE INDEX "dc_inventory_history_idx" ON "CurrentDcInventoryObservation"("organizationId","productId","locationCode","sourceObservedAt");
ALTER TABLE "CurrentDcInventoryObservation" ADD CONSTRAINT "CurrentDcInventoryObservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CurrentDcInventoryObservation" ADD CONSTRAINT "CurrentDcInventoryObservation_product_fkey" FOREIGN KEY ("organizationId","productId") REFERENCES "OrganizationProduct"("organizationId","id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CurrentDcInventoryCheck" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "locationCode" TEXT NOT NULL,
  "businessDate" DATE NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'OHLQ_POWER_BI_DC_INVENTORY',
  "checkedAt" TIMESTAMPTZ(3) NOT NULL,
  "status" TEXT NOT NULL,
  "reason" TEXT,
  "evidence" JSONB,
  "observationId" TEXT,
  CONSTRAINT "CurrentDcInventoryCheck_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dc_inventory_check_scope_check" CHECK ("locationCode" IN ('GPT','GRN') AND "source" = 'OHLQ_POWER_BI_DC_INVENTORY'),
  CONSTRAINT "dc_inventory_check_status_check" CHECK ("status" IN ('AVAILABLE','UNAVAILABLE','FAILED'))
);
CREATE UNIQUE INDEX "dc_inventory_check_tenant_product_location_day_key" ON "CurrentDcInventoryCheck"("organizationId","productId","locationCode","businessDate");
CREATE INDEX "dc_inventory_check_history_idx" ON "CurrentDcInventoryCheck"("organizationId","productId","locationCode","checkedAt");
ALTER TABLE "CurrentDcInventoryCheck" ADD CONSTRAINT "CurrentDcInventoryCheck_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CurrentDcInventoryCheck" ADD CONSTRAINT "CurrentDcInventoryCheck_product_fkey" FOREIGN KEY ("organizationId","productId") REFERENCES "OrganizationProduct"("organizationId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CurrentDcInventoryCheck" ADD CONSTRAINT "CurrentDcInventoryCheck_observation_fkey" FOREIGN KEY ("organizationId","observationId") REFERENCES "CurrentDcInventoryObservation"("organizationId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
