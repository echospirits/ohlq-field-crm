# Wholesale order lifecycle checkpoint

Updated user scope 2026-09-10 recovery: finish current staging implementation only. DO NOT push/promote main. Primary agent owns planning/audit; implementation agents use Sol Medium or Terra Medium. Recovery request: C:\Users\joebl\.codex\attachments\9d1f8b70-23e2-44d6-a63a-2c5169c4695d\pasted-text.txt.

## Resumable milestones

1. PLAN: complete. Daily report semantics and exact quantity matching agreed.
2. PERSISTENCE: additive order schema, immutable PDF/input snapshots, retry-safe creation, tenant-scoped download/status services. Commit after verification.
3. UI: Accounts > Wholesale Orders, newest order-date first list, searchable customer selection, PDF Generated/Sent/Filed controls; filed orders in customer Activity. Commit after verification.
4. RECONCILIATION: hook every successful wholesale import (including historical dates); match customer permit, store, product quantities in inclusive order date..+7 days; ambiguous evidence stays open; transaction-safe single use of report evidence. Commit after verification.
5. AUDIT: primary agent reviews authorization, races, import replay, date edges, evidence reuse, PDF persistence and timeline; run meaningful tests/build and browser checks. Fix issues before releases.
6. STOP: provide staging implementation results, changed files, migration/checks, remaining issues and next steps before production promotion. No production migration or main push is authorized by the recovery request.

## Decisions and constraints

- Status values: PDF_GENERATED, SENT, FILED. Mark Sent is a user acknowledgment, never an email operation. Mark Filed records actor/time and MANUAL provenance. Automatic source AUTO_MATCH. Filed is terminal in this version. Do not label the action Complete.
- Order snapshots preserve original date, customer permit/name/address, store number/seller information, product codes/names/quantities/prices, invoice totals, and generated PDF. Downloading again does not create another order.
- Existing PDFs predating this change were not persisted and cannot be reconstructed as history.
- Report schema exposes quantities, no dollar amount. User explicitly approved exact per-product bottle quantity matching on 2026-09-10.
- Verified downloader sets From and To to the same reportDate. Use daily quantities, not cumulative deltas.
- Match all products on one report date, within inclusive sale date through sale date + 7 calendar days. Avoid fuzzy customer names or collapsing location-specific permit suffixes. No ambiguous subset allocation or evidence reused by multiple orders.
- Preserve tenant scope on every read/write/download and record actor/provenance for status changes. Manual and automatic completion must not race backward.
- Production migration history is unbaselined: apply only reviewed additive SQL with pre/postflight checks; do not run historical migrations blindly.
- Initial refs: staging/tst 72516397; origin/main bc29cbf8. Do not carry unrelated main changes during this staging-only recovery.
- Primary workspace has user-owned untracked .codex-worktrees/; leave it untouched.

## Progress / resume instructions

- Initial source inspection and remote refresh complete. No changes deployed for this lifecycle feature yet.
- CREDIT INTERRUPTION RECOVERY: all 3 agents errored out of credits. Restarted with followup tasks on recovery request. Existing uncommitted pieces: schema/migration, matcher draft, nav/test, form/styles, new customer picker. Missing persistence/API/list/detail/actions/import integration/activity/tests. Primary recovery assessment delivered before further code edits.
- Recovery checks so far: Prisma schema diff against HEAD baseline contains only WholesaleOrder + 2 enums + expected indexes/FKs; pure matcher test run passes 10/10 (node --import tsx --test --import ./tests/setup.ts tests/wholesaleOrderReconciliation.test.ts). Database adapter/import integration still being completed; not yet end-to-end validated.
- STAGING MIGRATION APPLIED: user explicitly approved staging migration and publication. Migration 33770179-caad-4c0a-b8fd-2ed914671356 applied successfully to dawn-frog-33352119 / br-divine-forest-avwq2b3g / neondb via reviewed SQL. Temporary branch br-fragrant-truth-ava7dja6 was deleted by completion tool. Postflight: 30 columns, 7 indexes, 0 orders. SQL matches prisma/migrations/20260910140000_wholesale_order_lifecycle/migration.sql exactly. Do not reapply. No production changes; Prisma migration history was not blindly deployed.
- Do not alter feature flag architecture or carry main opt-in correction as unrelated work in this recovery. Keep staging scope.
- Active build agents (Sol Medium): /root/order_persistence owns schema/service/API; /root/orders_ui owns pages/form/navigation/activity; /root/order_reconciliation owns matcher/import hooks/tests. Primary agent owns integration/audit/release.
- Live project identities verified: staging Neon dawn-frog-33352119 / br-divine-forest-avwq2b3g; production crimson-river-91402927 / br-solitary-lake-am9whrqb; database neondb. Vercel team team_iONC2HcvO7u5Nt0k3haV3gLS; staging project prj_fNOruLSh6BQNVXAThXYJEjBw2HYA; production prj_GaShdLZfAN7exFFw93FX0B66pqGn.
- Live report rows confirm Agency_Id is configured A3a store (90399/90285), Brand is item code, vendor Z90399001. Permit formats contain multiple suffix segments; preserve suffixes during matching.
- On resume: read this file, git status/log/remote refs and agent status before acting. Preserve completed milestones; do not duplicate migrations or pushes.
- Latest integration recovery: persistence/API, list/detail/actions, import hook and shared Activity integration now exist; all remain uncommitted and under audit. Agents restarted after a second credit interruption.
- First full-suite check: 291/292 passed; remaining importer mock assertion is being corrected. Initial typecheck found PDF byte generic and optional test input errors; fixes in progress. Prisma validation passed. Full build and browser validation remain pending.
- Audit fixes requested: date-only rendering must use UTC date-only formatter (not Eastern timestamp formatter); list reads exclude PDF bytes; All status filter resets; Filed filtering occurs before Activity query limit; manual filing allowed from either open status; PDF line prices normalized to cents. Service-level tenant/idempotency/status and adapter tests are being expanded.
- Integrated checks: 304/304 full tests passed; typecheck and Prisma validation passed. Build passed with explicit offline development env and localhost dummy DATABASE_URL (first bare build stopped on missing DATABASE_ENVIRONMENT, no source failure). Final audit fixes above landed; last reconciliation fix rejects incomplete wholesale imports before any writes so partial retained rows cannot be reused later. Rerun focused checks after this fix, then commit/push staging only and verify deployment/browser.
