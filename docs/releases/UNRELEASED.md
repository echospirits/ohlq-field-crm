# Unreleased

The owner explicitly authorized the scoped automatic Production Forecasting refresh and delivery to TST and main on November 10, 2026. Stable **0.9.0** is the selective production candidate; promotion and live release verification are pending. Production remains released **0.8.0**, application `3a21899c523c52c226b8ee3d905abbbe057504d5`, until those gates pass.

- [Release notes](0.8.0.md), [completed checklist](0.8.0-checklist.md) and [validation](0.8.0-validation.md). Verified release [v0.8.0](https://github.com/echospirits/ohlq-field-crm/releases/tag/v0.8.0) points to the exact production application and is marked Latest.
- Unrelated TST Tasting Management features, migrations and maintenance remain excluded from production. Historical release records and tags remain preserved.

## Automatic Production Forecasting refresh

- **Behavior:** replace the normal source-upload section with an Admin/platform Admin refresh button. A dedicated background run downloads complete outbound case history and distribution-center guidance, saves forecasts and fills missing daily operational observations. Search and horizon remain in place. Sales keeps its existing read-only access.
- **Request state:** persist tenant-scoped queued/running/succeeded/partial/failed/timed-out history. Coalesce duplicate clicks, recheck administrator and feature access before execution, fence worker leases and recover expired requests. Dispatch acknowledgement alone never means source data is fresh.
- **Existing data:** preserve real source/report/retrieval dates and current immutable daily warehouse/demand observations. No annual-sales import, shared-inventory import, product-policy change, credential repair or provider-account change. The statistical model and 3150B sales exclusion remain unchanged.
- **Schema:** additive `20261110020000_production_forecast_refresh_requests` adds one request table and its tenant/requester constraints. A conditional compatible User organization/id identity index supports the requester foreign key on main; it does not include the unrelated TST tasting migration. No backfill or destructive SQL.
- **Configuration:** reuse the existing dispatch credential with a fixed forecast-only workflow and strict environment/repository/ref guards. Missing or unsafe configuration disables the button with a clear explanation. The broad-import side-effect flag is not enabled for this feature. No dependency graph, entitlement or unrelated hosted-configuration change.
- **Baselines and scope:** main `844cbf9539ff681b9857242248ef0d9762c604b1`; TST development base `a9706f50af4f093c530e9ecc7f5735a891124b23`. Main package scripts, lockfile graph and test tooling are preserved. Exact tested candidate, TST delivery, CI, migration, browser and deployment receipts remain pending in [validation](0.9.0-validation.md).
- [Release plan](0.9.0-plan.md), [pending checklist](0.9.0-checklist.md). Rollback may revert the application while retaining additive request history and all existing source facts. Do not delete request/source records or modify unrelated migration history.

## Entry template

- Description and user-visible behavior:
- Relevant TST commit(s):
- Validation and known limits:
- Migration, backfill, environment/configuration and feature flags:
- Release/recovery notes:
