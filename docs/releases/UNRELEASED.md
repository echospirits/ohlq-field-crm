# Unreleased — frozen 0.14.0 release package

The development cycle opened on 2026-09-29. The owner explicitly requested production/main promotion on 2026-10-08. The complete fetched TST state is included, reconciled against current production 0.13.3; unrelated local files and divergent ancestry are excluded. Historical development entries below preserve their original delivery boundaries; the current release evidence supersedes their pending candidate status.

- Frozen release version: `0.14.0`.
- Verified production baseline: `0.13.3`, tag `v0.13.3`, commit `54a37d13125d3c95f9b0526114f31f7553cbbad3`.
- TST opening base: `94fe624b7ab14d0cfdf4e4367c7b8d8c9ff35e70`; its complete Git tree matches the production baseline.
- Previous release: [0.13.0 archive](0.13.0.md), [validation](0.13.0-validation.md), and [completed checklist](0.13.0-checklist.md).
- Current cycle: [release plan](0.14.0-plan.md), [pending release checklist](0.14.0-checklist.md), and [validation record](0.14.0-validation.md).
- Frozen runtime candidate: `d2f955d7ae595af5755a20c06bca9110d86bf17b`; source TST `af14d856` (source identity in validation).
- User-facing notes: [Neat 0.14 user update](0.14.0-user-notes.md).
- Current readiness: 611 tests, typecheck, production build, schema rehearsal and tenant-isolation checks passed; final responsive checks and production promotion are recorded in the validation checklist.

## Entry template

### Feature/change name

- Description: What changed and why.
- Relevant commit(s): Short SHA(s) from TST.
- Feature flag: Key, or `None`.
- Default flag state: Enabled, disabled, pilot-only, or `N/A`.
- Migration(s): Path(s), or `None`.
- Environment/config: New or changed variable names, or `None` (never include values or secrets).
- User-visible: Yes or no.
- Production readiness: Ready, blocked, or not reviewed, with a short reason.
- Rollout notes: Anything the release operator must do, or `None`.

## Pending changes

### Compact user login and daily usage auditing

- Description: Adds User activity under administration and mobile More, plus a platform dashboard link. Organization admins see only their organization's users; platform admins can compare all organizations and filter to one. Live name/email/organization search, UTC date range, login-day filtering, newest/oldest/most-login sorting, and 50-record pagination support permanent daily history. Organization summaries show active users, login counts, days with activity, and average active days per active user, including explicit no-recorded-activity states.
- Relevant commit(s): `d5416eb0` (`Add compact user login and daily usage auditing`).
- Feature flag: None; administration permission checks apply independently of Analytics entitlements.
- Default flag state: Available to organization and platform admins. All signed-in roles contribute activity.
- Migration(s): `prisma/migrations/20261008120000_user_activity_days`; additive daily activity table with a composite user/day primary key and organization/day and day indexes. Applied and registered only on `neon-neat-tst`.
- Environment/config: None; no new dependency or external service.
- User-visible: Yes.
- Production readiness: Validated for TST; frozen 0.14.0 candidate gates remain pending.
- Rollout notes: Apply this migration before deploying. Successful sign-ins atomically create a session and increment the daily login count. Foreground navigation/interaction records ordinary usage once per UTC day; idle/background activity does not. No IP, device, URL, session token, or event payload is retained. History has no expiry or deletion cascade. Tracking begins at deployment with no fabricated historical backfill. Support View uses the actor's home organization, not the viewed customer. Daily summaries preserve the organization captured when the day's record is first created. See [activity validation and storage notes](0.14.0-user-activity-validation.md). Existing older migration-ledger discrepancies remain separate from this migration.

### Reliable two-way Google Calendar schedule sync

- Description: Pulls unseen Google changes before outbound retries; validates current task owner, active status and exact calendar link before schedule updates. Serializes calendar operations and reserves provider event IDs before creation to prevent duplicate retries. Retains old links on failed reassignment/disconnect/calendar-switch cleanup. Reconnect cannot silently replace the Google account or move linked events to a fallback calendar. Explicit removed-event restoration creates a fresh event. Calendar settings distinguish successful, partial, busy, paused and reconnect-required checks, refresh Worklist views, and show the last successful check rather than a failed attempt.
- Relevant commit(s): Commit titled `Harden two-way Google Calendar synchronization`.
- Feature flag: Existing `CALENDAR_SYNC_ENABLED` and `CRON_JOBS_ENABLED` environment safeguards; no new tenant entitlement.
- Default flag state: Existing values preserved. TST calendar sync remains disabled; no Google account was connected for this change.
- Migration(s): None; uses existing event/connection fields and a transaction-scoped PostgreSQL advisory lock.
- Environment/config: No new variables; daily `0 10 * * *` schedule unchanged. Partial/failed cron checks return HTTP 503 with accurate counts.
- User-visible: Yes; honest Calendar settings feedback and safer two-way scheduling/recovery.
- Production readiness: Automated and synthetic UI checks validated for TST. Live isolated Google round-trip and frozen 0.14.0 candidate gates remain pending; not promoted to production.
- Rollout notes: No schema migration, backfill, historical orphan deletion, credential activation or main push. A real round-trip requires isolated TST Google configuration and user OAuth authorization; a `SYNCED` label alone is not proof. See [calendar validation](0.14.0-calendar-validation.md) and [integration behavior/QA](../google-calendar.md).

### Outstanding work on account pages

- Description: Wholesale and retail account pages show outstanding team Worklist items directly below Notes + contacts, grouped by Overdue, Today, Upcoming, and Unscheduled, with status, due date/time, and owner (including Unassigned). The section uses the shared rounded card boundary, padding, and a faint theme-aware sage tint for clear visual separation. The shared Worklist controls support Log Visit, Complete, Reschedule, Edit, Reassign, and Cancel without navigating away. Visit logging retains account/task/product context and returns to the account section after confirmation.
- Relevant commit(s): Commit titled `Show outstanding Worklist tasks on account pages`; follow-up `Frame account outstanding work in a tinted card`.
- Feature flag: None; existing intelligence-source entitlement visibility is preserved.
- Default flag state: Available to all tenants.
- Migration(s): None.
- Environment/config: None.
- User-visible: Yes.
- Production readiness: Validated for TST; frozen 0.14.0 candidate gates remain pending.
- Rollout notes: Reads existing tenant-scoped OPEN/IN_PROGRESS tasks, including older follow-ups linked through a source visit. Shared task actions retain calendar sync and opportunity reassignment behavior and refresh account pages. No backfill or service activation. See [account Worklist validation](0.14.0-account-worklist-validation.md).

### Center visit photos in the visible viewport

- Description: Expanded visit photos open in a viewport-centered native modal outside the visit-history section. Background scrolling is locked while open, preventing mobile photo/panel drift and clipping. Closing restores the original page position and thumbnail focus; Escape, Close, and backdrop dismissal are supported.
- Relevant commit(s): Commit titled `Fix visit photo viewer positioning and scroll lock`.
- Feature flag: None.
- Default flag state: N/A; applies wherever the shared visit photo gallery appears.
- Migration(s): None.
- Environment/config: None.
- User-visible: Yes.
- Production readiness: Validated for TST; frozen 0.14.0 candidate gates remain pending.
- Rollout notes: No data changes or service activation. See [photo viewer validation](0.14.0-visit-photo-validation.md).

### Persistent per-user Dark mode

- Description: Adds an automatically saved Dark mode switch at the top of Profile & preferences. The account preference applies to mobile and desktop, survives sign-out and sign-in, and is rendered on the server to avoid an incorrect-theme flash. Open sessions refresh the preference on focus, visibility changes, and every minute while visible. Shared dark surfaces, readable semantic statuses, native controls, and visible keyboard focus cover the app without altering photos or exported documents.
- Relevant commit(s): Commit titled `Add persistent account dark mode`.
- Feature flag: None.
- Default flag state: Available to all signed-in users; light mode remains the default.
- Migration(s): `prisma/migrations/20261001120000_user_dark_mode`; additive `User.darkMode` boolean defaulting to false.
- Environment/config: None.
- User-visible: Yes.
- Production readiness: Validated for TST; frozen 0.14.0 release gates remain pending.
- Rollout notes: Apply the migration before deploying the application. Applied only to the isolated `neon-neat-tst` database. Preference writes use the authenticated user's ID and require a same-origin request. No production promotion, backfill, entitlement change, or external service activation. See [Dark mode validation](0.14.0-dark-mode-validation.md).


### Graduate three Pilot capabilities into Core CRM

