-- Preserve every accepted inventory fact while allowing newer same-day retrievals.
-- The existing daily uniqueness guarantees this stricter timestamped index can
-- be installed before the daily-only restriction is removed. Tenant/product
-- foreign keys, observation identities and daily checks remain unchanged.
CREATE UNIQUE INDEX "dc_inventory_tenant_product_location_day_observed_key" ON "CurrentDcInventoryObservation"("organizationId","productId","locationCode","businessDate","sourceObservedAt");
DROP INDEX "dc_inventory_tenant_product_location_day_key";
