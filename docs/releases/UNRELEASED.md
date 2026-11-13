# Unreleased

## Current stable release

No unreleased production application changes. Stable **0.10.1** selectively releases the authorized Production Supplies reliability hotfix at application `b75da7a2987d6bb95c71fde16b77cad5ae01d068`. Confirmed Production orders can open cards; material matching, decorative-image filtering, immutable attachment identity and durable 15-minute importing are corrected. The bounded audited production correction is committed, preserving source history, inventory, receipts and mailbox state. See [release notes](0.10.1.md), [validation](0.10.1-validation.md) and [checklist](0.10.1-checklist.md) for exact tested/deployed refs and runtime evidence.

Historical **0.10.0** remains archived in [release notes](0.10.0.md), [checklist](0.10.0-checklist.md) and [validation](0.10.0-validation.md), with [v0.10.0](https://github.com/echospirits/ohlq-field-crm/releases/tag/v0.10.0) at verified application `3503020a33b9f20778d26b4ee51685875304b343`.

## Post-release production configuration

The owner separately approved and enabled Echo's Production Supplies entitlement/team, dedicated production OAuth/encryption/job secrets, Joe's own read-only Gmail consent and the 15-minute job. Initial real ingestion and mobile/desktop access pass. The [activation record](production-supplies-production-activation.md) preserves exact deployment, worker and data receipts and distinguishes bounded backfill from completed history. Karl and Nikhil each still need their own consent. Paid tracking remains disabled; no TST credentials/private data or new accounts were transferred.

The original activation record is historical configuration against 0.10.0. The 0.10.1 hotfix reuses those existing credentials and consent; no new hosted configuration, migration, account or paid tracking was added. Historical backfill remains incomplete. Unrelated TST Tasting Management and concurrent Social Publishing remain in TST, outside this production release.

Development remains frozen. Open the next development cycle deliberately; preserve all historical refs and the concurrent TST state.
