# Unreleased

Stable **0.7.0** is in owner-authorized release preparation. On November 4, 2026, the owner approved the TST interface and requested main promotion. This manifest describes the selective UI upgrade; exact-candidate validation and production delivery are pending until recorded. No new development cycle is opened.

- [0.7.0 release notes and technical manifest](0.7.0.md)
- [0.7.0 release checklist](0.7.0-checklist.md)
- [0.7.0 validation](0.7.0-validation.md)
- [0.6.0 release notes](0.6.0.md)
- [Operational Signals production promotion record](production-operational-signals-promotion.md)

## Changes

### 0.7.0 - Echo-informed working interface

- Approved source: TST application `a9d850380e90caceebc3f3376d4e294b293216a3`, reviewed at TST receipt `071eb21f47ca1e4fb3e45939c1e97f15094906a9`. Production base: `4f39e5b89703373c6730d2d590e3262da93c6648`.
- Shared visual system: Copper/Patina accents, Chalkboard navigation/text, neutral working surfaces, readable type, compact headings/toolbars, modest radii and aligned numbers in light and dark themes. Existing Echo organization color data is retained; shared CSS owns the approved product palette.
- Browsing and visibility: semantic comparison tables for Pipeline, intelligence and forecasts; useful directory columns, next commitments, saved account profile/plan facts, task context and actionable sync/source failures remain visible. Infrequent editing/setup actions stay secondary.
- Daily work: visible scheduled events and overdue work, record-first Tags/Users, retained visit account/contact context, read-before-edit event details and compact global Visit History comparison alongside existing account timelines.
- Analytics/admin: compact metrics and operational summaries, visible purchasing continuity/relationship/source-health facts and shorter labels. Material warnings, source limits and recovery guidance remain visible.
- Presentation fixes: Pipeline shows the earliest open commitment, including overdue/undated work, while retaining existing future-only attention inputs. Missing purchase evidence reads `No recorded purchase`. Paused calendar sync is neutral; actual errors stay alerts. History Clear filters resets all picker/date state.
- No schema/migration/backfill, dependency, provider, credential, scheduled workflow, entitlement or hosted environment-setting change. Existing queries, actions, forecast calculations, tenant/state/role checks, idempotency, history and calendar effects remain intact.
- Preserve production-specific OpenDock timing/help. Main already contains Operational Signals; its provider/schema/workflow changes are not introduced by this UI release.
- Exclude unrelated TST test pruning, `test:focus`, scratch TypeScript exclusions, CI differences and test/developer-tooling documentation. Main's existing test coverage/tooling is retained, with only UI-related regression changes.
- Scope and evidence: [application UI audit](../design/neat-tst-ui-audit-2026-11-04.md), [release plan](0.7.0-plan.md) and [validation](0.7.0-validation.md). Earlier TST test totals or a Vercel build do not replace exact stable-candidate gates.

## Historical production manifest

The following 0.6.0 entry is preserved from production for provenance. It is already deployed, not additional scope introduced by the 0.7.0 UI promotion. Its queued-ingestion status is historical evidence, not a refreshed status claim.

### Preserved 0.6.0 Operational Signals manifest

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
