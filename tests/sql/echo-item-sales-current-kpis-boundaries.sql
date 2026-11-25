-- Independent boundary fixtures for the current bottle KPI period aggregation.
-- Values are [retail MTD, wholesale MTD, retail week, wholesale week].
-- Read-only: uses literal synthetic data, no DDL or user sales records.
-- Expected result: six rows with passed=true. The period core below is taken
-- verbatim from the migration for this review; refresh it when that core changes.
WITH scenarios(scenario, today, expected) AS (VALUES
('month_first_week_carry', DATE '2026-12-01', '[null, null, 5, 7]'::jsonb),
('monday_zero_prior_day', DATE '2026-11-02', '[0, 0, null, null]'::jsonb),
('independent_gap_signed', DATE '2026-11-25', '[10, 0, 3, 5]'::jsonb),
('week_gap_month_ready', DATE '2026-12-02', '[1, 2, null, null]'::jsonb),
('sunday_zero_sales', DATE '2026-12-06', '[0, 0, 0, 0]'::jsonb),
('year_first_week_carry', DATE '2027-01-01', '[null, null, 8, 12]'::jsonb)
), scenario_days AS (
SELECT 'month_first_week_carry'::text AS scenario, f.* FROM (SELECT DATE '2026-11-30' AS sales_date, 5::bigint retail, 7::bigint wholesale, true is_certified) f
UNION ALL
SELECT 'monday_zero_prior_day'::text AS scenario, f.* FROM (SELECT DATE '2026-11-01' AS sales_date, 0::bigint retail, 0::bigint wholesale, true is_certified) f
UNION ALL
SELECT 'independent_gap_signed'::text AS scenario, f.* FROM (SELECT d::date sales_date, (CASE WHEN d::date=DATE '2026-11-01' THEN 10 WHEN d::date=DATE '2026-11-23' THEN 4 WHEN d::date=DATE '2026-11-24' THEN -1 ELSE 0 END)::bigint retail, (CASE WHEN d::date=DATE '2026-11-23' THEN 8 WHEN d::date=DATE '2026-11-24' THEN -3 ELSE 0 END)::bigint wholesale, d::date<>DATE '2026-11-02' is_certified FROM generate_series(DATE '2026-11-01',DATE '2026-11-24',INTERVAL '1 day') d) f
UNION ALL
SELECT 'week_gap_month_ready'::text AS scenario, f.* FROM (SELECT d::date sales_date, 1::bigint retail, 2::bigint wholesale, d::date<>DATE '2026-11-30' is_certified FROM generate_series(DATE '2026-11-30',DATE '2026-12-01',INTERVAL '1 day') d) f
UNION ALL
SELECT 'sunday_zero_sales'::text AS scenario, f.* FROM (SELECT d::date sales_date, 0::bigint retail, 0::bigint wholesale, true is_certified FROM generate_series(DATE '2026-11-30',DATE '2026-12-05',INTERVAL '1 day') d) f
UNION ALL
SELECT 'year_first_week_carry'::text AS scenario, f.* FROM (SELECT d::date sales_date, 2::bigint retail, 3::bigint wholesale, true is_certified FROM generate_series(DATE '2026-12-28',DATE '2026-12-31',INTERVAL '1 day') d) f
)
SELECT s.scenario, s.expected, v.actual, v.actual = s.expected AS passed, k."As_Of_Label", k."Week_Start", k."Week_End"
FROM scenarios s
CROSS JOIN LATERAL (
WITH bounds AS MATERIALIZED (
 SELECT s.today, date_trunc('month',s.today)::date month_start, date_trunc('week',s.today)::date week_start
), permitted AS (SELECT 1), days AS MATERIALIZED (
 SELECT d.sales_date, d.retail, d.wholesale, d.is_certified, TIMESTAMPTZ '2026-11-25 08:00:00-05' imported_at, TIMESTAMPTZ '2026-11-25 07:00:00-05' source_acquired_at
 FROM scenario_days d WHERE d.scenario=s.scenario
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
CROSS JOIN permitted
) k
CROSS JOIN LATERAL (SELECT jsonb_build_array(k."Retail_Bottles_MTD", k."Wholesale_Bottles_MTD", k."Retail_Bottles_This_Week", k."Wholesale_Bottles_This_Week") actual) v;
