-- Extend tenant-owned contacts without changing their stable identity.
ALTER TABLE "LocationContact"
  ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "source" TEXT,
  ADD COLUMN "externalSourceId" TEXT;

CREATE INDEX "LocationContact_organizationId_agencyId_active_idx"
  ON "LocationContact"("organizationId", "agencyId", "active");
CREATE INDEX "LocationContact_organizationId_wholesaleAccountId_active_idx"
  ON "LocationContact"("organizationId", "wholesaleAccountId", "active");
CREATE INDEX "LocationContact_organizationId_source_externalSourceId_idx"
  ON "LocationContact"("organizationId", "source", "externalSourceId");

UPDATE "LocationContact" SET "isPrimary" = true WHERE LOWER(COALESCE("role", '')) = 'primary contact';

CREATE TYPE "AccountActivityType" AS ENUM ('EMAIL_INITIATED', 'CALL_INITIATED');

CREATE TABLE "LoggedVisitContact" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "loggedVisitId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoggedVisitContact_pkey" PRIMARY KEY ("id")
);

-- Preserve every existing historical visit/contact association.
INSERT INTO "LoggedVisitContact" ("id", "organizationId", "loggedVisitId", "contactId", "createdAt")
SELECT CONCAT('legacy-', "id"), "organizationId", "id", "contactId", "createdAt"
FROM "LoggedVisit"
WHERE "contactId" IS NOT NULL;

CREATE UNIQUE INDEX "LoggedVisitContact_loggedVisitId_contactId_key" ON "LoggedVisitContact"("loggedVisitId", "contactId");
CREATE INDEX "LoggedVisitContact_organizationId_loggedVisitId_idx" ON "LoggedVisitContact"("organizationId", "loggedVisitId");
CREATE INDEX "LoggedVisitContact_organizationId_contactId_idx" ON "LoggedVisitContact"("organizationId", "contactId");

ALTER TABLE "LoggedVisitContact" ADD CONSTRAINT "LoggedVisitContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoggedVisitContact" ADD CONSTRAINT "LoggedVisitContact_loggedVisitId_fkey" FOREIGN KEY ("loggedVisitId") REFERENCES "LoggedVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoggedVisitContact" ADD CONSTRAINT "LoggedVisitContact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "LocationContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AccountActivity" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "activityType" "AccountActivityType" NOT NULL,
  "contactId" TEXT NOT NULL,
  "agencyId" TEXT,
  "wholesaleAccountId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccountActivity_organizationId_agencyId_occurredAt_idx" ON "AccountActivity"("organizationId", "agencyId", "occurredAt");
CREATE INDEX "AccountActivity_organizationId_wholesaleAccountId_occurredAt_idx" ON "AccountActivity"("organizationId", "wholesaleAccountId", "occurredAt");
CREATE INDEX "AccountActivity_organizationId_contactId_occurredAt_idx" ON "AccountActivity"("organizationId", "contactId", "occurredAt");

ALTER TABLE "AccountActivity" ADD CONSTRAINT "AccountActivity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountActivity" ADD CONSTRAINT "AccountActivity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "LocationContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountActivity" ADD CONSTRAINT "AccountActivity_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