- Description: Account Sales Status / Pipeline, Analytics (including CSV exports), and Direct Wholesale Orders are included in Core CRM for every new tenant. Both platform Plan forms remove the separate Pilot options; Intelligence remains the add-on. Existing Core CRM tenants receive the three saved entitlements through the migration, including previously disabled Pilot rows. Tenant access checks and Ohio A-3a setup requirements remain in force.
- Relevant commit(s): `Include graduated Pilot features in Core CRM` (this entry's commit).
- Feature flag: Existing `ACCOUNT_SALES_STATUS`, `ANALYTICS`, and `OHIO_DIRECT_WHOLESALE_ORDERS` keys retained as Core entitlements.
- Default flag state: Enabled in Core CRM; Intelligence package behavior unchanged.
- Migration(s): `prisma/migrations/20261001130000_core_crm_pilot_graduation` (idempotent entitlement upsert; no schema changes).
- Environment/config: None.
- User-visible: Yes.
- Production readiness: Ready for inclusion in 0.14.0 per owner approval; whole-release candidate checks still apply at promotion.
- Rollout notes: Apply the migration to the exact production release candidate to enable all three for existing Core tenants. TST migration was applied and registered alone after checking migration history, preserving an older pending password-reset migration and concurrent dark-mode migration. No main push or production database mutation.
- Validation: 559 tests passed; typecheck and production build passed. Verified three enabled bundled entitlements for each of TST's three Core tenants. Static previews of the exact Plan markup with application CSS were checked at 390 x 844 and desktop; authenticated save/create behavior was not browser-tested. See [validation](0.14.0-core-plan-validation.md).

### Fixed customer-facing organization configuration

- Description: Removes every customer-facing configuration field from Platform Admin provisioning and organization editing: application/digest names, product labels, colors, customer/support contacts, locale, and week start. Admin actions ignore submitted overrides. New organizations use existing schema defaults, en-US/Sunday, and initial-admin contact defaults; edits preserve existing configuration and other JSON settings. Organization Admin has no matching controls or write path.
- Relevant commit(s): Commit titled `Lock customer-facing organization configuration`.
- Feature flag: None.
- Default flag state: N/A; applies to all organizations.
- Migration(s): None.
- Environment/config: None.
- User-visible: Yes.
- Production readiness: Validated for TST; frozen 0.14.0 candidate gates remain pending.
- Rollout notes: No backfill or normalization of existing values. Operational organization identity, timezone, website, status, notes, product selection, and A3A location contacts remain editable. See [validation record](0.14.0-validation.md).

### Gray pipeline chevrons before an account is targeted

- Description: Account-page relationship chevrons use the saved sales status instead of the fallback Target value. Accounts without a saved status show gray incomplete steps and Sales Status displays `Not set`, with `No saved status` detail. The status picker starts at `Choose status` and requires an explicit choice before saving. Saved Target and later stages retain their labels and colors. Applies to wholesale and agency pages; Pipeline filter colors remain available.
- Relevant commit(s): `5fabaefe` (`Fix untargeted account pipeline chevrons`); follow-up commit containing the label change (`Show unset account sales status explicitly`).
- Feature flag: Existing `ACCOUNT_SALES_STATUS`; no new entitlement.
- Default flag state: Existing tenant settings preserved.
- Migration(s): None.
- Environment/config: None.
- User-visible: Yes.
- Production readiness: Validated for TST; frozen 0.14.0 candidate gates remain pending.
- Rollout notes: Included in the 0.14.0 development package. No data repair or backfill. See [validation record](0.14.0-validation.md).

### OHLQ report re-login recovery (0.13.3 hotfix carry-forward)

- Description: Report re-login accepts the expected Power BI report or Microsoft authentication handoff instead of waiting for the partner homepage. Resumes the report without another login cycle, preventing false timeout failures.
- Relevant commits: `0abde6e2` (TST fix); production-base hotfix `d2c92f9c`, tag `v0.13.3`.
- Feature flag: None; existing import/environment guards remain in force.
- Default flag state: N/A.
- Migration(s): None.
- Environment/config: None.
- User-visible: Yes; scheduled report refresh reliability.
- Production readiness: Separately released as 0.13.3. Production passed 529 tests, typecheck and build; TST passed 557 tests, typecheck and build. Both deployments reached Ready with matching commit metadata, connected isolated database health, and passing Linux clean-install checks.
- Rollout notes: No database mutation, credential repair, or unrelated 0.14.0 production promotion. See [0.13.3 release notes](0.13.3.md) for root causes, retained data coverage and remaining live-run validation.

### Restore both wholesale purchase sections (0.13.2 hotfix carry-forward)

- Description: Wholesale account pages again show the active tenant's 30-day purchases first and an expandable list of all OHLQ wholesale purchases at that location second. The tenant section remains organization-scoped in regular and Support View sessions; retail filtering from 0.13.1 is unchanged.
- Relevant commit(s): `f3085874` (source and regression tests carried from the 0.13.2 production hotfix).
- Feature flag: None.
- Default flag state: Available to all tenants.
- Migration(s): None.
- Environment/config: None.
- User-visible: Yes.
- Production readiness: Separately validated as the 0.13.2 hotfix; this TST carry-forward does not promote 0.14.0 development work.
- Rollout notes: No data repair or backfill. TST passed 549 tests, typecheck, and build. The local typecheck/build excluded a pre-existing untracked `tmp` audit script and used matching development resource labels; no tracked configuration was changed. Deployment `dpl_5QDxCiXi337PCyHCnWn9WvsmTsfR` reached Ready with `f3085874`, `0.14.0-dev`, and the isolated `neon-neat-tst` database. See [0.13.2 release notes](0.13.2.md) for hotfix scope and validation.

### Tenant-scoped recent account sales (0.13.1 hotfix carry-forward)

- Description: Retail account sales use the active organization's product list and labels in regular and Support View sessions. Wholesale recent purchases show only that organization's tracked products.
- Relevant commit(s): `cdd930a5` (source fix cherry-picked from the 0.13.1 production-base hotfix).
- Feature flag: None.
- Default flag state: Available to all tenants.
- Migration(s): None.
- Environment/config: None.
- User-visible: Yes.
- Production readiness: Separately validated as the 0.13.1 hotfix; this TST carry-forward does not promote 0.14.0 development work.
- Rollout notes: No data repair or backfill. TST passed 549 tests, typecheck, and build. The local typecheck/build excluded a pre-existing untracked `tmp` audit script and used matching development resource labels; no tracked configuration was changed. See [0.13.1 release notes](0.13.1.md) for the production-base hotfix scope.

### Open the 0.14.0 development cycle

- Description: Advances the canonical application and lockfile versions to `0.14.0-dev`; starts the manifest, release plan, pending checklist, and validation record for eventual 0.14.0 promotion.
- Relevant commit(s): `9cfce468` (`Open Neat 0.14.0 development cycle`); subsequent verification evidence is linked above.
- Feature flag: None.
- Default flag state: N/A.
- Migration(s): None.
- Environment/config: None.
- User-visible: Yes; protected Environment diagnostics show the development version.
- Production readiness: Not reviewed for production; development cycle setup only. Candidate-specific release checks remain pending.
- Rollout notes: Deploy only to `neat-tst/tst`. No schema changes, backfills, entitlement changes, or external service activation. Remove `-dev` only when preparing the exact stable release candidate, then complete the linked checklist.

### Self-service password reset

- Description: Adds a `Forgot password?` action to sign in. Active users with a password can receive a one-time reset link that expires after one hour, set a new password, and revoke existing sessions. Responses do not disclose whether the email belongs to an account.
- Relevant commit(s): `d5a43589` (self-service password reset).
- Feature flag: None.
- Default flag state: Available to all users.
- Migration(s): `prisma/migrations/20260923123000_password_reset_tokens`.
- Environment/config: Uses the existing email configuration and delivery safeguards; no new variables.
- User-visible: Yes.
- Production readiness: Not reviewed; automated tests deferred for TST review. Production release remains separate.
- Rollout notes: The additive migration was applied to the isolated TST Neon project `neat-crm-tst` (`neondb`, primary branch `main`), reported by the app as `neon-neat-tst`. TST email is suppressed by default; sending from TST requires `EMAIL_SEND_ENABLED=true`, an `EMAIL_OVERRIDE_RECIPIENT`, and the existing Resend configuration. Expired reset records can be retained safely; token hashes are stored instead of raw tokens.

### Wholesale account assessment replacement

- Description: Separates current tenant/account intelligence, computed capture/develop/deepen candidates and chosen pursuits. Adds a complete research-only path, market-aware editable product strategy, explicit effort/confidence/coverage, corrected daily ledger reconciliation, full batched sweeps with run monitoring, contextual acceptance/feedback, and inactive shadow outcomes. Replaces live legacy score reads without rewriting historical pursuits or requesting research.
- Relevant commit(s): `987f2ab3` (`Replace wholesale opportunity scoring with current account assessments`); delivery evidence follows in the [validation record](0.14.0-wholesale-assessment-validation.md).
- Feature flag: Existing `WHOLESALE_OPPORTUNITIES`; no new entitlement.
- Default flag state: Existing tenant settings preserved. Outcome learning inactive.
- Migration(s): `prisma/migrations/20260929160000_wholesale_assessments` (additive; applied only to verified TST).
- Environment/config: No new variables or external permissions. Echo-only nullable product-role defaults; other tenants neutral. Product strategy/selection changes mark assessments pending for daily or explicit score-only refresh.
- User-visible: Yes; opportunities, wholesale detail/list, linked agency intelligence, search, dashboard and administration use current assessments; existing pursuit evidence remains distinct.
- Production readiness: Not reviewed. TST has only 24/90 verified sales days; richer style/use evidence and a post-deployment scheduled-run check remain needed. This is not evidence of forecasting accuracy or a production release.
- Rollout notes: Follow [migration, commands, monitoring and rollback](../opportunity-intelligence.md). Never replay historical migrations blindly. Recalculate all enabled tenants from saved inputs after migration; reconcile actual persisted counts and source status. No bulk re-research, automatic task creation, provider activation, stable tag or main promotion.
