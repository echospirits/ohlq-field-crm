# Unreleased

## OHLQ notifications after recovery — November 19, 2026

Delivered to main **0.10.2** (`393ea583`) and TST **0.10.0-dev** (`6c64e4e9`) under the owner's hotfix authorization, with both versions retained. Group the daily report dates into one load, retry temporary setup/download/database transport failures within safe read or fixed-value status boundaries, and require a separate read-only persisted-data verification job. A failed attempt with independently verified current data is a warning; missing, incomplete or unverifiable required data still fails after bounded checks. Both deployments are READY/healthy; full suites, strict typechecks/builds, exact Node 22 CI, outcome fixtures and real loads pass. Production verification passed all 17 checks and TST all 21, with zero issues or warnings. Preserve typed optional lookup/stale-publication warnings, the paused TST daily schedules, and existing focused maintenance behavior. No schema/dependency/version, hosted secret, notification preference or UI changes. See [scope and validation](ohlq-outcome-notifications-2026-11-19.md).

## Scheduled-job usage controls — November 17, 2026

Production **0.10.2 deployed**, application `7437cb7d`; TST companion `3227bed2` stays at 0.10.0-dev. Both are READY/healthy and all local/required CI checks pass. Supplies is configured for four automatic batches/watchdogs per day; TST Supplies, daily OHLQ schedules and retail/wholesale account research are disabled. Vercel Workflow quota currently returns `ThrottleError`: the new production timer is persisted but STARTING; old-run cancellation was rejected, so a completed handoff, executed six-hour cycle and provider freshness are not claimed. The annotated release tag exists locally and is not published remotely. Unrelated TST work remains excluded. See [release notes](0.10.2.md), [checklist](0.10.2-checklist.md), [validation](0.10.2-validation.md) and [scope/timing](scheduled-job-usage-2026-11-17.md).

## OHLQ runner compatibility recovery — November 15, 2026

Pin the four existing Playwright ingestion/verification workflows to Ubuntu 24.04 after Ubuntu 26.04 browser installation failures. Keep production version 0.10.1 and preserve all application/dependency/schema/configuration files and unrelated TST pilots. Verify TST before selective promotion and recover missing report dates. [Scope and validation](ohlq-runner-compatibility-2026-11-15.md).

## Current stable release

Deployed **0.10.2** contains the scoped usage controls above; runtime acceptance is limited by Workflow quota and its remote tag is pending. Historical stable **0.10.1** selectively released the authorized Production Supplies reliability hotfix at application `b75da7a2987d6bb95c71fde16b77cad5ae01d068`. Confirmed Production orders can open cards; material matching, decorative-image filtering and immutable attachment identity were corrected. Its historical 15-minute cadence is superseded by 0.10.2's six-hour configuration. The bounded audited production correction is preserved with source history, inventory, receipts and mailbox state. See [historical release notes](0.10.1.md), [validation](0.10.1-validation.md) and [checklist](0.10.1-checklist.md).

Historical **0.10.0** remains archived in [release notes](0.10.0.md), [checklist](0.10.0-checklist.md) and [validation](0.10.0-validation.md), with [v0.10.0](https://github.com/echospirits/ohlq-field-crm/releases/tag/v0.10.0) at verified application `3503020a33b9f20778d26b4ee51685875304b343`.

## Post-release production configuration

The owner separately approved and enabled Echo's Production Supplies entitlement/team, dedicated production OAuth/encryption/job secrets, Joe's own read-only Gmail consent and the 15-minute job. Initial real ingestion and mobile/desktop access pass. The [activation record](production-supplies-production-activation.md) preserves exact deployment, worker and data receipts and distinguishes bounded backfill from completed history. Karl and Nikhil each still need their own consent. Paid tracking remains disabled; no TST credentials/private data or new accounts were transferred.

The original activation record is historical configuration against 0.10.0. The 0.10.1 hotfix reuses those existing credentials and consent; no new hosted configuration, migration, account or paid tracking was added. Historical backfill remains incomplete. Unrelated TST Tasting Management and concurrent Social Publishing remain in TST, outside this production release.

Development remains frozen. Open the next development cycle deliberately; preserve all historical refs and the concurrent TST state.
