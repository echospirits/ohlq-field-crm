# Unreleased

No unreleased feature work remains after the owner-approved **0.7.2** Wholesale Orders production hotfix. Development remains frozen; no new development cycle is opened.

- Production application: `12c1d995114203609bb92f833449138ec22bd52c`, version 0.7.2, READY with correct production database health. All six reviewed unfiled orders are now AUTO_MATCH Filed; replay filed zero additional orders.
- [0.7.2 release notes](0.7.2.md), [checklist](0.7.2-checklist.md) and [validation](0.7.2-validation.md) record exact-candidate CI/tests/build, deployment, guarded live recovery, preservation evidence and the remotely verified production tag. Signed-in production UI acceptance remains explicitly unverified; the TST closeout receipt is tracked there.
- Historical [0.7.0 release records](0.7.0.md) and earlier tags/records remain preserved. Unrelated TST maintenance was excluded from production.
- Sent/Paid, original order snapshots/PDFs and four manual filing records are preserved. The owner-confirmed Antiques report permit was added as a non-primary alias; no schema/migration, dependency graph, hosted environment, feature flag or provider configuration changed. Unrelated production/TST differences remain preserved.

## Changes

### OpenDock lookup recovery — November 9, 2026

- Owner-authorized TST and main reliability correction, retaining version 0.7.2. Temporary OpenDock lookup failures produce visible warnings after safe persistence, preserve prior observations and permit independent imports to complete. Authentication, malformed-response and persistence failures remain errors.
- Bounded retries honor Retry-After; CI retains safe diagnostic codes for recurring interruptions. No schema, dependency, hosted/provider configuration or UI change. Unrelated TST work remains excluded from production.
- [Scope, validation and delivery](0.7.2-opendock-reliability.md).

## Entry template

- Description and user-visible behavior:
- Relevant TST commit(s):
- Validation and known limits:
- Migration, backfill, environment/configuration and feature flags:
- Release/recovery notes:
