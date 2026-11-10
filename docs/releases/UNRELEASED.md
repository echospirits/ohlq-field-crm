# Unreleased

Version **0.8.0** is the owner-authorized selective Production Forecasting release candidate. The owner accepted TST and requested promotion to main on November 10, 2026. Production is currently 0.7.3 until the candidate passes all gates and is promoted. No broader development cycle is opened.

- Production application: `f7188859837c9ae93fcef47547e7eb657cb40456`, version 0.7.3, READY with verified production database health.
- [0.7.3 release notes](0.7.3.md), [checklist](0.7.3-checklist.md) and [validation](0.7.3-validation.md) record the exact tested scope, CI/builds, deployments and live forecasting/sales-exclusion acceptance.
- [Archived OpenDock lookup recovery](0.7.2-opendock-reliability.md) and earlier release records/tags remain preserved.
- Unrelated TST tasting features, migrations and maintenance remain excluded from main.

## Changes

- **User-visible:** split immediate demand into GPT | GRN (agency prefixes 1/3/5 → GPT, 2/4 → GRN), add warehouse case inventory and signed inventory-minus-demand. Inventory includes Quantity + Picked; GPTR/GRNR are excluded. Negative balances are red and labeled as shortfalls; positive excess includes a plus sign.
- **Dashboard:** entitled Echo Admins and Sales see all current product/warehouse shortfalls at the top of My Schedule. Product/detail/horizon/back preserve schedule context. No transfer is created or decided automatically. Main's existing schedule/authentication behavior is preserved; TST tasting features are excluded.
- **Data:** the native dated Power BI DC Inventory report uses existing credentials/browser infrastructure. Actual source business date, independent warehouse status and provenance are retained. Balance requires current verified demand and stock; missing/stale values remain unknown. Forecast model, planning targets and sales-product decisions are unchanged; 3150B stays EXCLUDED with no shared inventory rows.
- **Migration:** additive `20261110010000_production_warehouse_inventory`, checksum `72acb58b0a75e871aa6f290745403864212dc9b48db7309aa48b069eed753bda`, introduces two tenant-scoped observation/check tables. Guarded release operator and isolated production rehearsal are required. No unrelated migration, backfill, dependency graph, hosted configuration, provider account, credential or entitlement change.
- **Selection:** approved TST `8312df6b96b556943ca99d185455c5e1d5fccfb4`, application `4575e40950881e8882e176abe748df442ba9700e`, onto production `a1156b57ac7c902117fe2aa82717e63760234793`. Compare actual trees; exclude all unrelated TST work. See [plan](0.8.0-plan.md), [checklist](0.8.0-checklist.md) and [validation](0.8.0-validation.md).
- **Recovery:** rollback application code while retaining additive tables/evidence. Existing forecasting entitlement controls visibility. Never delete stored data as rollback.

## Entry template

- Description and user-visible behavior:
- Relevant TST commit(s):
- Validation and known limits:
- Migration, backfill, environment/configuration and feature flags:
- Release/recovery notes:
