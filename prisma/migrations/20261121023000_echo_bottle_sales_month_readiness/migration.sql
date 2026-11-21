-- Existing view names, column order, grants and tenant checks are preserved.
CREATE VIEW public.echo_item_sales_complete_month WITH (security_barrier = true) AS
SELECT date_trunc('month', "Sales_Date")::date AS "Month"
FROM public.echo_item_sales_day_coverage
WHERE "Is_Complete"
GROUP BY 1
HAVING count(*) = (date_trunc('month', min("Sales_Date")) + INTERVAL '1 month')::date
                    - date_trunc('month', min("Sales_Date"))::date;

REVOKE ALL ON public.echo_item_sales_complete_month FROM PUBLIC;

CREATE OR REPLACE VIEW public.echo_item_sales_reporting_status WITH (security_barrier = true) AS
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
  SELECT b.*, s.*, (SELECT max("Month") FROM public.echo_item_sales_complete_month) AS reporting_month
  FROM bounds b CROSS JOIN summary s
), periods AS (
  SELECT c.*,
    c.reporting_month >= DATE '2025-01-01' AND NOT EXISTS (
      SELECT 1 FROM days WHERE sales_date BETWEEN date_trunc('year', c.reporting_month)::date
        AND (c.reporting_month + INTERVAL '1 month - 1 day')::date AND NOT is_complete
    ) AS current_ready,
    c.reporting_month >= DATE '2026-01-01' AND NOT EXISTS (
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

CREATE OR REPLACE VIEW public.echo_item_sales_reporting WITH (security_barrier = true) AS
WITH coverage AS MATERIALIZED (
  SELECT * FROM public.echo_item_sales_reporting_status WHERE "Reporting_Month" IS NOT NULL
), monthly AS (
  SELECT date_trunc('month', s."reportDate")::date AS sales_month,
    s."agencyId", s."brand",
    sum(s."retailBottlesSold")::bigint AS retail_bottles,
    sum(s."wholesaleBottlesSold")::bigint AS wholesale_bottles
  FROM public."OhlqAnnualSalesRow" s
  JOIN public.echo_item_sales_complete_month cm
    ON s."reportDate" >= cm."Month" AND s."reportDate" < cm."Month" + INTERVAL '1 month'
  WHERE s."vendor" = 'Z90399001'
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
  c."Latest_Known_Source_Acquired_At",
  c."Current_YTD_Ready",
  c."Prior_YTD_Ready"
FROM monthly m
CROSS JOIN coverage c
LEFT JOIN public."Agency" a ON a."agencyId" = m."agencyId"
LEFT JOIN public."OhlqBrandMasterItem" p ON p."itemCode" = m."brand";
