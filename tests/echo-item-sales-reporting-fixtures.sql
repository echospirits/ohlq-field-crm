-- Run only on an isolated, production-derived rehearsal branch after applying
-- 20261120020000_echo_item_sales_reporting. Execute as one session/transaction
-- with stop-on-error enabled. Every fixture change is rolled back at the end.
-- This verifies database/reporting behavior, not live provider completeness.
-- No production connection, importer, scheduler, dashboard or grants are used.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE FUNCTION pg_temp.echo_assert(assertion boolean, label text)
RETURNS void LANGUAGE plpgsql AS $body$
BEGIN
  IF assertion IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Echo reporting fixture failed: %', label;
  END IF;
END;
$body$;

DO $body$
BEGIN
  PERFORM pg_temp.echo_assert(
    (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date >= DATE '2026-02-01',
    'fixtures require January 2026 to be a closed source month');
  PERFORM pg_temp.echo_assert(
    EXISTS (SELECT 1 FROM public."Organization" WHERE "id" = 'org_echo_spirits'),
    'the isolated branch must contain the Echo organization');
  PERFORM pg_temp.echo_assert(
    (SELECT array_agg(column_name::text ORDER BY ordinal_position)
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'echo_item_sales_reporting'
        AND ordinal_position <= 10)
    = ARRAY['Month', 'District', 'Agency_Id', 'Agency_Name', 'Brand', 'Name',
            'Category', 'Retail_Bottles_Sold', 'Wholesale_Bottles_Sold', 'Reporting_Month'],
    'the first ten Item Sales fields preserve names and order');
END;
$body$;

-- The branch copy is isolated. These temporary replacements are all rolled back.
DELETE FROM public."EchoBottleSalesDayCoverage";
DELETE FROM public."OhlqAnnualSalesRow"
 WHERE "vendor" = 'Z90399001'
   AND "reportDate" BETWEEN DATE '2025-01-01' AND DATE '2026-01-31';
UPDATE public."Organization"
   SET "active" = true, "accountStatus" = 'ACTIVE', "enabledStates" = ARRAY['OH']
 WHERE "id" = 'org_echo_spirits';

INSERT INTO public."Agency" ("id", "agencyId", "name", "warehouse", "createdAt", "updatedAt")
VALUES
  ('echo_fixture_agency', 'ECHO_FIXTURE_AGENCY', 'Current Fixture Agency', 'GRN', now(), now()),
  ('echo_fixture_powell', '90285', 'Current Powell Label', 'GRN', now(), now()),
  ('echo_fixture_distillery', '90399', 'Current Distillery Label', 'GRN', now(), now())
ON CONFLICT ("agencyId") DO UPDATE
  SET "name" = EXCLUDED."name", "warehouse" = EXCLUDED."warehouse";
INSERT INTO public."OhlqBrandMasterItem" ("itemCode", "name", "category", "createdAt", "updatedAt")
VALUES ('ECHO_FIXTURE_BRAND', 'Current Fixture Product', 'Fixture Category', now(), now())
ON CONFLICT ("itemCode") DO UPDATE SET "name" = EXCLUDED."name", "category" = EXCLUDED."category";

INSERT INTO public."OhlqAnnualSalesRow"
  ("reportDate", "agencyId", "vendor", "brand", "retailBottlesSold", "wholesaleBottlesSold")
VALUES
  ('2025-01-15', '90285', 'Z90399001', 'ECHO_FIXTURE_BRAND', -2, 3),
  ('2025-01-15', '90399', 'Z90399001', 'ECHO_FIXTURE_BRAND', 10, 5),
  ('2025-01-15', 'ECHO_FIXTURE_AGENCY', 'Z90399001', '3150B', -3, 4),
  ('2025-01-15', 'ECHO_FIXTURE_AGENCY', 'Z90399001', '3750B', 0, 0),
  ('2025-01-15', 'ECHO_FIXTURE_AGENCY', 'Z90399001', '4359B', 4, 0),
  ('2025-01-15', 'ECHO_FIXTURE_UNMATCHED', 'Z90399001', 'ECHO_FIXTURE_UNMATCHED_PRODUCT', 0, 7),
  ('2026-01-15', '90399', 'Z90399001', 'ECHO_FIXTURE_BRAND', 3, 2),
  ('2025-01-15', 'ECHO_FIXTURE_OTHER_VENDOR', 'NOT_ECHO', 'ECHO_FIXTURE_BRAND', 999, 999);

-- This wholesale-detail row must never be added to the summary's wholesale sum.
INSERT INTO public."OhlqAnnualSalesByWholesaleRow"
  ("reportDate", "agencyId", "vendor", "brand", "permitNumber", "wholesaleBottlesSold")
VALUES ('2025-01-15', '90399', 'Z90399001', 'ECHO_FIXTURE_BRAND', 'ECHO_FIXTURE_PERMIT', 777);

-- Independent fixed test vectors, calculated with Python hashlib.sha256 over
-- UTF-8 JSON arrays using JSONB's spaces and C-sorted (agency,vendor,brand) keys.
-- Jan 15 2025: six rows, retail 9, wholesale 19; Jan 15 2026: one row, 3/2.
-- Neither expected fact fingerprint is read back from the implementation view.
CREATE TEMP TABLE echo_fixture_receipts
  (LIKE public."EchoBottleSalesDayCoverage" INCLUDING ALL) ON COMMIT DROP;
INSERT INTO echo_fixture_receipts
SELECT
  d::date, 'Z90399001', '9781fc23-73de-4ee8-b0b8-77ae6f9b7c4e', 'VENDOR_FILTERED',
  d::date, d::date, 'synthetic-fixture:' || to_char(d, 'YYYY-MM-DD'),
  repeat('a', 64), 1000::bigint,
  CASE d::date WHEN DATE '2025-01-15' THEN 6 WHEN DATE '2026-01-15' THEN 1 ELSE 0 END,
  0, true, NULL::timestamptz, date_trunc('milliseconds', CURRENT_TIMESTAMP),
  CASE d::date WHEN DATE '2025-01-15' THEN 6 WHEN DATE '2026-01-15' THEN 1 ELSE 0 END,
  CASE d::date WHEN DATE '2025-01-15' THEN 9 WHEN DATE '2026-01-15' THEN 3 ELSE 0 END::bigint,
  CASE d::date WHEN DATE '2025-01-15' THEN 19 WHEN DATE '2026-01-15' THEN 2 ELSE 0 END::bigint,
  CASE d::date
    WHEN DATE '2025-01-15' THEN '88409410dd76ccdb9669fb9ea3ef71663849f1c4d59985e5653b1ea5bd00f373'
    WHEN DATE '2026-01-15' THEN '10d3eb1e5c6a33bf049235a1580cd32ec359cf592c032bf9a4ea1527d10df575'
    ELSE '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'
  END
FROM generate_series(DATE '2025-01-01', DATE '2026-01-31', INTERVAL '1 day') d;

DO $body$
BEGIN
  PERFORM pg_temp.echo_assert(
    (SELECT "Reporting_Month" IS NULL AND NOT "Comparison_Ready"
            AND "First_Uncertified_Date" = DATE '2025-01-01'
       FROM public.echo_item_sales_reporting_status),
    'physical facts without receipts cannot certify history');
  PERFORM pg_temp.echo_assert((SELECT count(*) = 0 FROM public.echo_item_sales_reporting),
    'uncertified facts are not published');
END;
$body$;

INSERT INTO public."EchoBottleSalesDayCoverage"
SELECT * FROM echo_fixture_receipts WHERE "reportDate" <= DATE '2025-12-31';
DO $body$
BEGIN
  PERFORM pg_temp.echo_assert(
    (SELECT "Reporting_Month" = DATE '2025-12-01' AND NOT "Comparison_Ready"
            AND "First_Uncertified_Date" = DATE '2026-01-01'
       FROM public.echo_item_sales_reporting_status),
    'a completed old reporting year does not fabricate its prior-year comparison');
  PERFORM pg_temp.echo_assert((SELECT count(*) = 0 FROM public.echo_item_sales_reporting),
    '2025-only coverage remains gated from the existing YTD comparison source');
END;
$body$;

INSERT INTO public."EchoBottleSalesDayCoverage"
SELECT * FROM echo_fixture_receipts WHERE "reportDate" BETWEEN DATE '2026-01-01' AND DATE '2026-01-30';
DO $body$
BEGIN
  PERFORM pg_temp.echo_assert(
    (SELECT "Reporting_Month" = DATE '2025-12-01' AND NOT "Comparison_Ready"
            AND "First_Uncertified_Date" = DATE '2026-01-31'
       FROM public.echo_item_sales_reporting_status),
    'one missing last day prevents advancing into the new reporting year');
END;
$body$;
INSERT INTO public."EchoBottleSalesDayCoverage"
SELECT * FROM echo_fixture_receipts WHERE "reportDate" = DATE '2026-01-31';

DO $body$
BEGIN
  PERFORM pg_temp.echo_assert(
    (SELECT "Reporting_Month" = DATE '2026-01-01' AND "Comparison_Ready"
            AND "Reporting_Through" = DATE '2026-01-31'
       FROM public.echo_item_sales_reporting_status),
    'complete January advances the reporting year with matched prior-year coverage');
  PERFORM pg_temp.echo_assert((SELECT count(*) = 7 FROM public.echo_item_sales_reporting),
    'all seven monthly facts survive without other-vendor or wholesale-detail duplication');
  PERFORM pg_temp.echo_assert(
    (SELECT sum("Retail_Bottles_Sold") = 9 AND sum("Wholesale_Bottles_Sold") = 19
       FROM public.echo_item_sales_reporting WHERE "Month" = DATE '2025-01-01'),
    'signed retail and summary wholesale reconcile independently');
  PERFORM pg_temp.echo_assert(
    (SELECT count(*) = 3 FROM public.echo_item_sales_reporting
      WHERE "Month" = DATE '2025-01-01' AND "Brand" IN ('3150B', '3750B', '4359B')),
    'business exclusions remain downstream, including the operational-only third exclusion');
  PERFORM pg_temp.echo_assert(
    EXISTS (SELECT 1 FROM public.echo_item_sales_reporting
      WHERE "Month" = DATE '2025-01-01' AND "Brand" = '3750B'
        AND "Retail_Bottles_Sold" = 0 AND "Wholesale_Bottles_Sold" = 0),
    'explicit zero quantity facts survive');
  PERFORM pg_temp.echo_assert(
    EXISTS (SELECT 1 FROM public.echo_item_sales_reporting
      WHERE "Month" = DATE '2025-01-01' AND "Agency_Id" = '90285'
        AND "Retail_Bottles_Sold" = -2 AND "Agency_Name" = 'Current Powell Label'
        AND "District" = 'GRN' AND "Name" = 'Current Fixture Product'),
    'negative returns and valid current master labels take precedence');
  PERFORM pg_temp.echo_assert(
    EXISTS (SELECT 1 FROM public.echo_item_sales_reporting
      WHERE "Agency_Id" = 'ECHO_FIXTURE_UNMATCHED' AND "Agency_Name" = 'ECHO_FIXTURE_UNMATCHED'
        AND "Name" = 'ECHO_FIXTURE_UNMATCHED_PRODUCT' AND "Category" IS NULL AND "District" IS NULL
        AND "Wholesale_Bottles_Sold" = 7),
    'unmatched dimensions retain source quantities and honest unknown attributes');
  PERFORM pg_temp.echo_assert(
    (SELECT bool_and("Reporting_Month" = DATE '2026-01-01'
                     AND "Latest_Known_Source_Acquired_At" IS NULL)
       FROM public.echo_item_sales_reporting),
    'one cutoff is repeated and unknown acquisition time is not invented');
END;
$body$;

SAVEPOINT a3a_fallback;
UPDATE public."Agency" SET "name" = ' ', "warehouse" = NULL WHERE "agencyId" IN ('90285', '90399');
DO $body$
BEGIN
  PERFORM pg_temp.echo_assert(
    EXISTS (SELECT 1 FROM public.echo_item_sales_reporting WHERE "Agency_Id" = '90285'
      AND "Agency_Name" = 'ECHO SPIRITS POWELL' AND "District" = 'GPT')
    AND EXISTS (SELECT 1 FROM public.echo_item_sales_reporting WHERE "Agency_Id" = '90399'
      AND "Agency_Name" = 'ECHO SPIRITS DISTILLING CO' AND "District" = 'GPT'),
    'the exact two A3A fallbacks fill missing master metadata');
END;
$body$;
ROLLBACK TO SAVEPOINT a3a_fallback;

SAVEPOINT missing_day;
DO $body$
BEGIN
  PERFORM pg_temp.echo_assert(
    (SELECT "Is_Complete" FROM public.echo_item_sales_day_coverage WHERE "Sales_Date" = DATE '2025-01-16'),
    'an explicit zero-sale receipt certifies a physically empty day');
END;
$body$;
DELETE FROM public."EchoBottleSalesDayCoverage" WHERE "reportDate" = DATE '2025-01-16';
DO $body$
BEGIN
  PERFORM pg_temp.echo_assert(
    (SELECT "Reporting_Month" IS NULL AND "First_Uncertified_Date" = DATE '2025-01-16'
       FROM public.echo_item_sales_reporting_status),
    'the same physically empty day is unknown when its receipt is absent');
  PERFORM pg_temp.echo_assert((SELECT count(*) = 0 FROM public.echo_item_sales_reporting),
    'later complete periods cannot jump the first missing month');
END;
$body$;
ROLLBACK TO SAVEPOINT missing_day;

SAVEPOINT later_gap;
DELETE FROM public."EchoBottleSalesDayCoverage" WHERE "reportDate" = DATE '2025-12-15';
DO $body$
BEGIN
  PERFORM pg_temp.echo_assert(
    (SELECT "Reporting_Month" = DATE '2025-11-01' AND NOT "Comparison_Ready"
            AND "First_Uncertified_Date" = DATE '2025-12-15'
       FROM public.echo_item_sales_reporting_status),
    'a late historical gap prevents skipping ahead into a complete new-year month');
END;
$body$;
ROLLBACK TO SAVEPOINT later_gap;

SAVEPOINT reallocated_facts;
UPDATE public."OhlqAnnualSalesRow"
   SET "retailBottlesSold" = CASE "agencyId" WHEN '90285' THEN -3 ELSE 11 END
 WHERE "vendor" = 'Z90399001' AND "reportDate" = DATE '2025-01-15'
   AND "agencyId" IN ('90285', '90399') AND "brand" = 'ECHO_FIXTURE_BRAND';
DO $body$
BEGIN
  PERFORM pg_temp.echo_assert(
    (SELECT count(*) = 6 AND sum("retailBottlesSold") = 9 AND sum("wholesaleBottlesSold") = 19
       FROM public."OhlqAnnualSalesRow" WHERE "vendor" = 'Z90399001' AND "reportDate" = DATE '2025-01-15'),
    'the correction fixture deliberately preserves count and both signed totals');
  PERFORM pg_temp.echo_assert(
    (SELECT NOT "Is_Complete" FROM public.echo_item_sales_day_coverage WHERE "Sales_Date" = DATE '2025-01-15'),
    'changed account allocation invalidates a stale receipt despite matching totals');
  PERFORM pg_temp.echo_assert((SELECT count(*) = 0 FROM public.echo_item_sales_reporting),
    'stale correction evidence prevents publishing the affected contiguous history');
END;
$body$;
ROLLBACK TO SAVEPOINT reallocated_facts;

SAVEPOINT complete_state_zero;
UPDATE public."EchoBottleSalesDayCoverage"
   SET "sourceScope" = 'COMPLETE_STATEWIDE', "sourceRowCount" = 1234
 WHERE "reportDate" = DATE '2025-01-16';
DO $body$
BEGIN
  PERFORM pg_temp.echo_assert(
    (SELECT "Is_Complete" FROM public.echo_item_sales_day_coverage WHERE "Sales_Date" = DATE '2025-01-16'),
    'a complete statewide export can independently certify zero Echo rows');
END;
$body$;
ROLLBACK TO SAVEPOINT complete_state_zero;

SAVEPOINT pre_dashboard_history;
UPDATE echo_fixture_receipts
   SET "reportDate" = DATE '2024-12-31', "requestedFrom" = DATE '2024-12-31',
       "requestedTo" = DATE '2024-12-31', "requestReference" = 'synthetic-pre-dashboard-history'
 WHERE "reportDate" = DATE '2025-01-16';
INSERT INTO public."EchoBottleSalesDayCoverage"
SELECT * FROM echo_fixture_receipts WHERE "reportDate" = DATE '2024-12-31';
-- Deliberately stale pre-dashboard evidence must not claim completeness outside
-- the private view's supported horizon or enter the public monthly quantities.
INSERT INTO public."OhlqAnnualSalesRow"
  ("reportDate", "agencyId", "vendor", "brand", "retailBottlesSold", "wholesaleBottlesSold")
VALUES ('2024-12-31', 'ECHO_FIXTURE_AGENCY', 'Z90399001', 'ECHO_FIXTURE_BRAND', 500, 500);
DO $body$
BEGIN
  PERFORM pg_temp.echo_assert(
    EXISTS (SELECT 1 FROM public."EchoBottleSalesDayCoverage" WHERE "reportDate" = DATE '2024-12-31')
    AND NOT EXISTS (SELECT 1 FROM public.echo_item_sales_day_coverage WHERE "Sales_Date" = DATE '2024-12-31'),
    'earlier source receipts are permitted without certifying unsupported dashboard dates');
  PERFORM pg_temp.echo_assert((SELECT count(*) = 7 FROM public.echo_item_sales_reporting),
    'pre-dashboard facts and receipts do not change the January 2025 reporting horizon');
END;
$body$;
ROLLBACK TO SAVEPOINT pre_dashboard_history;

-- Each bad update is contained in a PL/pgSQL subtransaction and must fail closed.
DO $body$
DECLARE mutation text;
BEGIN
  FOREACH mutation IN ARRAY ARRAY[
    '"vendor" = ''NOT_ECHO''',
    '"sourceReportIdentity" = ''wrong-report''',
    '"sourceScope" = ''UNKNOWN''',
    '"requestedTo" = "reportDate" + 1',
    '"requestReference" = '' ''',
    '"sourceContentSha256" = ''invalid''',
    '"sourceByteLength" = 0',
    '"sourceSkippedRows" = 1',
    '"sourceExportCompleted" = false',
    '"sourceRowCount" = 1',
    '"expectedRowCount" = -1',
    '"expectedRetailBottles" = 1',
    '"expectedFactsSha256" = repeat(''0'', 64)',
    '"completedAt" = TIMESTAMPTZ ''2025-01-16 18:00:00+00''',
    '"sourceAcquiredAt" = "completedAt" + INTERVAL ''1 second'''
  ] LOOP
    BEGIN
      EXECUTE 'UPDATE public."EchoBottleSalesDayCoverage" SET ' || mutation
        || ' WHERE "reportDate" = DATE ''2025-01-16''';
      RAISE EXCEPTION 'A malformed successful-day receipt was accepted: %', mutation;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
END;
$body$;

SAVEPOINT future_receipt;
UPDATE public."EchoBottleSalesDayCoverage" SET "completedAt" = CURRENT_TIMESTAMP + INTERVAL '1 day'
 WHERE "reportDate" = DATE '2025-01-16';
DO $body$
BEGIN
  PERFORM pg_temp.echo_assert(
    (SELECT NOT "Is_Complete" FROM public.echo_item_sales_day_coverage WHERE "Sales_Date" = DATE '2025-01-16'),
    'a future-dated completion timestamp cannot certify current reporting');
END;
$body$;
ROLLBACK TO SAVEPOINT future_receipt;

SAVEPOINT tenant_gates;
UPDATE public."Organization" SET "active" = false WHERE "id" = 'org_echo_spirits';
DO $body$
BEGIN
  PERFORM pg_temp.echo_assert(
    (SELECT count(*) = 0 FROM public.echo_item_sales_reporting)
    AND (SELECT count(*) = 0 FROM public.echo_item_sales_reporting_status)
    AND (SELECT count(*) = 0 FROM public.echo_item_sales_day_coverage),
    'inactive Echo exposes no reporting or coverage rows');
END;
$body$;
UPDATE public."Organization" SET "active" = true, "accountStatus" = 'SUSPENDED' WHERE "id" = 'org_echo_spirits';
DO $body$
BEGIN
  PERFORM pg_temp.echo_assert((SELECT count(*) = 0 FROM public.echo_item_sales_reporting_status),
    'suspended Echo exposes no reporting status');
END;
$body$;
UPDATE public."Organization" SET "accountStatus" = 'ACTIVE', "enabledStates" = ARRAY['KY'] WHERE "id" = 'org_echo_spirits';
DO $body$
BEGIN
  PERFORM pg_temp.echo_assert((SELECT count(*) = 0 FROM public.echo_item_sales_reporting_status),
    'Echo without Ohio enrollment exposes no reporting status');
END;
$body$;
ROLLBACK TO SAVEPOINT tenant_gates;

DO $body$
BEGIN
  PERFORM pg_temp.echo_assert((SELECT count(*) = 7 FROM public.echo_item_sales_reporting),
    'restored valid evidence and tenant state recover the same report');
END;
$body$;
SELECT jsonb_build_object(
  'suite', 'echo-item-sales-reporting', 'result', 'PASS',
  'checks', ARRAY['field-contract', 'uncertified-history', 'explicit-empty-day',
    'year-rollover', 'first-gap', 'signed-totals', 'scope-and-no-double-count',
    'current-master-and-A3A-fallback', 'missing-dimensions', 'unchanged-totals-hash-mismatch',
    'statewide-zero-Echo', 'pre-dashboard-history', '15-provenance-constraints',
    'future-completion', 'tenant-gates'],
  'disposition', 'All fixture mutations roll back in the following statement'
) AS fixture_result;
ROLLBACK;
