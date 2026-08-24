# Neat multi-tenant architecture

## Tenant boundary

`Organization` is the customer boundary. A normal user belongs to one organization through `User.organizationId`; organization-owned records carry the same identifier. Shared Ohio reference data—agencies, official wholesale accounts, OHLQ catalog, raw sales, and raw inventory—remains platform-level. Private activity and interpretation—visits, worklist items, contacts, tags, opportunities, intelligence, product decisions, and account overlays—are organization-scoped.

Server code resolves the active organization with `requireOrganizationContext()`. Normal users receive only their assigned active organization. Suspended and cancelled organizations retain data but cannot enter the normal application. A platform administrator has no implicit customer context and must explicitly enter Support View. Pages and mutations must include `organizationId` in private-record reads before updating by primary key.

The Phase 1 rollout uses nullable tenant columns solely to permit a non-destructive backfill of the existing database. `npm run bootstrap:multitenancy` creates Echo, assigns existing rows, and initializes a platform administrator. Application writes always populate organization ownership. A follow-up migration may make these columns non-null after production readback confirms no legacy null rows.

## Roles and support view

- `PLATFORM_ADMIN` provisions and supports customers across the Neat platform.
- `ADMIN` manages users and allowed settings only inside one organization.
- `USER` and `TASTER` retain their existing organization-scoped workflows.

Support View stores the selected organization in an HTTP-only, same-site cookie for at most eight hours. Only `PLATFORM_ADMIN` can set it. The application renders a persistent yellow banner, provides an explicit exit action, and records entry and exit in `OrganizationAuditEvent`. Support View changes organization context; it does not silently impersonate a customer user.

## Entitlements

`lib/featureRegistry.ts` is the single feature-key registry. `OrganizationFeature` contains organization overrides and is compatible with a later `Plan -> Features` mapping. Dependencies are validated when provisioning or editing entitlements. UI navigation uses the same keys as server guards.

`WHOLESALE_OPPORTUNITIES` is independently gated. Disabled organizations do not see its navigation or account panels, and direct access to its page and actions returns the application not-found boundary. `AGENCY_INTELLIGENCE` uses the same server-side pattern. Weekly digest recipients are selected only from active organizations with `WEEKLY_DIGEST` enabled; platform administrators never receive customer digests automatically.

## Ohio configuration and onboarding

An organization can have multiple `OrganizationVendorIdentifier` rows. Product discovery uses the `OhioOhlqProvider` seam and shared current OHLQ inventory. Results become `OrganizationProduct` decisions (`OWNED`, `EXCLUDED`, or `REPRESENTED`) without duplicating the shared catalog. Echo is configured as a normal organization with Vendor ID `Z90399001`, legacy exclusions `3150B`, `3750B`, and `4359B`, and all current features enabled.

Provisioning creates identity, initial admin invitation, Vendor IDs, discovered products, entitlements, onboarding state, and audit events in one workflow. Invitations use the existing hashed, 72-hour, single-use token flow; the platform never accepts or generates an admin password.

`OrganizationAccountOverlay` stores customer-specific strategy for a shared Agency or Wholesale Account: assignment, target/relationship status, priority, notes, tags, custom name, suppression, and strategy.

## Jobs and data providers

OHLQ acquisition remains platform-level. Tenant-derived opportunity, intelligence, digest, worklist, and calendar processing must enumerate active entitled organizations and write their organization identifier. `MarketDataProvider` is intentionally small; Ohio is the only implementation and Ohio-only concepts remain explicit.

The transition keeps the existing Ohio intelligence algorithms intact for Echo while tenant-aware derived-state storage is introduced. New derived jobs must never fall back to environment-only Echo configuration; they should load `OrganizationVendorIdentifier` and `OrganizationProduct` for the organization being processed.

## Operations

Staging rollout order:

1. Apply the additive Prisma schema to the `tst` database.
2. Run `npm run bootstrap:multitenancy` against that database.
3. Read back Echo, Vendor ID, entitlements, owned-row counts, and the selected platform administrator.
4. Deploy the matching `tst` commit and verify `/login`, `/platform`, and a guarded module.

Do not deploy application code before the additive schema. Do not remove shared OHLQ data or run destructive migrations. Billing, self-service signup, checkout, other states, and cross-tenant benchmarking are deliberately outside Phase 1.
