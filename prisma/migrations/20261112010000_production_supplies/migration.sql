-- CreateTable
CREATE TABLE "SupplyCatalogItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "category" TEXT,
    "unit" TEXT,
    "packSize" DECIMAL(20,6),
    "departments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sharedUse" BOOLEAN NOT NULL DEFAULT false,
    "productAssociation" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyCatalogAlias" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "supplier" TEXT NOT NULL DEFAULT '',
    "sku" TEXT NOT NULL DEFAULT '',
    "unit" TEXT,
    "packSize" DECIMAL(20,6),

    CONSTRAINT "SupplyCatalogAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyClassificationRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "supplier" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "unit" TEXT,
    "packSize" DECIMAL(20,6),
    "department" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "reviewedByUserId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyClassificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "normalizedSupplier" TEXT NOT NULL,
    "orderReference" TEXT,
    "destination" TEXT,
    "ownerUserId" TEXT,
    "orderedAt" DATE,
    "invoiceDate" DATE,
    "paymentDate" DATE,
    "estimatedShipDate" DATE,
    "status" TEXT NOT NULL DEFAULT 'ORDERED',
    "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "historicalOutcomeUnknown" BOOLEAN NOT NULL DEFAULT false,
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT NOT NULL DEFAULT '',
    "manualFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastEvidenceAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyOrderLine" (
    "manualFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineKey" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" DECIMAL(20,6),
    "unit" TEXT,
    "packSize" DECIMAL(20,6),
    "catalogItemId" TEXT,
    "department" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
    "classificationSource" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "classificationConfidence" DOUBLE PRECISION,
    "classificationExplanation" TEXT NOT NULL DEFAULT 'Purchase purpose needs review.',
    "manualClassification" BOOLEAN NOT NULL DEFAULT false,
    "productionQuantity" DECIMAL(20,6),
    "barQuantity" DECIMAL(20,6),
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "backorderedQuantity" DECIMAL(20,6),
    "notes" TEXT NOT NULL DEFAULT '',
    "lastEvidenceAt" TIMESTAMP(3),

    CONSTRAINT "SupplyOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyShipment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "referenceType" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "carrier" TEXT,
    "provider" TEXT,
    "providerTrackingId" TEXT,
    "providerMode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "statusEventAt" TIMESTAMP(3),
    "destination" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "lastCheckedAt" TIMESTAMP(3),
    "lastSuccessfulCheckAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "checkError" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "leaseId" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "notificationFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyShipmentLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "quantity" DECIMAL(20,6),

    CONSTRAINT "SupplyShipmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyArrivalEstimate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "precision" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT,
    "timeStart" TEXT,
    "timeEnd" TEXT,
    "timezone" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceEventAt" TIMESTAMP(3) NOT NULL,
    "sourceId" TEXT,
    "current" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SupplyArrivalEstimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyTrackingObservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "providerEventAt" TIMESTAMP(3) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "summary" TEXT,
    "raw" JSONB,

    CONSTRAINT "SupplyTrackingObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyNeed" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "activeKey" TEXT,
    "catalogItemId" TEXT,
    "description" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "quantity" DECIMAL(20,6),
    "unit" TEXT,
    "ownerUserId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "latestWarningAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "reportedQuantity" DECIMAL(20,6),
    "reportedThreshold" DECIMAL(20,6),
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyNeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyWarningOccurrence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "needId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "warningKey" TEXT NOT NULL,
    "warningAt" TIMESTAMP(3) NOT NULL,
    "reportedQuantity" DECIMAL(20,6),
    "reportedThreshold" DECIMAL(20,6),

    CONSTRAINT "SupplyWarningOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyNeedAllocation" (
    "receivedQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "needId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "quantity" DECIMAL(20,6),
    "unit" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "explanation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyNeedAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyReceipt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "receivedByUserId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "SupplyReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyReceiptLine" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "shortageQuantity" DECIMAL(20,6),
    "damagedQuantity" DECIMAL(20,6),
    "unit" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "SupplyReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplySource" (
    "extractionAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextExtractionAt" TIMESTAMP(3),
    "lastExtractionAt" TIMESTAMP(3),
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mailboxConnectionId" TEXT,
    "userId" TEXT,
    "provider" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "attachmentKey" TEXT NOT NULL DEFAULT '',
    "messageDate" TIMESTAMP(3) NOT NULL,
    "contentHash" TEXT NOT NULL,
    "extractionStatus" TEXT NOT NULL,
    "extractionError" TEXT,
    "filename" TEXT,
    "mimeType" TEXT,
    "subject" TEXT,
    "extractedFacts" JSONB,
    "historical" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplySource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyOrderSource" (
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,

    CONSTRAINT "SupplyOrderSource_pkey" PRIMARY KEY ("organizationId","orderId","sourceId")
);

-- CreateTable
CREATE TABLE "SupplyAudit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT,
    "needId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyMailboxSync" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONNECTION_REQUIRED',
    "cursor" JSONB,
    "backfillStartedAt" TIMESTAMP(3),
    "backfillCompletedAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "nextSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "leaseId" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplyMailboxSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplyNotification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "SupplyNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplyCatalogItem_organizationId_id_key" ON "SupplyCatalogItem"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyCatalogItem_organizationId_normalizedName_key" ON "SupplyCatalogItem"("organizationId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyCatalogAlias_organizationId_catalogItemId_supplier_sk_key" ON "SupplyCatalogAlias"("organizationId", "catalogItemId", "supplier", "sku", "alias");

-- CreateIndex
CREATE INDEX "SupplyClassificationRule_organizationId_active_idx" ON "SupplyClassificationRule"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyClassificationRule_organizationId_supplier_sku_key" ON "SupplyClassificationRule"("organizationId", "supplier", "sku");

-- CreateIndex
CREATE INDEX "SupplyOrder_organizationId_normalizedSupplier_orderReferenc_idx" ON "SupplyOrder"("organizationId", "normalizedSupplier", "orderReference");

-- CreateIndex
CREATE INDEX "SupplyOrder_organizationId_status_updatedAt_idx" ON "SupplyOrder"("organizationId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyOrder_organizationId_id_key" ON "SupplyOrder"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyOrder_organizationId_dedupeKey_key" ON "SupplyOrder"("organizationId", "dedupeKey");

-- CreateIndex
CREATE INDEX "SupplyOrderLine_organizationId_catalogItemId_department_idx" ON "SupplyOrderLine"("organizationId", "catalogItemId", "department");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyOrderLine_organizationId_id_key" ON "SupplyOrderLine"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyOrderLine_organizationId_orderId_lineKey_key" ON "SupplyOrderLine"("organizationId", "orderId", "lineKey");

-- CreateIndex
CREATE INDEX "SupplyShipment_nextCheckAt_leaseUntil_idx" ON "SupplyShipment"("nextCheckAt", "leaseUntil");

-- CreateIndex
CREATE INDEX "SupplyShipment_provider_providerTrackingId_idx" ON "SupplyShipment"("provider", "providerTrackingId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyShipment_organizationId_id_key" ON "SupplyShipment"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyShipment_organizationId_referenceType_reference_carri_key" ON "SupplyShipment"("organizationId", "referenceType", "reference", "carrier");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyShipmentLine_organizationId_shipmentId_lineId_key" ON "SupplyShipmentLine"("organizationId", "shipmentId", "lineId");

-- CreateIndex
CREATE INDEX "SupplyArrivalEstimate_organizationId_shipmentId_source_curr_idx" ON "SupplyArrivalEstimate"("organizationId", "shipmentId", "source", "current");

-- CreateIndex
CREATE INDEX "SupplyTrackingObservation_organizationId_shipmentId_provide_idx" ON "SupplyTrackingObservation"("organizationId", "shipmentId", "providerEventAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyTrackingObservation_organizationId_shipmentId_eventKe_key" ON "SupplyTrackingObservation"("organizationId", "shipmentId", "eventKey");

-- CreateIndex
CREATE INDEX "SupplyNeed_organizationId_resolvedAt_priority_idx" ON "SupplyNeed"("organizationId", "resolvedAt", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyNeed_organizationId_id_key" ON "SupplyNeed"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyNeed_organizationId_dedupeKey_key" ON "SupplyNeed"("organizationId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyNeed_organizationId_activeKey_key" ON "SupplyNeed"("organizationId", "activeKey");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyWarningOccurrence_organizationId_warningKey_key" ON "SupplyWarningOccurrence"("organizationId", "warningKey");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyNeedAllocation_organizationId_needId_lineId_key" ON "SupplyNeedAllocation"("organizationId", "needId", "lineId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyReceipt_organizationId_id_key" ON "SupplyReceipt"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyReceipt_organizationId_idempotencyKey_key" ON "SupplyReceipt"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyReceiptLine_organizationId_receiptId_lineId_key" ON "SupplyReceiptLine"("organizationId", "receiptId", "lineId");

-- CreateIndex
CREATE INDEX "SupplySource_organizationId_contentHash_idx" ON "SupplySource"("organizationId", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "SupplySource_organizationId_id_key" ON "SupplySource"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SupplySource_organizationId_mailboxConnectionId_messageId_a_key" ON "SupplySource"("organizationId", "mailboxConnectionId", "messageId", "attachmentKey");

-- CreateIndex
CREATE INDEX "SupplyAudit_organizationId_orderId_createdAt_idx" ON "SupplyAudit"("organizationId", "orderId", "createdAt");

-- CreateIndex
CREATE INDEX "SupplyAudit_organizationId_needId_createdAt_idx" ON "SupplyAudit"("organizationId", "needId", "createdAt");

-- CreateIndex
CREATE INDEX "SupplyMailboxSync_nextSyncAt_leaseUntil_idx" ON "SupplyMailboxSync"("nextSyncAt", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyMailboxSync_organizationId_userId_key" ON "SupplyMailboxSync"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "SupplyNotification_organizationId_createdAt_idx" ON "SupplyNotification"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupplyNotification_organizationId_fingerprint_key" ON "SupplyNotification"("organizationId", "fingerprint");

-- AddForeignKey
ALTER TABLE "SupplyCatalogItem" ADD CONSTRAINT "SupplyCatalogItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyCatalogAlias" ADD CONSTRAINT "SupplyCatalogAlias_organizationId_catalogItemId_fkey" FOREIGN KEY ("organizationId", "catalogItemId") REFERENCES "SupplyCatalogItem"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyClassificationRule" ADD CONSTRAINT "SupplyClassificationRule_organizationId_catalogItemId_fkey" FOREIGN KEY ("organizationId", "catalogItemId") REFERENCES "SupplyCatalogItem"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOrder" ADD CONSTRAINT "SupplyOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOrderLine" ADD CONSTRAINT "SupplyOrderLine_organizationId_orderId_fkey" FOREIGN KEY ("organizationId", "orderId") REFERENCES "SupplyOrder"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOrderLine" ADD CONSTRAINT "SupplyOrderLine_organizationId_catalogItemId_fkey" FOREIGN KEY ("organizationId", "catalogItemId") REFERENCES "SupplyCatalogItem"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyShipment" ADD CONSTRAINT "SupplyShipment_organizationId_orderId_fkey" FOREIGN KEY ("organizationId", "orderId") REFERENCES "SupplyOrder"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyShipmentLine" ADD CONSTRAINT "SupplyShipmentLine_organizationId_shipmentId_fkey" FOREIGN KEY ("organizationId", "shipmentId") REFERENCES "SupplyShipment"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyShipmentLine" ADD CONSTRAINT "SupplyShipmentLine_organizationId_lineId_fkey" FOREIGN KEY ("organizationId", "lineId") REFERENCES "SupplyOrderLine"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyArrivalEstimate" ADD CONSTRAINT "SupplyArrivalEstimate_organizationId_shipmentId_fkey" FOREIGN KEY ("organizationId", "shipmentId") REFERENCES "SupplyShipment"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyTrackingObservation" ADD CONSTRAINT "SupplyTrackingObservation_organizationId_shipmentId_fkey" FOREIGN KEY ("organizationId", "shipmentId") REFERENCES "SupplyShipment"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyNeed" ADD CONSTRAINT "SupplyNeed_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyNeed" ADD CONSTRAINT "SupplyNeed_organizationId_catalogItemId_fkey" FOREIGN KEY ("organizationId", "catalogItemId") REFERENCES "SupplyCatalogItem"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyWarningOccurrence" ADD CONSTRAINT "SupplyWarningOccurrence_organizationId_needId_fkey" FOREIGN KEY ("organizationId", "needId") REFERENCES "SupplyNeed"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyWarningOccurrence" ADD CONSTRAINT "SupplyWarningOccurrence_organizationId_sourceId_fkey" FOREIGN KEY ("organizationId", "sourceId") REFERENCES "SupplySource"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyNeedAllocation" ADD CONSTRAINT "SupplyNeedAllocation_organizationId_needId_fkey" FOREIGN KEY ("organizationId", "needId") REFERENCES "SupplyNeed"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyNeedAllocation" ADD CONSTRAINT "SupplyNeedAllocation_organizationId_lineId_fkey" FOREIGN KEY ("organizationId", "lineId") REFERENCES "SupplyOrderLine"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyReceipt" ADD CONSTRAINT "SupplyReceipt_organizationId_orderId_fkey" FOREIGN KEY ("organizationId", "orderId") REFERENCES "SupplyOrder"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyReceipt" ADD CONSTRAINT "SupplyReceipt_organizationId_shipmentId_fkey" FOREIGN KEY ("organizationId", "shipmentId") REFERENCES "SupplyShipment"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyReceiptLine" ADD CONSTRAINT "SupplyReceiptLine_organizationId_receiptId_fkey" FOREIGN KEY ("organizationId", "receiptId") REFERENCES "SupplyReceipt"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyReceiptLine" ADD CONSTRAINT "SupplyReceiptLine_organizationId_lineId_fkey" FOREIGN KEY ("organizationId", "lineId") REFERENCES "SupplyOrderLine"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplySource" ADD CONSTRAINT "SupplySource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOrderSource" ADD CONSTRAINT "SupplyOrderSource_organizationId_orderId_fkey" FOREIGN KEY ("organizationId", "orderId") REFERENCES "SupplyOrder"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyOrderSource" ADD CONSTRAINT "SupplyOrderSource_organizationId_sourceId_fkey" FOREIGN KEY ("organizationId", "sourceId") REFERENCES "SupplySource"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyAudit" ADD CONSTRAINT "SupplyAudit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyAudit" ADD CONSTRAINT "SupplyAudit_organizationId_orderId_fkey" FOREIGN KEY ("organizationId", "orderId") REFERENCES "SupplyOrder"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyAudit" ADD CONSTRAINT "SupplyAudit_organizationId_needId_fkey" FOREIGN KEY ("organizationId", "needId") REFERENCES "SupplyNeed"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyMailboxSync" ADD CONSTRAINT "SupplyMailboxSync_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplyNotification" ADD CONSTRAINT "SupplyNotification_organizationId_shipmentId_fkey" FOREIGN KEY ("organizationId", "shipmentId") REFERENCES "SupplyShipment"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Numerical integrity remains enforced for workers, APIs and future callers.
ALTER TABLE "SupplyCatalogItem" ADD CONSTRAINT "SupplyCatalogItem_pack_positive" CHECK ("packSize" IS NULL OR "packSize" > 0);
ALTER TABLE "SupplyCatalogAlias" ADD CONSTRAINT "SupplyCatalogAlias_pack_positive" CHECK ("packSize" IS NULL OR "packSize" > 0);
ALTER TABLE "SupplyClassificationRule" ADD CONSTRAINT "SupplyClassificationRule_pack_positive" CHECK ("packSize" IS NULL OR "packSize" > 0);
ALTER TABLE "SupplyOrderLine" ADD CONSTRAINT "SupplyOrderLine_quantities_valid" CHECK (("quantity" IS NULL OR "quantity" >= 0) AND ("backorderedQuantity" IS NULL OR "backorderedQuantity" >= 0) AND ("packSize" IS NULL OR "packSize" > 0) AND ("productionQuantity" IS NULL OR "productionQuantity" >= 0) AND ("barQuantity" IS NULL OR "barQuantity" >= 0) AND (("productionQuantity" IS NULL AND "barQuantity" IS NULL) OR ("quantity" IS NOT NULL AND COALESCE("productionQuantity",0) + COALESCE("barQuantity",0) <= "quantity")) AND ("classificationConfidence" IS NULL OR ("classificationConfidence" >= 0 AND "classificationConfidence" <= 1)));
ALTER TABLE "SupplyShipmentLine" ADD CONSTRAINT "SupplyShipmentLine_quantity_nonnegative" CHECK ("quantity" IS NULL OR "quantity" >= 0);
ALTER TABLE "SupplyNeed" ADD CONSTRAINT "SupplyNeed_quantities_nonnegative" CHECK (("quantity" IS NULL OR "quantity" >= 0) AND ("reportedQuantity" IS NULL OR "reportedQuantity" >= 0) AND ("reportedThreshold" IS NULL OR "reportedThreshold" >= 0));
ALTER TABLE "SupplyWarningOccurrence" ADD CONSTRAINT "SupplyWarningOccurrence_quantities_nonnegative" CHECK (("reportedQuantity" IS NULL OR "reportedQuantity" >= 0) AND ("reportedThreshold" IS NULL OR "reportedThreshold" >= 0));
ALTER TABLE "SupplyNeedAllocation" ADD CONSTRAINT "SupplyNeedAllocation_quantities_valid" CHECK (("quantity" IS NULL OR "quantity" >= 0) AND "receivedQuantity" >= 0 AND (("quantity" IS NULL AND "receivedQuantity" = 0) OR "receivedQuantity" <= "quantity"));
ALTER TABLE "SupplyReceiptLine" ADD CONSTRAINT "SupplyReceiptLine_quantities_valid" CHECK ("quantity" >= 0 AND ("shortageQuantity" IS NULL OR "shortageQuantity" >= 0) AND ("damagedQuantity" IS NULL OR ("damagedQuantity" >= 0 AND "damagedQuantity" <= "quantity")) AND ("quantity" > 0 OR "shortageQuantity" > 0));
ALTER TABLE "SupplyShipment" ADD CONSTRAINT "SupplyShipment_failures_nonnegative" CHECK ("failureCount" >= 0);
ALTER TABLE "SupplySource" ADD CONSTRAINT "SupplySource_attempts_nonnegative" CHECK ("extractionAttemptCount" >= 0);
ALTER TABLE "SupplyMailboxSync" ADD CONSTRAINT "SupplyMailboxSync_counts_nonnegative" CHECK ("failureCount" >= 0 AND "processedCount" >= 0);
ALTER TABLE "SupplyArrivalEstimate" ADD CONSTRAINT "SupplyArrivalEstimate_precision_valid" CHECK ("precision" IN ('DATE','DATE_RANGE','TIME_WINDOW','APPOINTMENT') AND "startDate" ~ '^\d{4}-\d{2}-\d{2}$' AND ("endDate" IS NULL OR ("endDate" ~ '^\d{4}-\d{2}-\d{2}$' AND "endDate" >= "startDate")) AND ("precision" NOT IN ('TIME_WINDOW','APPOINTMENT') OR "timeStart" IS NOT NULL));
