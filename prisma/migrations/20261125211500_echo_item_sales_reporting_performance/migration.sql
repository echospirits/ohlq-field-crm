-- Reuse live daily certification once per query; no persisted data cache.
-- Existing field shape, security barrier, permissions, and semantics are preserved.
CREATE OR REPLACE VIEW public.echo_item_sales_reporting_status WITH (security_barrier = true) AS
WITH certified_days AS MATERIALIZED (SELECT * FROM public.echo_item_sales_day_coverage), complete_months AS MATERIALIZED (SELECT (date_trunc('month'::text, ("Sales_Date")::timestamp with time zone))::date AS "Month"
   FROM certified_days
  WHERE "Is_Complete"
  GROUP BY ((date_trunc('month'::text, ("Sales_Date")::timestamp with time zone))::date)
 HAVING (count(*) = (((date_trunc('month'::text, (min("Sales_Date"))::timestamp with time zone) + '1 mon'::interval))::date - (date_trunc('month'::text, (min("Sales_Date"))::timestamp with time zone))::date))), bounds AS MATERIALIZED (
         SELECT '2019-01-01'::date AS history_start,
            (date_trunc('month'::text, (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York'::text)))::date AS current_month
        ), calendar AS MATERIALIZED (
         SELECT (b.history_start + n.n) AS sales_date
           FROM (bounds b
             CROSS JOIN LATERAL generate_series(0, ((b.current_month - b.history_start) - 1)) n(n))
        ), days AS MATERIALIZED (
         SELECT d.sales_date,
            COALESCE(c_1."Is_Complete", false) AS is_complete,
            c_1."Import_Completed_At" AS import_completed_at,
            c_1."Source_Acquired_At" AS source_acquired_at
           FROM (calendar d
             LEFT JOIN certified_days c_1 ON ((c_1."Sales_Date" = d.sales_date)))
        ), summary AS MATERIALIZED (
         SELECT (count(*))::integer AS expected_days,
            (count(*) FILTER (WHERE days.is_complete))::integer AS complete_days,
            min(days.sales_date) FILTER (WHERE (NOT days.is_complete)) AS first_missing_date,
            max(days.import_completed_at) FILTER (WHERE days.is_complete) AS latest_import_completed_at,
            max(days.source_acquired_at) FILTER (WHERE days.is_complete) AS latest_known_source_acquired_at
           FROM days
        ), cutoff AS MATERIALIZED (
         SELECT b.history_start,
            b.current_month,
            s.expected_days,
            s.complete_days,
            s.first_missing_date,
            s.latest_import_completed_at,
            s.latest_known_source_acquired_at,
            ( SELECT max(complete_months."Month") AS max
                   FROM complete_months) AS reporting_month
           FROM (bounds b
             CROSS JOIN summary s)
        ), periods AS MATERIALIZED (
         SELECT c_1.history_start,
            c_1.current_month,
            c_1.expected_days,
            c_1.complete_days,
            c_1.first_missing_date,
            c_1.latest_import_completed_at,
            c_1.latest_known_source_acquired_at,
            c_1.reporting_month,
            ((c_1.reporting_month >= '2019-01-01'::date) AND (NOT (EXISTS ( SELECT 1
                   FROM days
                  WHERE (((days.sales_date >= (date_trunc('year'::text, (c_1.reporting_month)::timestamp with time zone))::date) AND (days.sales_date <= ((c_1.reporting_month + '1 mon -1 days'::interval))::date)) AND (NOT days.is_complete)))))) AS current_ready,
            ((c_1.reporting_month >= '2020-01-01'::date) AND (NOT (EXISTS ( SELECT 1
                   FROM days
                  WHERE (((days.sales_date >= ((date_trunc('year'::text, (c_1.reporting_month)::timestamp with time zone) - '1 year'::interval))::date) AND (days.sales_date <= ((c_1.reporting_month - '11 mons 1 day'::interval))::date)) AND (NOT days.is_complete)))))) AS prior_ready
           FROM cutoff c_1
        )
 SELECT c.history_start AS "History_Start",
    ((c.current_month - '1 mon'::interval))::date AS "Latest_Closed_Month",
    c.expected_days AS "Expected_Days",
    c.complete_days AS "Certified_Days",
    c.first_missing_date AS "First_Uncertified_Date",
    c.reporting_month AS "Reporting_Month",
    (((c.reporting_month + '1 mon'::interval) - '1 day'::interval))::date AS "Reporting_Through",
    COALESCE((c.current_ready AND c.prior_ready), false) AS "Comparison_Ready",
        CASE
            WHEN (c.reporting_month IS NULL) THEN 'AWAITING_CERTIFIED_HISTORY'::text
            WHEN (NOT (c.current_ready AND c.prior_ready)) THEN 'PRIOR_YEAR_HISTORY_INCOMPLETE'::text
            WHEN (c.reporting_month < ((c.current_month - '1 mon'::interval))::date) THEN 'PARTIAL_HISTORY'::text
            ELSE 'READY'::text
        END AS "Coverage_Status",
    (c.latest_import_completed_at AT TIME ZONE 'America/New_York'::text) AS "Latest_Import_Completed_At",
    (c.latest_known_source_acquired_at AT TIME ZONE 'America/New_York'::text) AS "Latest_Known_Source_Acquired_At",
    (COALESCE(c.current_ready, false))::integer AS "Current_YTD_Ready",
    (COALESCE(c.prior_ready, false))::integer AS "Prior_YTD_Ready",
    ( SELECT (count(*))::integer AS count
           FROM complete_months) AS "Available_Months",
    ( SELECT (count(*))::integer AS count
           FROM complete_months m
          WHERE (NOT (EXISTS ( SELECT 1
                   FROM public."OhlqAnnualSalesRow" f
                  WHERE ((f.vendor = 'Z90399001'::text) AND (f."reportDate" >= m."Month") AND (f."reportDate" < (m."Month" + '1 mon'::interval))))))) AS "Empty_Completed_Months"
   FROM (periods c
     JOIN public."Organization" o ON ((o.id = 'org_echo_spirits'::text)))
  WHERE ((o.active = true) AND (o."accountStatus" <> ALL (ARRAY['SUSPENDED'::public."OrganizationStatus", 'CANCELLED'::public."OrganizationStatus"])) AND ('OH'::text = ANY (o."enabledStates")));

