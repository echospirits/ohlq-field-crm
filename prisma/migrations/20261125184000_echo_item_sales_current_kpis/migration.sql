-- Current-period Echo bottle KPIs for the production Board KPIs report.
-- Keep the completed-month reporting views and their contracts unchanged.
CREATE VIEW public.echo_item_sales_current_kpis
WITH (security_barrier = true) AS
WITH bounds AS MATERIALIZED (
  SELECT
    (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date AS today,
    date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date AS month_start,
    date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date AS week_start
), permitted AS MATERIALIZED (
  SELECT 1
  FROM public."Organization" o
  WHERE o.id = 'org_echo_spirits'
    AND o.active = true
    AND o."accountStatus" NOT IN ('SUSPENDED', 'CANCELLED')
    AND 'OH' = ANY(o."enabledStates")
), physical_facts AS MATERIALIZED (
  SELECT
    s."reportDate" AS sales_date,
    count(*)::integer AS row_count,
    sum(s."retailBottlesSold") AS retail_all,
    sum(s."wholesaleBottlesSold") AS wholesale_all,
    COALESCE(sum(s."retailBottlesSold") FILTER (
      WHERE s.brand NOT IN ('3150B', '3750B', '4359B')
    ), 0)::bigint AS retail,
    COALESCE(sum(s."wholesaleBottlesSold") FILTER (
      WHERE s.brand NOT IN ('3150B', '3750B', '4359B')
    ), 0)::bigint AS wholesale,
    encode(sha256(convert_to(jsonb_agg(jsonb_build_array(
      to_char(s."reportDate"::timestamptz, 'YYYY-MM-DD'),
      s."agencyId", s.vendor, s.brand,
      s."retailBottlesSold", s."wholesaleBottlesSold"
    ) ORDER BY s."agencyId" COLLATE "C", s.vendor COLLATE "C", s.brand COLLATE "C")::text,
      'UTF8')), 'hex') AS facts_sha256
  FROM public."OhlqAnnualSalesRow" s
  CROSS JOIN bounds b
  CROSS JOIN permitted
  WHERE s.vendor = 'Z90399001'
    AND s."reportDate" >= LEAST(b.month_start, b.week_start)
    AND s."reportDate" < b.today
  GROUP BY s."reportDate"
), calendar AS MATERIALIZED (
  SELECT (LEAST(b.month_start, b.week_start) + n.day_offset)::date AS sales_date
  FROM bounds b
  CROSS JOIN LATERAL generate_series(
    0, b.today - LEAST(b.month_start, b.week_start) - 1
  ) AS n(day_offset)
), days AS MATERIALIZED (
  SELECT
    d.sales_date,
    COALESCE(f.retail, 0)::bigint AS retail,
    COALESCE(f.wholesale, 0)::bigint AS wholesale,
    c."completedAt" AS imported_at,
    c."sourceAcquiredAt" AS source_acquired_at,
    COALESCE(
      c."completedAt" <= CURRENT_TIMESTAMP
      AND c."expectedRowCount" = COALESCE(f.row_count, 0)
      AND c."expectedRetailBottles" = COALESCE(f.retail_all, 0)
      AND c."expectedWholesaleBottles" = COALESCE(f.wholesale_all, 0)
      AND c."expectedFactsSha256" = COALESCE(
        f.facts_sha256, encode(sha256(convert_to('[]', 'UTF8')), 'hex')
      ), false
    ) AS is_certified
  FROM calendar d
  LEFT JOIN physical_facts f ON f.sales_date = d.sales_date
  LEFT JOIN public."EchoBottleSalesDayCoverage" c
    ON c."reportDate" = d.sales_date AND c.vendor = 'Z90399001'
), periods AS MATERIALIZED (
  SELECT p.period_name, p.period_start, b.today
  FROM bounds b
  CROSS JOIN LATERAL (VALUES
    ('MTD'::text, b.month_start),
    ('WEEK'::text, b.week_start)
  ) AS p(period_name, period_start)
), cutoffs AS MATERIALIZED (
  SELECT p.period_name, p.period_start, p.today,
    CASE
      WHEN COALESCE(min(d.sales_date) FILTER (WHERE NOT d.is_certified), p.today) > p.period_start
      THEN COALESCE(min(d.sales_date) FILTER (WHERE NOT d.is_certified), p.today) - 1
      ELSE NULL::date
    END AS reporting_through
  FROM periods p
  LEFT JOIN days d ON d.sales_date >= p.period_start
  GROUP BY p.period_name, p.period_start, p.today
), period_totals AS MATERIALIZED (
  SELECT c.period_name, c.period_start, c.today, c.reporting_through,
    CASE WHEN c.reporting_through IS NOT NULL
      THEN COALESCE(sum(d.retail), 0)::bigint END AS retail,
    CASE WHEN c.reporting_through IS NOT NULL
      THEN COALESCE(sum(d.wholesale), 0)::bigint END AS wholesale,
    max(d.imported_at) AS imported_at,
    max(d.source_acquired_at) AS source_acquired_at,
    CASE
      WHEN c.reporting_through IS NULL THEN 'AWAITING_CERTIFIED_DAYS'
      WHEN c.reporting_through = c.today - 1 THEN 'READY_THROUGH_YESTERDAY'
      ELSE 'PARTIAL_THROUGH_CERTIFIED_DATE'
    END AS coverage_status
  FROM cutoffs c
  LEFT JOIN days d ON d.sales_date >= c.period_start
    AND d.sales_date <= c.reporting_through AND d.is_certified
  GROUP BY c.period_name, c.period_start, c.today, c.reporting_through
), kpis AS MATERIALIZED (
  SELECT
    max(retail) FILTER (WHERE period_name = 'MTD') AS retail_mtd,
    max(wholesale) FILTER (WHERE period_name = 'MTD') AS wholesale_mtd,
    max(retail) FILTER (WHERE period_name = 'WEEK') AS retail_week,
    max(wholesale) FILTER (WHERE period_name = 'WEEK') AS wholesale_week,
    max(reporting_through) FILTER (WHERE period_name = 'MTD') AS month_through,
    max(reporting_through) FILTER (WHERE period_name = 'WEEK') AS week_through,
    max(coverage_status) FILTER (WHERE period_name = 'MTD') AS month_status,
    max(coverage_status) FILTER (WHERE period_name = 'WEEK') AS week_status,
    max(imported_at) AS imported_at,
    max(source_acquired_at) AS source_acquired_at
  FROM period_totals
)
SELECT
  k.retail_mtd AS "Retail_Bottles_MTD",
  k.wholesale_mtd AS "Wholesale_Bottles_MTD",
  k.retail_week AS "Retail_Bottles_This_Week",
  k.wholesale_week AS "Wholesale_Bottles_This_Week",
  GREATEST(k.month_through, k.week_through) AS "Data_Through",
  b.month_start AS "Month_Start",
  b.week_start AS "Week_Start",
  b.week_start + 6 AS "Week_End",
  k.month_through AS "MTD_Data_Through",
  k.week_through AS "Week_Data_Through",
  k.month_status AS "MTD_Coverage_Status",
  k.week_status AS "Week_Coverage_Status",
  CASE
    WHEN k.month_through IS NULL AND k.week_through IS NULL
      THEN 'Awaiting certified sales days'
    WHEN k.month_through = k.week_through
      THEN 'Sales through ' || to_char(k.month_through, 'Mon DD, YYYY') || ' · weeks Mon–Sun'
    ELSE 'MTD: ' || COALESCE('through ' || to_char(k.month_through, 'Mon DD, YYYY'), 'awaiting data')
      || ' · week: ' || COALESCE('through ' || to_char(k.week_through, 'Mon DD, YYYY'), 'awaiting data')
      || ' (Mon–Sun)'
  END AS "As_Of_Label",
  k.source_acquired_at AT TIME ZONE 'America/New_York' AS "Latest_Source_Acquired_At",
  k.imported_at AT TIME ZONE 'America/New_York' AS "Latest_Import_Completed_At"
FROM kpis k
CROSS JOIN bounds b
CROSS JOIN permitted;

REVOKE ALL ON public.echo_item_sales_current_kpis FROM PUBLIC;
