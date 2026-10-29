# Unreleased

Neat **0.4.2** is the owner-approved forecast download hotfix, based on released 0.4.1 at `bf6e3667`. The separate 0.5.0-dev field-workspace changes remain in TST and require their own production authorization.

## Changes

- Bailment PO and Invoice now selects the report's actual **From** and **To** date controls and verifies the selected dates. Existing sales report labels remain supported.
- Partner DC waits for the source table's count and rows to load before exporting; incomplete, empty and filtered exports still fail validation.
- Source changes match tested TST `93a160dc7f3ce458a09164c08b80f12c8a1dd80b`. Live TST run [40809092919](https://github.com/echospirits/neat-tst/actions/runs/40809092919) downloaded and validated both native sources, with no database writes.
- One release-only workflow runs the existing forecast source import/refresh under the production OHLQ concurrency lock. It requires the production repository, main ref, exact release message, version and database target. The existing recurring schedule remains unchanged.
- No schema, migration, dependency, tenant entitlement, credential or hosted configuration changes. Prior source evidence and failed attempts remain retained. Distillery-only and delisted dashboard exclusions remain unchanged.
- See [0.4.2 validation](0.4.2-validation.md) and [checklist](0.4.2-checklist.md) for release gates and receipts.

## Entry template

- Description and user-visible behavior:
- Relevant TST commit(s):
- Validation and known limits:
- Migration, backfill, environment/configuration and feature flags:
- Release/recovery notes:
