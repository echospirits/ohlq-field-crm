# Current Echo bottle KPI cards — November 25, 2026

## Authorized scope and production result

The owner requested four cards directly on the production Board KPIs / Sales Stats page: Retail Bottles MTD, Wholesale Bottles MTD, Retail Bottles This Week and Wholesale Bottles This Week. This is a main-only reporting activation against the existing 0.15.18 application, not a promotion of unrelated TST work or a new application version.

The additive view `public.echo_item_sales_current_kpis` was applied to project `ohlq-field-crm / crimson-river-91402927`, branch `main / br-solitary-lake-am9whrqb`, database `neondb`, on **2026-11-25 at 18:41:38.152 UTC**. Exact migration `20261125184000_echo_item_sales_current_kpis` has SHA-256 `3efe01c9c979d60d6bad9c3faac4fcce2636229cd87441d987fae802ff434be7`. Its schema statements, the restricted SELECT grant and a matching Prisma ledger record committed atomically through the authenticated Neon connector.

## Reporting contract

- The view returns one row for the active, nonsuspended/noncancelled Echo organization with Ohio enabled. Its fixed vendor is `Z90399001`.
- Four nullable bigint metrics are `Retail_Bottles_MTD`, `Wholesale_Bottles_MTD`, `Retail_Bottles_This_Week` and `Wholesale_Bottles_This_Week`. Signed quantities are preserved. Items `3150B`, `3750B` and `4359B` are excluded from totals.
- Month and Monday–Sunday week boundaries use `America/New_York`. The scan begins at the earlier period start, so a week crossing a month or year is complete. Today is omitted because this source certifies completed daily reports.
- Every included day must have a receipt matching the exact vendor's full raw row count, signed retail/wholesale totals and deterministic fact hash. Exclusions apply after that reconciliation. Missing or invalid receipts are never treated as zero.
- Month and week advance independently through their uninterrupted certified prefix. A period with no certified day returns NULL; a certified empty source returns zero. A gap stops that period before the missing day, even if later dates exist.
- `MTD_Data_Through`, `Week_Data_Through` and their coverage statuses expose partial availability. `Data_Through` is the later of the two cutoffs, not a universal completeness guarantee. Display `As_Of_Label`, which identifies separate period cutoffs when they differ.
- `Latest_Source_Acquired_At` and `Latest_Import_Completed_At` remain distinct Eastern local timestamps and only describe days contributing to the displayed totals.
- Bounds, fact validation, calendar, cutoffs and totals use explicit materialized CTEs. The current-period view does not invoke the expensive completed-month reporting/status views.

For Looker, connect `SELECT * FROM public.echo_item_sales_current_kpis`. Use MAX (or SUM with the guaranteed one-row source) for each corresponding scorecard. Keep these current-period cards outside date controls intended for historical charts. Display unavailable/blank for NULL, not a forced zero.

## Permissions and migration application

The migration creates a security-barrier view and revokes PUBLIC privileges. As with the existing monthly reporting adapter, the environment-specific reader grant is an activation step, not a new raw-table entitlement:

```sql
GRANT SELECT ON public.echo_item_sales_current_kpis
TO looker_echo_bailment_prod;
```

The existing role has SELECT on this aggregate view and remains unable to read `OhlqAnnualSalesRow`, `EchoBottleSalesDayCoverage` or the private daily coverage view, or to INSERT/UPDATE/DELETE through the new view. No credential, membership, base-table grant, importer, schedule, raw fact, receipt, retention policy or existing reporting view was modified. The only data write was this migration's own ledger entry.

## Verification

1. The exact migration and reader grant were rehearsed on disposable branch `br-falling-rice-amxm3bjq`, copied from verified production main. Real restricted-role SELECT succeeded. The temporary branch was deleted after activation.
2. Read-only [boundary fixtures](../../tests/sql/echo-item-sales-current-kpis-boundaries.sql) all pass: month-first with a carryover week; Monday with a certified zero-sales day; independent month gap and signed return; previous-month week gap while the current month is ready; Sunday with certified zero sales; and January 1 with a cross-year week.
3. Rehearsal EXPLAIN ANALYZE returned one row in **162.529 ms**, planning **1.321 ms**. This is one measured query, not a production latency SLA.
4. Final production SELECT as `looker_echo_bailment_prod` returned:

| Metric | Verified value |
|---|---:|
| Retail Bottles MTD | 611 |
| Wholesale Bottles MTD | 445 |
| Retail Bottles This Week | 38 |
| Wholesale Bottles This Week | 83 |

Both periods are certified through **November 24, 2026**; month start is November 1 and the current week is November 23–29. The source was acquired November 25 at **08:14:39.867 Eastern**, imported at **08:17:12.014 Eastern**. The label is `Sales through Nov 24, 2026 · weeks Mon–Sun`.

This narrow SQL/reporting activation leaves application/package/dependency source unchanged. Validation covers the changed PostgreSQL behavior, permission boundary and actual main readback. No new application test/build, application-release/tag, or completed Looker visual acceptance is claimed by this backend record; the report editor verifies the four cards and freshness label separately.
