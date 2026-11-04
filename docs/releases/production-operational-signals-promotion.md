# Production Forecasting - Operational Signals promotion

Owner request: push all changes from this chat to main. This explicitly supersedes the earlier TST-only boundary for this feature. Retain version0.6.0 and the earlier no-new-tag/no-new-development-cycle constraints. Historical `v0.6.0` is preserved.

## Exact scope

- Production base: `e08aa5a8c7a1e5a59a17097eb372ec42582eb373`.
- Tested TST source: `ef41fe8fb5810dd52cadfecab09dd4d8d995a829`; only chat changes from `983a5fd8`, `f531efed`, `13ed8a25`, `ef41fe8f` are promoted.
- Runtime/Prisma/workflow/dependency-lock foundations at sourcebase `5c391f0a` and productionbase are identical. Preserve main's existing tests, package scripts, TypeScript configuration and historical release records; unrelated TST test pruning/tooling stays excluded.
- One production adaptation removes TST-specific timing from settings help; actual schedules remain unchanged (production6:47 AM Eastern, TST7:27 AM Eastern).
- Forecast engine/model/service and package/lock versions remain unchanged. Separate operational observations cannot change forecast values.

## Validation gates

- [ ] Exact candidate Node22/npm10 GitHub **Validate dependency lockfile** run.
- [x] Full production-source suite:1018 tests,75 suites,0 failures/skips; typecheck passed. Main's existing tests/tooling remain intact.
- [ ] Production-candidate build and final diff check.
- [x] TST live source acceptance: OPS16 valid observations/17 checks,95 total replenishment cases;2806B GPT10/GRN0 and agency30221 contributes3. Source-ineligible A3A Dist has no demand amount.
- [x] TST live OpenDock API/calendar agreement: November4 05:27 Eastern, GPT November10 06:00 EST (6calendar days), GRN November6 06:00 EST (2calendar days); repeat action reuses one daily fact per warehouse.
- [x] TST authenticated desktop/mobile acceptance, failure/empty/stale states, tenant/credential isolation tests; prior990 tests/typecheck/build passed. Production candidate is independently validated above.
- [x] Verified production-only migration/ledger and retained forecasts. PostgreSQL17 isolated rehearsal passed9 real constraints. Shared production applied only the exact migration; ledger29→30, five empty new tables, all377 forecast full rows unchanged, prior29 ledger records/settings/OPS credentials unchanged. Health remained200/connected.
- [ ] Main push and READY production deployment/health/affected-route checks.

## Production data and configuration

- Vercel `ohlq-field-crm` / `prj_GaShdLZfAN7exFFw93FX0B66pqGn`; health `production / ohlq-field-crm / connected`.
- Neon `crimson-river-91402927` / `br-solitary-lake-am9whrqb` / `neondb`, direct host `ep-proud-recipe-amosj8m9.c-5.us-east-1.aws.neon.tech`, PostgreSQL17.
- Apply only `20261104010000_production_operational_signals`, SHA256 `2dfe95d1043d6d8e0a6d057f564f34479c742fb7f7ec6deb5809e34b5b0d90c9`. Five additive tables; no forecast/data backfill. Production starts with29 ledger entries; preserve unrelated historical gaps.
- Baseline377 production forecast snapshots, SHA256 `4495d4282b178c9991f878b33d3eac1c5b344eac157d0fdcecd31fdaeac9ef03`. Compare after migration. Routine future scheduled forecasts may add snapshots normally.
- Isolated rehearsal: `br-empty-dream-amif69aq`. Shared production migration passed after rehearsal; sanitized local receipt `output/operational-production-migration.json` in the TST implementation worktree. No unrelated ledger gap was replayed; no settings or credentials were copied/changed.
- Existing sensitive production OHLQ encryption key remains unchanged; no dedicated key configured. No TST credential/config/history transfer. Independent production OpenDock setup is required; unavailable setup is never zero availability/demand.
- Existing Echo/OH Production Forecasting pilot entitlement remains unchanged. Administrator setup/check and all reads/jobs retain tenant/feature guards.

## Delivery status

Promotion validation is in progress. Record final candidate/main SHA, migration rehearsal/application evidence, GitHub CI run, deployment/health and activation limits here before closing delivery. No release tag is created.
