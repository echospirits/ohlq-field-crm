# Database migrations

Production Supplies adds `20261112010000_production_supplies` with 19 normalized tables and composite tenant relations. The guarded `scripts/production-supplies-setup.ts` accepts only explicitly identified rehearsal/TST targets and a reviewed normalized-SQL checksum. Its isolated rehearsal passes 20 persisted scenarios; seven additional owner-reviewed invoice checks pass. Shared-TST application and Echo activation completed after explicit owner approval, with matching migration checksum. No existing records or historical migration ledger entries are removed. See [validation](../releases/production-supplies-validation.md).

Audit baseline: TST `5faee9df930bd76b5e56b669f58a57210527f7d5`, inspected 2026-10-10.

Prefer additive schema changes with compatible defaults and indexes. Preserve all legacy records. Generate/review migration SQL, validate schema, rehearse in a disposable database, then apply only the requested migration to verified TST. Never reset shared databases or silently reconcile unrelated migration drift. Production requires rotation of the reported compromised credential and separate release approval. On 2026-10-19 the owner confirmed that rotation was already completed and explicitly authorized the 0.2.3 production release. This is owner confirmation; this release did not rotate or independently verify the secret.

## Implementation references

- `prisma/migrations`
- `scripts/prisma-environment-command.ts`
- `docs/environment-isolation.md`

## Validation and remaining work

See [implementation progress](../engineering/implementation-progress.md), [feature inventory](../product/feature-inventory.md), and [test report](../releases/v0.2-test-report.md). Existing behavior above is source-audited; it is not a claim of fresh live verification. Changes must update this document and the inventory.

## CRM migration

Follow the [exact migration runbook](crm-migration-runbook.md). TST legacy activity rows were fingerprinted before/after the additive migration; no new connection/deal row is seeded automatically. Only the named migration is registered; the pre-existing password-reset ledger gap is not repaired.

## Production Forecasting pilot

`20261028010000_production_forecasting` adds tenant-owned source/demand/guidance/run/snapshot tables, composite tenant/source/product keys, quantity/date checks, indexes and explicit Echo pilot enrollment. Apply only this reviewed migration using the target/checksum-guarded `scripts/production-forecasting.ts`; no historical ledger reconciliation. See [validation](../releases/production-forecasting-validation.md) and [operations](../production-forecasting.md).
