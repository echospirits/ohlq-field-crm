# Permanent Echo bottle-sales retention

## Policy and implementation

Echo Spirits vendor `Z90399001` has no age-based expiration in the existing `OhlqAnnualSalesRow` and `OhlqAnnualSalesByWholesaleRow` tables. Every other vendor keeps `OHLQ_REPORT_RETENTION_DAYS`, defaulting to **30 inclusive calendar dates**. The rule follows the exact source vendor identity, independently of tenant configuration, active products or dashboard exclusions. It preserves returns, zero quantities, distillery rows and excluded brands, with retail and wholesale quantities separate.

`lib/ohlqAnnualSalesRetention.ts` deletes only rows earlier than `reportDate - (retentionDays - 1)` whose vendor is not `Z90399001`. Both table deletions remain in one transaction and the return contract is unchanged. Positive safe-integer retention counts, valid report dates and representable cutoffs are checked before either deletion is constructed. The daily workflow and post-import backfill stage log the two policy scopes explicitly.

A complete source refresh still atomically replaces its report date. Permanent retention prevents age-based cleanup; corrected source quantities remain authoritative. The feature adds no archive table, schema migration, dependency, scheduler, provider download or reporting endpoint.

## Consumer boundaries

Recent agency sales and statewide market analysis retain their explicit 7-day and 30-day windows. Older Echo facts do not enter those totals. Analytics, daily readiness and wholesale ledger capture retain their full-source completeness checks: an old date containing only retained Echo rows cannot certify a complete statewide report or replace previously complete wholesale evidence.

Historical consumers can see older Echo evidence for latest purchases, product discovery and order reconciliation within the existing sale-date eligibility window. Tenant access, product exclusions and account matching are unchanged.

## Backfill and future reporting

Retention begins protecting available Echo facts after deployment; it does not recreate deleted rows or reconnect the four spreadsheet-backed bottle-sales dashboard pages.

Do not pass an Echo-only file to the existing full-report importer: it replaces every vendor for that date and records statewide source counts. A historical load needs vendor-scoped replacement/completeness records or complete source reports. Likewise, a multi-month export cannot go through a single-date importer. Monthly seeding needs a period-aware path and an explicit boundary between monthly history and daily facts to prevent double counting.

Future reporting must preserve signed quantities, original sales months, dashboard exclusions and distillery semantics. Establish Echo-specific completeness before treating absent older rows as zero; existing statewide completeness guards deliberately remain strict.

## Release and operation

Owner-authorized **0.12.0** selectively promotes the retention changes accepted in TST `7b80a0768ca209da913fb7f6908e20aaa8749423` onto production base `28615305603f61c7d0cb5ba0abb7c7dc4b9d839b` / 0.11.0. Production-specific workflow behavior remains intact; unrelated TST Tasting/Social pilots are excluded. TST remains 0.10.0-dev with its schedules disabled. Production schedules and configuration remain unchanged.

See the [release manifest](../releases/0.12.0.md), [checklist](../releases/0.12.0-checklist.md) and [validation](../releases/0.12.0-validation.md) for exact candidate and deployment status. No real-data cleanup or historical load is needed to deploy this code-only policy. A rollback must preserve the Echo exemption or prevent old age-pruning code from running; the previous rule would expire accumulated Echo history.

## Validation scope

Stateful tests cover survival in both datasets, exact vendor identity, cutoff boundaries, signed/zero quantities, excluded products, replay, next-day expiration and invalid inputs before mutation. Interaction tests cover corrected full-report imports, recent windows and incomplete statewide coverage.

The accepted TST evidence includes PostgreSQL 18.7 SQL predicate/rollback verification in a separate synthetic database. The direct live Prisma attempt was blocked by local TCP access, so this is SQL-level evidence plus application tests, not end-to-end live service execution. Production validation and any browser/build limitations are recorded separately in the release validation document.
