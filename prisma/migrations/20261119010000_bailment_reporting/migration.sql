-- Direct reporting only. The canceled CSV archive remains dormant and untouched.
CREATE TABLE "OhlqBailmentReportingSnapshot" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "requestId" TEXT COLLATE "C" NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "requestedAt" TIMESTAMPTZ(3) NOT NULL,
  "acquiredAt" TIMESTAMPTZ(3) NOT NULL,
  "requestedFrom" DATE NOT NULL,
  "requestedTo" DATE NOT NULL,
  "timezone" TEXT NOT NULL,
  "reportIdentity" TEXT NOT NULL,
  "parameterScope" JSONB NOT NULL,
  "contentHash" TEXT NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "invoiceMonthCounts" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OhlqBailmentReportingSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bailment_reporting_snapshot_org_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "bailment_reporting_snapshot_valid" CHECK (
    "rowCount" > 0 AND "requestedFrom" <= "requestedTo" AND "requestedAt" <= "acquiredAt"
    AND "contentHash" ~ '^[0-9a-f]{64}$' AND "requestFingerprint" ~ '^[0-9a-f]{64}$'
  )
);

CREATE UNIQUE INDEX "OhlqBailmentReportingSnapshot_organizationId_id_key" ON "OhlqBailmentReportingSnapshot"("organizationId", "id");
CREATE UNIQUE INDEX "bailment_reporting_org_request_key" ON "OhlqBailmentReportingSnapshot"("organizationId", "requestId");
CREATE UNIQUE INDEX "bailment_reporting_org_content_schema_key" ON "OhlqBailmentReportingSnapshot"("organizationId", "contentHash", "schemaVersion");
CREATE INDEX "bailment_reporting_org_request_idx" ON "OhlqBailmentReportingSnapshot"("organizationId", "requestedAt", "requestId");

CREATE TABLE "OhlqBailmentReportingLine" (
  "organizationId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "sourceLineNumber" INTEGER NOT NULL,
  "vendorName" TEXT,
  "brokerName" TEXT,
  "invoiceDate" DATE,
  "invoiceNumber" TEXT,
  "poCreateDate" DATE,
  "poNumber" TEXT,
  "transferOrderNumber" TEXT,
  "agency" TEXT,
  "transferOrderShipDate" DATE,
  "upcCode" TEXT,
  "brand" TEXT,
  "name" TEXT,
  "category" TEXT,
  "dcName" TEXT,
  "cases" DECIMAL(24,6),
  "oddBottles" DECIMAL(24,6),
  "casesBottles" TEXT,
  "quotedCasePrice" DECIMAL(24,6),
  "discount" DECIMAL(24,6),
  "total" DECIMAL(24,6),
  "datePaid" DATE,
  "sourceValues" TEXT[] NOT NULL,
  CONSTRAINT "OhlqBailmentReportingLine_pkey" PRIMARY KEY ("organizationId", "snapshotId", "sourceLineNumber"),
  CONSTRAINT "bailment_reporting_line_org_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "bailment_reporting_line_snapshot_fkey" FOREIGN KEY ("organizationId", "snapshotId") REFERENCES "OhlqBailmentReportingSnapshot"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "bailment_reporting_line_valid" CHECK ("sourceLineNumber" > 0 AND cardinality("sourceValues") = 21)
);

-- The reporting login receives SELECT only on this fixed-tenant view. It does
-- not need and must not receive access to the tables or application-owner role.
CREATE VIEW public.echo_bailment_reporting WITH (security_barrier = true) AS
SELECT
  l."vendorName" AS "Vendor_Name",
  l."brokerName" AS "Broker_Name",
  l."invoiceDate" AS "Invoice_Date",
  l."invoiceNumber" AS "Invoice_Number",
  l."poCreateDate" AS "PO_Create_Date",
  l."poNumber" AS "PO_Number",
  l."transferOrderNumber" AS "Transfer_Order_Number",
  l."agency" AS "Agency",
  l."transferOrderShipDate" AS "Transfer_Order_Ship_Date",
  l."upcCode" AS "UPC_Code",
  l."brand" AS "Brand",
  l."name" AS "Name",
  l."category" AS "Category",
  l."dcName" AS "DC_Name",
  l."cases" AS "Cases",
  l."oddBottles" AS "Odd_Bottles",
  l."casesBottles" AS "Cases_Bottles",
  l."quotedCasePrice" AS "Quoted_Case_Price",
  l."discount" AS "Discount",
  l."total" AS "Total",
  l."datePaid" AS "Date_Paid",
  s."acquiredAt" AT TIME ZONE s."timezone" AS "Report_Retrieved_At",
  s."requestedFrom" AS "Report_From",
  s."requestedTo" AS "Report_To",
  l."sourceLineNumber" AS "Source_Row_Number"
FROM "OhlqBailmentReportingLine" l
JOIN "OhlqBailmentReportingSnapshot" s ON s."organizationId" = l."organizationId" AND s."id" = l."snapshotId"
JOIN "Organization" o ON o."id" = s."organizationId"
WHERE s."organizationId" = 'org_echo_spirits'
  AND o."active" = true
  AND o."accountStatus" NOT IN ('SUSPENDED', 'CANCELLED')
  AND 'OH' = ANY(o."enabledStates")
  AND s."id" = (
    SELECT latest."id" FROM "OhlqBailmentReportingSnapshot" latest
    WHERE latest."organizationId" = s."organizationId"
    ORDER BY latest."requestedAt" DESC, latest."requestId" DESC
    LIMIT 1
  );

REVOKE ALL ON TABLE "OhlqBailmentReportingSnapshot", "OhlqBailmentReportingLine", public.echo_bailment_reporting FROM PUBLIC;
