# Unreleased

Owner-approved patch **0.7.1** is frozen for selective production promotion of the focused quality-of-life fixes. No new development cycle is opened. See [0.7.1 notes](0.7.1.md), [checklist](0.7.1-checklist.md) and [validation](0.7.1-validation.md). Stable 0.7.0 release records and tag remain preserved.

- Production application: `5023578de6bfda370ea547af7b1cb5494bbdfe70`.
- Stable TST application: `214e0fe0cfb7d3184416408ea400ab0a023f7951`.
- Both deployments are READY; health verifies `production / ohlq-field-crm / connected` and `test / neon-neat-tst / connected` respectively.
- Historical [0.6.0 release notes](0.6.0.md) and [Operational Signals production promotion](production-operational-signals-promotion.md) remain preserved.

## Changes

Quality-of-life fixes approved from TST: optional post-Visit Worklist completion, removed Opportunity interruption, Ohio Agency identifier placement, aligned overdue lists, organization inventory on Agency Overview and latest-Visit/configured-fallback Reactivation ownership. Complete technical/configuration/recovery manifest: [0.7.1 release notes](0.7.1.md). No schema migration, dependency or entitlement change; production fallback uses James's own verified production user ID.

## Entry template

- Description and user-visible behavior:
- Relevant TST commit(s):
- Validation and known limits:
- Migration, backfill, environment/configuration and feature flags:
- Release/recovery notes:
