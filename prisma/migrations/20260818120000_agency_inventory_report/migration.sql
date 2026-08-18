ALTER TYPE "OhlqReportDataSource" ADD VALUE 'AGENCY_INVENTORY_REPORT';

ALTER TABLE "OhlqReportImportStatus" ADD COLUMN "diagnostics" JSONB;

CREATE TABLE "OhlqAgencyInventorySnapshot" (
    "snapshotDate" DATE NOT NULL,
    "agencyNumber" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "agencyId" TEXT,
    "agencyName" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "status" TEXT,
    "detailCodeDescription" TEXT,
    "coverageGroup" TEXT,
    "minimum" INTEGER,
    "onHand" INTEGER,
    "vendorId" TEXT NOT NULL,
    "vendorName" TEXT,
    "brokerId" TEXT,
    "brokerName" TEXT,
    "district" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OhlqAgencyInventorySnapshot_pkey" PRIMARY KEY ("snapshotDate", "agencyNumber", "itemCode")
);

CREATE TABLE "OhlqAgencyInventoryCurrent" (
    "agencyNumber" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "agencyId" TEXT,
    "agencyName" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "status" TEXT,
    "detailCodeDescription" TEXT,
    "coverageGroup" TEXT,
    "minimum" INTEGER,
    "onHand" INTEGER,
    "vendorId" TEXT NOT NULL,
    "vendorName" TEXT,
    "brokerId" TEXT,
    "brokerName" TEXT,
    "district" TEXT,
    "snapshotDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OhlqAgencyInventoryCurrent_pkey" PRIMARY KEY ("agencyNumber", "itemCode")
);

CREATE INDEX "OhlqAgencyInventorySnapshot_agencyId_snapshotDate_idx" ON "OhlqAgencyInventorySnapshot"("agencyId", "snapshotDate");
CREATE INDEX "OhlqAgencyInventorySnapshot_agencyNumber_snapshotDate_idx" ON "OhlqAgencyInventorySnapshot"("agencyNumber", "snapshotDate");
CREATE INDEX "OhlqAgencyInventorySnapshot_agencyNumber_itemCode_idx" ON "OhlqAgencyInventorySnapshot"("agencyNumber", "itemCode");
CREATE INDEX "OhlqAgencyInventorySnapshot_itemCode_snapshotDate_idx" ON "OhlqAgencyInventorySnapshot"("itemCode", "snapshotDate");
CREATE INDEX "OhlqAgencyInventorySnapshot_snapshotDate_idx" ON "OhlqAgencyInventorySnapshot"("snapshotDate");
CREATE INDEX "OhlqAgencyInventorySnapshot_status_idx" ON "OhlqAgencyInventorySnapshot"("status");
CREATE INDEX "OhlqAgencyInventorySnapshot_onHand_idx" ON "OhlqAgencyInventorySnapshot"("onHand");
CREATE INDEX "OhlqAgencyInventoryCurrent_agencyId_itemCode_idx" ON "OhlqAgencyInventoryCurrent"("agencyId", "itemCode");
CREATE INDEX "OhlqAgencyInventoryCurrent_itemCode_onHand_idx" ON "OhlqAgencyInventoryCurrent"("itemCode", "onHand");
CREATE INDEX "OhlqAgencyInventoryCurrent_snapshotDate_idx" ON "OhlqAgencyInventoryCurrent"("snapshotDate");
CREATE INDEX "OhlqAgencyInventoryCurrent_status_idx" ON "OhlqAgencyInventoryCurrent"("status");

ALTER TABLE "OhlqAgencyInventorySnapshot" ADD CONSTRAINT "OhlqAgencyInventorySnapshot_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OhlqAgencyInventoryCurrent" ADD CONSTRAINT "OhlqAgencyInventoryCurrent_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;
