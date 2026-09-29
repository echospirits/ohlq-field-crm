# Wholesale order lifecycle checkpoint

Updated user scope 2026-09-10 recovery: finish current staging implementation only. DO NOT push/promote main. Primary agent owns planning/audit; implementation agents use Sol Medium or Terra Medium. Recovery request: C:\Users\joebl\.codex\attachments\9d1f8b70-23e2-44d6-a63a-2c5169c4695d\pasted-text.txt.

## Resumable milestones

1. PLAN: complete. Daily report semantics and exact quantity matching agreed.
2. PERSISTENCE: complete. Additive schema, saved PDF/input snapshots, retry-safe creation, tenant-scoped download/status services.
3. UI: complete. Accounts > Wholesale Orders, newest order-date first list, searchable customer selection, PDF Generated/Sent/Filed controls; filed orders in customer Activity.
4. RECONCILIATION: complete. Successful wholesale imports (including historical and purchase-state-only) invoke exact daily matching; ambiguous evidence stays open and report evidence is claimed once.
5. AUDIT: complete for staging release. Primary audit and fixes, 306 tests, typecheck, schema/build checks and live manual lifecycle/mobile checks passed. Automatic filing/import adapter behavior tested with fixtures, not a new live OHLQ download.
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

- Feature commit 299af21f2cc17e266a86551e4289f04f49b127f7 pushed to staging/tst only. Vercel deployment dpl_9XHR72f3fBiyz2ENw5j56u6cLGPs READY; neat-tst.vercel.app points to it. Production/main untouched.
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

## Final staging verification

- Final full suite: 306/306 passed after incomplete-report rejection fix. Final typecheck and diff check passed. Local offline build passed; Vercel final feature build READY.
- Health endpoint: ok=true, database=connected, databaseTarget=neon-neat-tst, environment=test.
- Browser verified Accounts navigation, customer search, PDF creation/download, saved-PDF re-download with no duplicate order, detail date 9/10/2026, Mark Sent, Mark Filed with actor/time/MANUAL source, terminal controls removed, Filed event in existing account Activity, status-filter reset, and 390x844 mobile order cards. Temporary viewport override reset.
- One clearly labeled staging-only fixture retained: cmtvnp6b20001la05wcqgj06o, customer label TEST ONLY - Do Not Send, permit TEST-LIFECYCLE-20260910, org_echo_spirits, account cmtn7gr890b0eupt4ar4qub9f, $37.56, FILED manually. PDF 184592 bytes. It is not a real sale, no email was sent, and synthetic permit prevents matching actual reports. Do not mistake it for a customer order.
- Vercel runtime error scan since 2026-09-10T15:00:00Z found no errors during verification.
- After exiting support view, opening the Echo fixture as Neat Staging returned 404, verifying live detail tenant isolation. Direct browser navigation to the cross-tenant PDF URL was blocked by the browser client, so that separate live PDF-negative check is unverified (service download queries are tenant-scoped). Normal user context restored.
- No outstanding implementation blocker. Automatic matching is verified by unit/service/import tests; an actual post-release OHLQ load has not been run during this release.
- Next production step requires separate user authorization: review staging acceptance, preflight production schema, apply only this additive migration, selectively promote feature commit to divergent main, then verify production deployment and an actual wholesale import. Do not blindly run legacy migration history or push current tst wholesale to main.
