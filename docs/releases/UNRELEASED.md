# Unreleased

The owner explicitly approved the focused **0.7.2** Wholesale Orders hotfix and reconciliation of the six existing unfiled orders on November 5, 2026. Production preparation is in progress; deployment and live reconciliation are pending. Development remains frozen; no broader feature cycle is opened.

- Production base: `9b4bd8dd8b14ef6b81b628479b3a6780864be2f2`; current 0.7.1 application: `066b66ead25095c138ed2f5bd5b739e64ea55ec3`.
- Tested TST repair: `e9b778dbb4fae9438a63db161f9d5238c157df57`. Selective candidate and receipts: [0.7.2 release notes](0.7.2.md), [checklist](0.7.2-checklist.md) and [validation](0.7.2-validation.md).
- Historical [0.7.0 release records](0.7.0.md) and earlier tags/records remain preserved. Unrelated TST maintenance was excluded from production.
- Existing organization JSON fallback was configured for production James; no schema/migration, dependency, hosted environment, entitlement or production user/password/invitation change.

## Changes

- Bridge saved Brand Master supplier names to report vendor IDs using exact shared product codes and unique supplier mappings. Use explicitly stored account permit aliases without inferring location suffixes. Keep manual FILED/COMPLETED orders as evidence reservations, including unresolved historical supplier metadata.
- Preserve exact A-3a store, inclusive sale date through +7 days, complete positive product/bottle quantities, unambiguous matching and one-use evidence. Sent and Paid remain manual; original order snapshots/PDFs and manual filing history remain intact.
- Select only tested matcher/test source and the investigation record from TST, preserving main's additional tests, tooling, CI, TypeScript configuration and forecasting differences. Package/lock version metadata advances to 0.7.2; no schema/migration, dependency graph, hosted environment, provider, scheduled workflow or feature-flag change.
- Owner-confirmed Antiques on High report permit `03362482-2` was added as a non-primary alias in both environments with guarded, idempotent inserts and readback. Existing primary permit and other aliases remain. A fresh captured production-data replay matched all six pending orders in memory, then filed zero additional orders; live production reconciliation remains pending.
- Prior TST validation: 48 focused tests, 1,038 full-suite tests, strict typecheck and optimized offline build pass. Exact production-candidate CI/tests/build, deployment and live six-order filing/replay evidence are pending in the release records above.

## Entry template

- Description and user-visible behavior:
- Relevant TST commit(s):
- Validation and known limits:
- Migration, backfill, environment/configuration and feature flags:
- Release/recovery notes:
