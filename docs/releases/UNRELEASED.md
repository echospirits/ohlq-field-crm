# Unreleased

## 0.10.0 release candidate — Production Supplies

Owner-approved November 12, 2026. Selectively promote this chat's accepted TST application 7cff2fdc5606efe868a3aa2341a124187516a280 onto production e2a19c9b45c7bbcbccdbbbf061879a00a43b7718. Preserve main's existing behavior and tests; exclude earlier TST Tasting Management and later concurrent Social Publishing.

- Simple Supplies status cards only for Dx5-alerted materials; one material/location per replenishment cycle, durable dismissal, automatic completed-delivery hiding, and no tabs/history/manual editors. Dx5 owns inventory planning; Ollie remains a future seam.
- Production menu groups Supplies and Forecasting on desktop/mobile, retaining original routes, feature gating and role access.
- Tenant/team permissions, read-only Gmail ingestion, authenticated provider provenance, durable bounded replay and scoped parcel tracking. Production activation and each owner's consent remain separate from code delivery; never copy TST tokens, encryption keys or private test data.
- Additive migration 20261112010000_production_supplies creates 19 normalized tables. Apply only its reviewed checksum after a production-derived rehearsal, without replaying unrelated migration gaps.
- Production uses independently gated scheduling and credentials. Tracking stays disabled without approved provider credentials/fees. No new account, paid subscription, supplier message, purchase, receipt or inventory/accounting transaction is authorized by this release.

See [release notes](0.10.0.md), [checklist](0.10.0-checklist.md) and [validation](0.10.0-validation.md). Previous stable release [0.9.2](0.9.2.md) and all historical refs remain preserved. No unrelated development cycle is opened.
