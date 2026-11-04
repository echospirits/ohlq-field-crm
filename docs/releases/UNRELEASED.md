# Unreleased

Version **0.6.0** is released to TST and main. Production deployment, exact source-line exclusion, retained-history checks and live forecasting smoke tests are verified. Application commit `c5dcf07b8cc775488a3be9b69766e748bad3fb6f` is tagged `v0.6.0`. Development remains frozen; no new version or feature cycle is opened.

- [0.6.0 release notes and technical manifest](0.6.0.md)
- [0.6.0 completed checklist](0.6.0-checklist.md)
- [0.6.0 validation](0.6.0-validation.md)
- [Source-line exclusion validation](production-invoice-exclusion-validation.md)
- [0.5.2 release notes and validation](0.5.2.md)

## Changes

### Production Forecasting - Operational Signals

- User-visible: **Yes**. Owner-authorized selective promotion of this chat's TST changes to main under existing version `0.6.0`; no new cycle or release tag. Historical `v0.6.0` remains unchanged.
- Production status: application `c94f5c3ef6f35e74f46648445571ba970136ecb0` is READY on `crm.echospirits.com`; health verifies `production / ohlq-field-crm / connected`. Exact-candidate Node22/npm10 CI,1018 tests,typecheck,build and scoped migration checks passed. Owner independently configured production OpenDock; November4 08:12 EST API observations match native LTL calendars (GPT November10 06:00,6days; GRN November9 06:00,5days). Authenticated desktop/tablet/mobile dashboard/detail review passed. Initial production OPS demand ingestion remains pending; existing morning jobs started from pre-feature code.
- Bootstrap: focused production source run41838469464/#686 was queued at08:28 EST on main7484454, behind existing production job#685. It uses normal source imports/forecast refresh and the new operational hook; no key repair/settings changes. Until actual ingestion succeeds, missing demand remains unavailable. See the promotion record for exact inputs and run link.
- Add independent daily OpenDock GPT/GRN LTL delivery availability, raw appointment dates, historical calendar-day lead times and deterministic seasonal/nearby-period/trailing comparison. Sparse history remains insufficient; failed checks retain the last good observation.
- Add OPS Products Item Coverage replenishment estimates: only MIN agencies, whole cases to reach MIN rounded per agency, Organization product mappings and verified agency-prefix warehouse totals. A-3a Dist remains excluded; same-day shipment/receipt lag is disclosed. Demand is never added to 30/60/90-day statistical forecasts or planning targets.
- Dashboard/product detail show independent freshness, current demand, warehouse availability and lightweight histories. Views read Neat's database. The existing production morning source workflow starts6:47 AM Eastern (TST7:27); observations follow preceding imports.
- Migration: only `20261104010000_production_operational_signals`, five additive tenant-scoped credential/observation/check tables. No backfill, destructive SQL, entitlement change or forecast mutation. Preserve existing ledger gaps; do not replay unrelated TST migrations.
- Configuration: existing production OHLQ encryption key is retained. No TST ciphertext, settings or observation data is copied. An authorized production administrator must independently save/verify the OpenDock account and then check availability. Missing setup remains explicitly unconfigured. A future dedicated-key switch requires coordinated credential migration; do not change the preferred key on existing ciphertext alone.
- Validation/source proof and production target/migration/deployment state: [promotion record](production-operational-signals-promotion.md), [integration guide](../production-operational-signals.md), [checkpoint](../../production-operational-signals-checkpoint.md).

The previously released cumulative forecasts and exact invoice exclusion remain archived in [0.6.0](0.6.0.md).

No unrelated TST maintenance was promoted. Test pruning, `test:focus`, scratch TypeScript exclusions and test/developer-documentation changes remain TST-only. Production retains main's existing coverage and tooling.

## Entry template

- Description and user-visible behavior:
- Relevant TST commit(s):
- Validation and known limits:
- Migration, backfill, environment/configuration and feature flags:
- Release/recovery notes:
