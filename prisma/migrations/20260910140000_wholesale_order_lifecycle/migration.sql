CREATE TYPE "WholesaleOrderStatus" AS ENUM ('PDF_GENERATED', 'SENT', 'FILED');

CREATE TYPE "WholesaleOrderFiledSource" AS ENUM ('AUTO_MATCH', 'MANUAL');

CREATE TABLE "WholesaleOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "wholesaleAccountId" TEXT NOT NULL,
    "directSaleLocationId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "saleDate" DATE NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerDba" TEXT,
    "customerPermitNumber" TEXT NOT NULL,
    "sellerName" TEXT NOT NULL,
    "sellerStoreNumber" TEXT NOT NULL,
    "subtotalCents" INTEGER NOT NULL,
    "sinTaxCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "pdfBytes" BYTEA NOT NULL,
    "pdfFilename" TEXT NOT NULL,
    "status" "WholesaleOrderStatus" NOT NULL DEFAULT 'PDF_GENERATED',
    "sentAt" TIMESTAMP(3),
    "sentByUserId" TEXT,
    "filedAt" TIMESTAMP(3),
    "filedByUserId" TEXT,
    "filedSource" "WholesaleOrderFiledSource",
    "matchedReportDate" DATE,
    "reconciliationEvidence" JSONB,
    "automaticMatchKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WholesaleOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WholesaleOrder_automaticMatchKey_key" ON "WholesaleOrder"("automaticMatchKey");
CREATE UNIQUE INDEX "WholesaleOrder_organizationId_clientRequestId_key" ON "WholesaleOrder"("organizationId", "clientRequestId");
CREATE INDEX "WholesaleOrder_organizationId_saleDate_createdAt_idx" ON "WholesaleOrder"("organizationId", "saleDate", "createdAt");
CREATE INDEX "WholesaleOrder_organizationId_status_saleDate_idx" ON "WholesaleOrder"("organizationId", "status", "saleDate");
CREATE INDEX "WholesaleOrder_wholesaleAccountId_saleDate_idx" ON "WholesaleOrder"("wholesaleAccountId", "saleDate");
CREATE INDEX "WholesaleOrder_customer_store_date_idx" ON "WholesaleOrder"("customerPermitNumber", "sellerStoreNumber", "saleDate");

ALTER TABLE "WholesaleOrder" ADD CONSTRAINT "WholesaleOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WholesaleOrder" ADD CONSTRAINT "WholesaleOrder_wholesaleAccountId_fkey" FOREIGN KEY ("wholesaleAccountId") REFERENCES "WholesaleAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WholesaleOrder" ADD CONSTRAINT "WholesaleOrder_directSaleLocationId_fkey" FOREIGN KEY ("directSaleLocationId") REFERENCES "OrganizationA3aStoreIdentifier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WholesaleOrder" ADD CONSTRAINT "WholesaleOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WholesaleOrder" ADD CONSTRAINT "WholesaleOrder_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WholesaleOrder" ADD CONSTRAINT "WholesaleOrder_filedByUserId_fkey" FOREIGN KEY ("filedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
