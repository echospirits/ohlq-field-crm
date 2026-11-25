-- Extend the existing Echo-only reporting horizon to the owner-confirmed
-- earliest possible date. Validation, independent complete-month publication,
-- column contracts, tenant guards and existing reader grants remain unchanged.
-- No sales facts, coverage receipts, imports, retention or schedules are changed.
CREATE OR REPLACE VIEW public.echo_item_sales_day_coverage WITH (security_barrier = true) AS
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
    AND s."reportDate" >= DATE '2019-01-01'
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
  AND c."reportDate" >= DATE '2019-01-01'
  AND c."reportDate" < date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date
  AND EXISTS (
    SELECT 1 FROM public."Organization" o
    WHERE o."id" = 'org_echo_spirits' AND o."active" = true
      AND o."accountStatus" NOT IN ('SUSPENDED', 'CANCELLED')
      AND 'OH' = ANY(o."enabledStates")
  );

CREATE OR REPLACE VIEW public.echo_item_sales_reporting_status WITH (security_barrier = true) AS
WITH bounds AS (
  SELECT DATE '2019-01-01' AS history_start,
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
  SELECT b.*, s.*, (SELECT max("Month") FROM public.echo_item_sales_complete_month) AS reporting_month
  FROM bounds b CROSS JOIN summary s
), periods AS (
  SELECT c.*,
    c.reporting_month >= DATE '2019-01-01' AND NOT EXISTS (
      SELECT 1 FROM days WHERE sales_date BETWEEN date_trunc('year', c.reporting_month)::date
        AND (c.reporting_month + INTERVAL '1 month - 1 day')::date AND NOT is_complete
    ) AS current_ready,
    c.reporting_month >= DATE '2020-01-01' AND NOT EXISTS (
      SELECT 1 FROM days WHERE sales_date BETWEEN (date_trunc('year', c.reporting_month) - INTERVAL '1 year')::date
        AND (c.reporting_month - INTERVAL '11 months 1 day')::date AND NOT is_complete
    ) AS prior_ready
  FROM cutoff c
)
SELECT
  c.history_start AS "History_Start",
  (c.current_month - INTERVAL '1 month')::date AS "Latest_Closed_Month",
  c.expected_days AS "Expected_Days",
  c.complete_days AS "Certified_Days",
  c.first_missing_date AS "First_Uncertified_Date",
  c.reporting_month AS "Reporting_Month",
  (c.reporting_month + INTERVAL '1 month' - INTERVAL '1 day')::date AS "Reporting_Through",
  coalesce(c.current_ready AND c.prior_ready, false) AS "Comparison_Ready",
  CASE
    WHEN c.reporting_month IS NULL THEN 'AWAITING_CERTIFIED_HISTORY'
    WHEN NOT (c.current_ready AND c.prior_ready) THEN 'PRIOR_YEAR_HISTORY_INCOMPLETE'
    WHEN c.reporting_month < (c.current_month - INTERVAL '1 month')::date THEN 'PARTIAL_HISTORY'
    ELSE 'READY'
  END::text AS "Coverage_Status",
  c.latest_import_completed_at AT TIME ZONE 'America/New_York' AS "Latest_Import_Completed_At",
  c.latest_known_source_acquired_at AT TIME ZONE 'America/New_York' AS "Latest_Known_Source_Acquired_At",
  coalesce(c.current_ready, false)::integer AS "Current_YTD_Ready",
  coalesce(c.prior_ready, false)::integer AS "Prior_YTD_Ready",
  (SELECT count(*)::integer FROM public.echo_item_sales_complete_month) AS "Available_Months",
  (SELECT count(*)::integer FROM public.echo_item_sales_complete_month m WHERE NOT EXISTS (
    SELECT 1 FROM public."OhlqAnnualSalesRow" f WHERE f.vendor = 'Z90399001'
      AND f."reportDate" >= m."Month" AND f."reportDate" < m."Month" + INTERVAL '1 month'
  )) AS "Empty_Completed_Months"
FROM periods c
JOIN public."Organization" o ON o."id" = 'org_echo_spirits'
WHERE o."active" = true AND o."accountStatus" NOT IN ('SUSPENDED', 'CANCELLED')
  AND 'OH' = ANY(o."enabledStates");
