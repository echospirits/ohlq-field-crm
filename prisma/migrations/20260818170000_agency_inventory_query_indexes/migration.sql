CREATE INDEX "OhlqAgencyInventorySnapshot_agencyId_itemCode_snapshotDate_idx"
ON "OhlqAgencyInventorySnapshot"("agencyId", "itemCode", "snapshotDate");

CREATE INDEX "OhlqAgencyInventorySnapshot_agencyNumber_itemCode_snapshotD_idx"
ON "OhlqAgencyInventorySnapshot"("agencyNumber", "itemCode", "snapshotDate");

DROP INDEX IF EXISTS "OhlqAgencyInventorySnapshot_agencyNumber_itemCode_idx";

CREATE INDEX "OhlqAgencyInventorySnapshot_vendorId_idx"
ON "OhlqAgencyInventorySnapshot"("vendorId");

CREATE INDEX "OhlqAgencyInventoryCurrent_vendorId_idx"
ON "OhlqAgencyInventoryCurrent"("vendorId");
