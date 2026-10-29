# Integrated CRM implementation progress

> Current release, October 29, 2026: **0.5.0 is released to TST and production; development remains frozen.** The authorized interface, navigation and whole-application audit improvements preserve the 0.4.1/0.4.2 fixes. The exact tested candidate and final deployment receipts are recorded in [release validation](../releases/0.5.0-validation.md), [release notes](../releases/0.5.0.md) and the [completed checklist](../releases/0.5.0-checklist.md). [UNRELEASED](../releases/UNRELEASED.md) is empty; no new development cycle is opened. Older release-state statements below are historical.

> Current release update, October 28, 2026: after the released 0.3.0 freeze, the owner authorized retiring Communications, mailbox/imported-appointment capture, business SMS, contact suggestions and the communication assistant. These runtime features are removed in released `0.4.0`; ordinary Contacts, manual interactions, history, briefing and Worklist/calendar remain. [Current validation](../releases/communications-retirement-validation.md). Earlier delivery records below describe historical implementations.

> Release update, 2026-10-28: **0.3.0 is released to production; development remains frozen.** Echo-only access and Production Forecasting are packaged together. The [0.3.0 plan](../releases/0.3.0-plan.md), [checklist](../releases/0.3.0-checklist.md) and [migration runbook](../releases/0.3.0-migrations.md) govern current readiness. Development remains locked. The linked preparation records below are historical; detailed delivery receipts are kept in the private operator package. Historical implementation/delivery evidence below is retained.

## Current state — 2026-10-11

The remaining application areas from the master brief have been implemented by extending canonical workflows. This is **0.2.3-dev for TST**, not production promotion. Historical v0.2.0/v0.2.1/v0.2.2 artifacts remain untouched. The owner correction is permanent in AGENTS.md and ADR 0012: Pipeline replaces the duplicate Deals surface; Log Visit replaces the duplicate Activities entry surface.

See the [complete feature inventory](../product/feature-inventory.md) for source locations, implemented scope and deliberate source-data limits. Source remains authoritative. No live provider success is inferred from a mock.

## Completed application work

- Canonical interaction logging, contacts/person links/merges/aliases, authorized timeline filters, transparent health, account briefing and versioned Pipeline plans/configurable stages.
- Google/Graph operational recovery, occurrence windows, completed-rescan deletion reconciliation, private matching, internal exclusions, retention and backoff.
- Reviewed two-way business SMS with consent/signed callbacks and uncertain-send handling; nonproduction mock.
- Canonical Worklist playbooks and transactional contextual follow-ups; guarded cancellation.
- Tenant account categories/parents/territories/teams/custom fields/documents; guided visits, opt-in local drafts and reviewed route ordering.
- Existing Recipe catalog/costing/approval/public sheets; existing EventShift operations/staff conflicts/Eventbrite and coverage-aware sales comparisons.
- Permission-aware reviewed AI adapter/mock, expanded existing Analytics continuity/execution/territory reports and CSV exports.
- Current TST Retail/Restaurants wording and state-access changes integrated. New event/playbook references and signed callbacks participate in that state policy.
- Source documentation, activation instructions, migration/recovery guidance and regression scripts updated.

## Validation and TST delivery

**847 passing tests, 75 suites, no failures/skips**. Typecheck, optimized build, schema validation, isolated database rehearsals and all three browser scripts pass at 390×844 and 1440×900. Nine additive migrations were applied to shared TST after a recovery snapshot; their checksums match source and existing activity data is unchanged.

Tested application commit `f9819f2c74003048c58e12378afd3184a78159d5` is pushed to staging/tst and its Vercel deployment is READY. Health verifies test/neon-neat-tst. See the exact [release receipt](../releases/v0.2-test-report.md). The local acceptance server is stopped. Production/main remains `af1f396726e3b15e1167f5af2aa6ba426cae9bf9`.

## External activation and source limits

- Live Google/Microsoft OAuth, Twilio registration/delivery, Eventbrite access, road routing and AI credentials/model quality require provider acceptance and explicit environment configuration. The application and mocks are implemented. No new live OpenAI key was provisioned.
- Personal-device SMS capture, full mailbox bodies/attachments, arbitrary Graph folders and full offline synchronization are not claimed. Original-message links and opt-in local text drafts provide bounded alternatives.
- Daily bottles cannot establish transaction order counts or observed revenue forecast accuracy. Reports label retained-history purchase-day observations and unknown coverage honestly.
- Six dependency package findings remain; see security review. Production credential remediation and production promotion remain separate tasks.

## Application continuation complete

The authorized application implementation, migration rehearsal, integrated acceptance, TST migrations, commit/push and deployment verification are complete. The items above are live activation and production gates, not claims of completed live-provider acceptance. Production promotion remains a distinct release task.

## Contact suggestions continuation — 2026-10-12

Rollout update: Communications, imported mailbox appointments, business SMS and contact suggestions now require a separate **COMMUNICATIONS Pilot**, initially assigned only to Echo Spirits for v0.2. TST auto-enablement and new/Core/Intelligence packages exclude the Pilot. It remains pending Echo review before general availability; provider activation is separate. See [review steps](../product/communications-pilot-review.md) and [pilot validation](../releases/communications-pilot-validation.md).

Reviewed contact discovery now extends Contacts and Communications using captured email participants/header names and business SMS. It reuses ordinary tenant contacts and live contact search, with private-owner evidence, explicit acceptance, duplicate checks, per-user dismissals and preserved communication visibility/consent. No body/signature AI extraction or live provider activation was added. Application `c6686b8d` is verified TST READY after 852 tests, typecheck/build, isolated database acceptance and 390×844/1440×900 browser checks. See [guide](../product/contact-suggestions.md) and [release receipt](../releases/contact-suggestions-validation.md).
