CREATE TABLE "ContactImportSession" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "accountType" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "returnPath" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContactImportSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactImportSession_tokenHash_key" ON "ContactImportSession"("tokenHash");
CREATE INDEX "ContactImportSession_userId_expiresAt_idx" ON "ContactImportSession"("userId", "expiresAt");
CREATE INDEX "ContactImportSession_organizationId_expiresAt_idx" ON "ContactImportSession"("organizationId", "expiresAt");
CREATE INDEX "ContactImportSession_expiresAt_idx" ON "ContactImportSession"("expiresAt");

ALTER TABLE "ContactImportSession" ADD CONSTRAINT "ContactImportSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactImportSession" ADD CONSTRAINT "ContactImportSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
