# Board KPI query performance — November 25, 2026

## Scope

The owner asked to address slow loading of the production Board KPIs dashboard. The change is limited to one existing PostgreSQL view, `public.echo_item_sales_reporting_status`, on project `crimson-river-91402927`, production branch `main / br-solitary-lake-am9whrqb`, database `neondb`. It preserves the surrounding application and unrelated concurrent main work; `neat-tst` is outside the scope.

Migration: [`20261125211500_echo_item_sales_reporting_performance`](../../prisma/migrations/20261125211500_echo_item_sales_reporting_performance/migration.sql).

Exact migration SHA-256: `3738b3876a19c54f8628b5784e3a95d20935d292248d695dc24e6019ba973230` (5,643 bytes). The view replacement and matching one-step Prisma ledger record committed atomically on production at **2026-11-25 21:15:23.076 UTC (4:15:23 p.m. Eastern)**. A pre-application definition guard protected against concurrent view changes. Stored definition MD5 `19ddcf04ed0056e8d0577b708af5b5c3` matches rehearsal.

## Cause and correction

The original status definition repeatedly expanded complete-month calculations and repeated cutoff expressions. A representative execution plan performed the expensive historical daily validation 25 times. Each pass checked Echo's row counts, signed retail/wholesale totals and ordered fact fingerprints against import receipts. Monthly, product, agency and channel reads inherit this work through their status dependency.

The revised view computes certified days once, derives the unchanged complete-month set once, and materializes the small calendar/summary/cutoff/period stages. These materialized CTEs exist only for the current query. Daily receipt validation stays live; there is no persisted cache, new refresh schedule, additional index or larger compute.

The migration uses `CREATE OR REPLACE VIEW ... WITH (security_barrier = true)`. The existing 15-column status interface, ownership and permissions remain intact. All unchanged consumer views continue to use the same object.

## Measurements

The before/after query comparisons use the same SQL and database target. Database execution and browser elapsed time are different measurements and are recorded separately.

| Measurement | Before | After |
| --- | ---: | ---: |
| Diagnostic status SELECT, EXPLAIN ANALYZE | 8.647382 s | 0.360008 s production |
| Diagnostic monthly SELECT, EXPLAIN ANALYZE | 9.472954 s | 0.769792 s production |
| Fresh Monthly Bottle Sales page refresh | 19.017 s | 4.506 s |
| Actual JDBC grand-total statement during the refresh | 16.132 s | 1.761437 s |

The baseline manual refresh was observed at 2026-11-25 21:11 UTC. Post-application diagnostic queries ran as the actual restricted reporting login `looker_echo_bailment_prod` in `neondb`; the monthly aggregate returned 60 rows. Planning took 2.262 ms for status and 2.033 ms for monthly totals. Earlier read-only candidate timings were 0.332469 s and 0.957190 s respectively. Browser timing measured the same manual **Refresh data** action, with the loading indicator appearing and disappearing. Only the grand-total JDBC statement remained available for an actual post-refresh timing capture; no post-refresh actual JDBC status/grouped-query duration is claimed. These are measured executions on the existing workload, not latency guarantees or a complete isolation of client/network overhead.

## Validation

- Independent source review reversed only CTE names and `MATERIALIZED` declarations and recovered the previous status query exactly apart from whitespace. The complete-month CTE exactly reproduces the prior complete-month SELECT against the reused daily results.
- A same-snapshot read-only comparison found zero differing status rows and zero differences in either direction across all 13,352 historical reporting rows. There were 60 complete months in that snapshot; ongoing independently owned backfill can change later counts.
- The final migration was rehearsed on disposable production-derived branch `br-bold-cell-amwbo2pp`. The existing [historical reporting SQL fixture suite](../../tests/echo-item-sales-reporting-fixtures.sql) passed all 18 groups against the actual changed public views, then rolled back its fixture mutations. It did not recreate substitute test definitions. Source snapshot history at rehearsal extended back to November 2021 across 60 complete months.
- Production readback retained 60 available months, `READY`, the 2019 floor and the existing readiness flags. The 15-field interface, `neondb_owner` ownership, security barrier and SELECT-only reader ACL are unchanged. The restricted reader still has no raw-sales or receipt-table entitlement.
- Rehearsal access used a separate actual `looker_echo_bailment_prod` connection after the owner session rejected `SET ROLE`; no role membership or ACL change was made. Fixture rollback was verified by the restored 13,352 historical rows, 60 complete months and zero fixture-only vendor rows. The isolated branch is configured to expire at 2026-11-25 22:12 UTC.
- Actual restricted-reader production queries passed. The independent current-period KPI source still returns retail MTD 611, wholesale MTD 445, retail this week 38 and wholesale this week 83, through November 24, 2026.
- Fresh production Monthly Bottle Sales refresh and screenshot acceptance passed. The page retained 60 months and grand totals of 36,439 retail / 36,103 wholesale / 72,542 bottles after the existing dashboard exclusions. October 2026 remained 715 / 522 / 1,237; September remained 592 / 823 / 1,415. The live cutoff/status and chart rendering persisted correctly. This is focused desktop acceptance of the affected historical source, not a new mobile or application-wide UI test.

The existing fixtures cover missing and explicit zero days, same-count/same-total changed-fact fingerprints, signed returns, independent completed months, unsupported pre-2019 dates, 2019/2020 comparison boundaries, missing/current dimension labels and A3A fallback, invalid provenance, future completion and tenant eligibility. Fixture mutations belong only on the isolated rehearsal branch and roll back.

## Preserved behavior and rollback

No fact, receipt, import, retention, schedule, source connection, chart formula, dashboard exclusion, credential, base-table grant, current KPI view or Bailment view changes. The reporting role retains SELECT access to its existing public reporting surfaces without raw/evidence/private-coverage access or reporting writes. Application package, dependencies, UI source and release tags are unchanged; application-wide test/build claims are not part of this SQL-only activation.

If rollback is required, restore the previous `echo_item_sales_reporting_status` definition from the migration history through a new reviewed replacement migration while retaining its security barrier and ACLs. No source data or receipt deletion is needed. Restoring the old definition restores the earlier query cost as well.
