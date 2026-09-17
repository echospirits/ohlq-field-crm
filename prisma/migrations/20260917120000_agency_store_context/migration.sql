BEGIN;
ALTER TABLE "OrganizationAccountOverlay" ADD COLUMN "storeContext" JSONB;
COMMIT;
