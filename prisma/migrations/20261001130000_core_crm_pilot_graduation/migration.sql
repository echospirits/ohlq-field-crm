-- Graduate the three former opt-in Pilots for existing Core CRM tenants.
-- Keep non-Core tenants and Intelligence entitlements unchanged.
BEGIN;
INSERT INTO "OrganizationFeature" ("id", "organizationId", "featureKey", "enabled", "source", "createdAt", "updatedAt")
SELECT 'core014_' || md5(core."organizationId" || ':' || feature.key),
       core."organizationId", feature.key, true, 'core-crm-0.14', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "OrganizationFeature" core
CROSS JOIN (VALUES ('ACCOUNT_SALES_STATUS'), ('ANALYTICS'), ('OHIO_DIRECT_WHOLESALE_ORDERS')) AS feature(key)
WHERE core."featureKey" = 'CORE_CRM' AND core."enabled" = true
ON CONFLICT ("organizationId", "featureKey") DO UPDATE
SET "enabled" = true, "source" = 'core-crm-0.14', "updatedAt" = CURRENT_TIMESTAMP;
COMMIT;
