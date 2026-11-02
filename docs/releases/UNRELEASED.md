# Unreleased

Version **0.5.0** is released. Development is frozen; no new development version or feature cycle is opened.

- [0.5.0 release notes](0.5.0.md)
- [Completed release checklist](0.5.0-checklist.md)
- [Release validation](0.5.0-validation.md)

## Changes

### OHLQ stale-source warnings (November 2, 2026)

- Valid older Account/Brand Master publications skip importing with a GitHub warning and persistent Warning status. Last successful data and timestamps remain intact. Missing, malformed or future dates, authentication, download, parsing and database errors still fail.
- Data Status displays new warnings and precisely matched historical stale-master errors as Warning, retaining original audit records. Product discovery does not run after a skipped Brand Master import.
- Additive migration `20261102140000_ohlq_warning_status` adds the WARNING enum value only. Apply before deploying the updated Prisma client or running the workflow. No data deletion, provider/hosted configuration change or dependency upgrade.
- The owner explicitly approved selective production promotion on November 2. Version remains 0.5.0 and development remains frozen. Unrelated TST test/tooling maintenance is excluded.
- Validation and incident evidence: [OHLQ warning correction](0.5.0-ohlq-warnings.md).

## Entry template

- Description and user-visible behavior:
- Relevant TST commit(s):
- Validation and known limits:
- Migration, backfill, environment/configuration and feature flags:
- Release/recovery notes:
