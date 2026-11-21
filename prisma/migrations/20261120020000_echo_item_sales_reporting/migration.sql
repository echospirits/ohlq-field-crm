-- Reporting adapter only: no existing sales, imports, schedules or receipts
-- are changed. Ingestion must opt in to the separate evidence contract.
CREATE TABLE public."EchoBottleSalesDayCoverage" (
  "reportDate" DATE NOT NULL,
  "vendor" TEXT NOT NULL,
  "sourceReportIdentity" TEXT NOT NULL,
  "sourceScope" TEXT NOT NULL,
  "requestedFrom" DATE NOT NULL,
  "requestedTo" DATE NOT NULL,
  "requestReference" TEXT NOT NULL,
  "sourceContentSha256" TEXT NOT NULL,
  "sourceByteLength" BIGINT NOT NULL,
  "sourceRowCount" INTEGER NOT NULL,
  "sourceSkippedRows" INTEGER NOT NULL,
  "sourceExportCompleted" BOOLEAN NOT NULL,
  "sourceAcquiredAt" TIMESTAMPTZ(3),
  "completedAt" TIMESTAMPTZ(3) NOT NULL,
  "expectedRowCount" INTEGER NOT NULL,
  "expectedRetailBottles" BIGINT NOT NULL,
  "expectedWholesaleBottles" BIGINT NOT NULL,
  "expectedFactsSha256" TEXT NOT NULL,
  CONSTRAINT "EchoBottleSalesDayCoverage_pkey" PRIMARY KEY ("reportDate"),
  CONSTRAINT "echo_bottle_day_scope_valid" CHECK (
    "vendor" = 'Z90399001'
    AND "sourceReportIdentity" = '9781fc23-73de-4ee8-b0b8-77ae6f9b7c4e'
    AND "sourceScope" IN ('VENDOR_FILTERED', 'COMPLETE_STATEWIDE')
    AND "reportDate" >= DATE '0001-01-01'
    AND "reportDate" < DATE '9999-12-31'
    AND "requestedFrom" = "reportDate" AND "requestedTo" = "reportDate"
  ),
  CONSTRAINT "echo_bottle_day_provenance_valid" CHECK (
    length(btrim("requestReference")) BETWEEN 1 AND 500
    AND "sourceContentSha256" ~ '^[0-9a-f]{64}$'
    AND "sourceByteLength" > 0
    AND "sourceRowCount" >= 0
    AND "sourceSkippedRows" = 0
    AND "sourceExportCompleted" = true
    AND isfinite("completedAt")
    AND ("completedAt" AT TIME ZONE 'America/New_York')::date > "reportDate"
    AND ("sourceAcquiredAt" IS NULL OR (
      isfinite("sourceAcquiredAt")
      AND "sourceAcquiredAt" <= "completedAt"
      AND ("sourceAcquiredAt" AT TIME ZONE 'America/New_York')::date > "reportDate"
    ))
  ),
  CONSTRAINT "echo_bottle_day_expected_facts_valid" CHECK (
    "expectedRowCount" >= 0 AND "expectedRowCount" <= "sourceRowCount"
    AND ("sourceScope" <> 'VENDOR_FILTERED' OR "expectedRowCount" = "sourceRowCount")
    AND "expectedFactsSha256" ~ '^[0-9a-f]{64}$'
    AND ("expectedRowCount" <> 0 OR (
      "expectedRetailBottles" = 0 AND "expectedWholesaleBottles" = 0
      AND "expectedFactsSha256" = encode(sha256(convert_to('[]', 'UTF8')), 'hex')
    ))
  )
);

-- Private validation surface. The signature uses PostgreSQL JSONB text of
-- ordered six-element arrays; see the engineering contract for exact encoding.
-- No historical row is certified merely because it exists or has an old global
-- import status. A valid empty-source receipt is required for a zero-sale day.
CREATE VIEW public.echo_item_sales_day_coverage WITH (security_barrier = true) AS
WITH physical_facts AS (
  SELECT
    s."reportDate",
    count(*)::integer AS "rowCount",
    sum(s."retailBottlesSold")::bigint AS "retailBottles",
    sum(s."wholesaleBottlesSold")::bigint AS "wholesaleBottles",
    encode(sha256(convert_to(
      jsonb_agg(jsonb_build_array(
        to_char(s."reportDate", 'YYYY-MM-DD'), s."agencyId", s."vendor", s."brand",
        s."retailBottlesSold", s."wholesaleBottlesSold"
      ) ORDER BY s."agencyId" COLLATE "C", s."vendor" COLLATE "C", s."brand" COLLATE "C")::text,
      'UTF8'
    )), 'hex') AS "factsSha256"
  FROM public."OhlqAnnualSalesRow" s
  WHERE s."vendor" = 'Z90399001'
    AND s."reportDate" >= DATE '2025-01-01'
    AND s."reportDate" < date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date
  GROUP BY s."reportDate"
)
SELECT
  c."reportDate" AS "Sales_Date",
  c."completedAt" AS "Import_Completed_At",
  c."sourceAcquiredAt" AS "Source_Acquired_At",
  (
    c."completedAt" <= CURRENT_TIMESTAMP
    AND c."expectedRowCount" = coalesce(f."rowCount", 0)
    AND c."expectedRetailBottles" = coalesce(f."retailBottles", 0::bigint)
    AND c."expectedWholesaleBottles" = coalesce(f."wholesaleBottles", 0::bigint)
    AND c."expectedFactsSha256" = coalesce(f."factsSha256", encode(sha256(convert_to('[]', 'UTF8')), 'hex'))
  ) AS "Is_Complete"
FROM public."EchoBottleSalesDayCoverage" c
LEFT JOIN physical_facts f ON f."reportDate" = c."reportDate"
WHERE c."vendor" = 'Z90399001'
  AND c."reportDate" >= DATE '2025-01-01'
  AND c."reportDate" < date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date
  AND EXISTS (
    SELECT 1 FROM public."Organization" o
    WHERE o."id" = 'org_echo_spirits' AND o."active" = true
      AND o."accountStatus" NOT IN ('SUSPENDED', 'CANCELLED')
      AND 'OH' = ANY(o."enabledStates")
  );

-- Always one status row for an eligible Echo organization, including before
-- ingestion is integrated. Later complete months cannot jump an earlier gap.
CREATE VIEW public.echo_item_sales_reporting_status WITH (security_barrier = true) AS
WITH bounds AS (
  SELECT DATE '2025-01-01' AS history_start,
    date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date AS current_month
), calendar AS (
  SELECT b.history_start + n AS sales_date
  FROM bounds b
  CROSS JOIN LATERAL generate_series(0, (b.current_month - b.history_start) - 1) AS n
), days AS (
  SELECT d.sales_date, coalesce(c."Is_Complete", false) AS is_complete,
    c."Import_Completed_At" AS import_completed_at,
    c."Source_Acquired_At" AS source_acquired_at
  FROM calendar d
  LEFT JOIN public.echo_item_sales_day_coverage c ON c."Sales_Date" = d.sales_date
), summary AS (
  SELECT count(*)::integer AS expected_days,
    count(*) FILTER (WHERE is_complete)::integer AS complete_days,
    min(sales_date) FILTER (WHERE NOT is_complete) AS first_missing_date,
    max(import_completed_at) FILTER (WHERE is_complete) AS latest_import_completed_at,
    max(source_acquired_at) FILTER (WHERE is_complete) AS latest_known_source_acquired_at
  FROM days
), cutoff AS (
  SELECT b.*, s.*,
    CASE
      WHEN s.expected_days = 0 OR s.first_missing_date = b.history_start THEN NULL::date
      WHEN s.first_missing_date IS NULL THEN (b.current_month - INTERVAL '1 month')::date
      WHEN date_trunc('month', s.first_missing_date)::date = b.history_start THEN NULL::date
      ELSE (date_trunc('month', s.first_missing_date) - INTERVAL '1 month')::date
    END AS reporting_month
  FROM bounds b CROSS JOIN summary s
)
SELECT
  c.history_start AS "History_Start",
  (c.current_month - INTERVAL '1 month')::date AS "Latest_Closed_Month",
  c.expected_days AS "Expected_Days",
  c.complete_days AS "Certified_Days",
  c.first_missing_date AS "First_Uncertified_Date",
  c.reporting_month AS "Reporting_Month",
  (c.reporting_month + INTERVAL '1 month' - INTERVAL '1 day')::date AS "Reporting_Through",
  coalesce(c.reporting_month >= DATE '2026-01-01', false) AS "Comparison_Ready",
  CASE
    WHEN c.reporting_month IS NULL THEN 'AWAITING_CERTIFIED_HISTORY'
    WHEN c.reporting_month < DATE '2026-01-01' THEN 'PRIOR_YEAR_HISTORY_INCOMPLETE'
    WHEN c.reporting_month < (c.current_month - INTERVAL '1 month')::date THEN 'PARTIAL_HISTORY'
    ELSE 'READY'
  END::text AS "Coverage_Status",
  c.latest_import_completed_at AT TIME ZONE 'America/New_York' AS "Latest_Import_Completed_At",
  c.latest_known_source_acquired_at AT TIME ZONE 'America/New_York' AS "Latest_Known_Source_Acquired_At"
