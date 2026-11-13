# Unreleased

## Authorized 0.10.1 Production Supplies hotfix

- Confirmed Production replenishment orders can open status cards without a Dx5 warning; quotes, supplier identity alone and unrelated purchases cannot.
- Separate reliable material-order matching from strict completed-delivery proof. Unknown warning location can no longer obscure an otherwise identified non-shared material order; known destination conflicts still prevent association.
- Extract current authored mail once, ignore decorative inline/signature images as independent evidence and preserve meaningful invoice attachments, thread provenance and resumable checkpoints.
- Preserve payment plans and conditional supplier promises separately from shipment and arrival evidence. Keep the card-and-Dismiss interface and source label honest.
- Move the primary 15-minute cadence to the existing durable Workflow runtime with tenant singleton/lease fencing, bounded catch-up and recovery triggers. No new dependency, schema migration, account or paid tracking.
- Rehearse a bounded, audited correction of existing bottle artifacts and confirmed Panela evidence before production; retain source/history records and existing dismissals.

Exact production base: `a2991375db7bc213a3b2734d67827f8f08496a3c`. Verified initial TST baseline: `ddecb2c5f162b0f190e0802fd144fb99e72abf3f`. Unrelated TST pilots remain excluded. See [plan and validation](0.10.1-validation.md) and [checklist](0.10.1-checklist.md). Candidate checks and hosted activation are pending.

## Previous stable release

No unreleased production application changes. Stable **0.10.0** is archived in [release notes](0.10.0.md), [checklist](0.10.0-checklist.md) and [validation](0.10.0-validation.md), with [v0.10.0](https://github.com/echospirits/ohlq-field-crm/releases/tag/v0.10.0) at verified application `3503020a33b9f20778d26b4ee51685875304b343`.

## Post-release production configuration

The owner separately approved and enabled Echo's Production Supplies entitlement/team, dedicated production OAuth/encryption/job secrets, Joe's own read-only Gmail consent and the 15-minute job. Initial real ingestion and mobile/desktop access pass. The [activation record](production-supplies-production-activation.md) preserves exact deployment, worker and data receipts and distinguishes bounded backfill from completed history. Karl and Nikhil each still need their own consent. Paid tracking remains disabled; no TST credentials/private data or new accounts were transferred.

These changes are operational configuration and documentation against released 0.10.0, with no application or migration change. Unrelated TST Tasting Management and concurrent Social Publishing remain in TST, outside this production release.

Development remains frozen. Open the next development cycle deliberately; preserve all historical refs and the concurrent TST state.