FROM cutoff c
JOIN public."Organization" o ON o."id" = 'org_echo_spirits'
WHERE o."active" = true AND o."accountStatus" NOT IN ('SUSPENDED', 'CANCELLED')
  AND 'OH' = ANY(o."enabledStates");

-- The first ten columns are the existing Dashboard Data / Item Sales contract.
-- Both comparison periods must be certified before any financial-facing bottle
-- rows are published. Current partial months and dates beyond a gap stay hidden.
CREATE VIEW public.echo_item_sales_reporting WITH (security_barrier = true) AS
WITH coverage AS MATERIALIZED (
  SELECT * FROM public.echo_item_sales_reporting_status WHERE "Comparison_Ready"
), monthly AS (
  SELECT date_trunc('month', s."reportDate")::date AS sales_month,
    s."agencyId", s."brand",
    sum(s."retailBottlesSold")::bigint AS retail_bottles,
    sum(s."wholesaleBottlesSold")::bigint AS wholesale_bottles
  FROM public."OhlqAnnualSalesRow" s
  CROSS JOIN coverage c
  WHERE s."vendor" = 'Z90399001'
    AND s."reportDate" >= c."History_Start"
    AND s."reportDate" <= c."Reporting_Through"
  GROUP BY date_trunc('month', s."reportDate")::date, s."agencyId", s."brand"
)
SELECT
  m.sales_month AS "Month",
  CASE
    WHEN upper(btrim(a."warehouse")) IN ('GPT', 'GRN') THEN upper(btrim(a."warehouse"))
    WHEN m."agencyId" IN ('90285', '90399') THEN 'GPT'
    ELSE NULL
  END::text AS "District",
  m."agencyId" AS "Agency_Id",
  coalesce(nullif(btrim(a."name"), ''), CASE m."agencyId"
    WHEN '90285' THEN 'ECHO SPIRITS POWELL'
    WHEN '90399' THEN 'ECHO SPIRITS DISTILLING CO'
    ELSE m."agencyId"
  END)::text AS "Agency_Name",
  m."brand" AS "Brand",
  coalesce(nullif(btrim(p."name"), ''), m."brand")::text AS "Name",
  nullif(btrim(p."category"), '')::text AS "Category",
  m.retail_bottles AS "Retail_Bottles_Sold",
  m.wholesale_bottles AS "Wholesale_Bottles_Sold",
  c."Reporting_Month",
  c."Coverage_Status",
  c."History_Start",
  c."Reporting_Through",
  c."Comparison_Ready",
  c."Latest_Import_Completed_At",
  c."Latest_Known_Source_Acquired_At"
FROM monthly m
CROSS JOIN coverage c
LEFT JOIN public."Agency" a ON a."agencyId" = m."agencyId"
LEFT JOIN public."OhlqBrandMasterItem" p ON p."itemCode" = m."brand";

-- The isolated reporting login is provisioned separately. It receives SELECT
-- on the two final reporting views, never on the evidence or underlying facts.
REVOKE ALL ON TABLE public."EchoBottleSalesDayCoverage",
  public.echo_item_sales_day_coverage, public.echo_item_sales_reporting_status,
  public.echo_item_sales_reporting FROM PUBLIC;
