# Production Supplies: production activation

November 12, 2026. After the verified 0.10.0 code release, the owner explicitly approved Echo production activation: the three existing Production members, a dedicated production Google client and encryption/job keys, each owner's read-only Gmail consent, and the 15-minute worker. Paid tracking and new user accounts remain excluded. This supersedes the earlier pending activation boundary without changing the released application or historical tag.

## Target and enrollment

Production remains Vercel project `prj_GaShdLZfAN7exFFw93FX0B66pqGn`, team `team_iONC2HcvO7u5Nt0k3haV3gLS`, canonical domain `crm.echospirits.com`; Neon project `crimson-river-91402927`, branch `br-solitary-lake-am9whrqb`, database `neondb`, app target `ohlq-field-crm`. The exact 19-table migration fingerprint is unchanged: `08b6873d08ff50a0d908b78a09bded848d218801c90d6748cd48729009d58609`.

At **18:30:48 UTC**, the guarded enrollment transaction created/reused only Echo's Production team and granted Joe Bidinger, Karl Dick and Nikhil Sharoff explicit view/manage access. Their existing ADMIN/USER/USER roles and verified identities remain unchanged. Only Echo's `PRODUCTION_SUPPLIES` entitlement was enabled. Three connection-required slots were created; no catalog item, need, order, source, receipt or inventory record was seeded. Independent post-commit readback at **18:31:15 UTC** confirms the exact settings, other preferences/entitlements and schema. Audit receipts: `cmwdvvlvi0009upiwn8ejughz`, `cmwdvvlvi000bupiwaz9w9pgy`.

## Separate credentials and consent

Fresh production-only `SUPPLY_MAIL_TOKEN_ENCRYPTION_KEY` and `SUPPLY_JOB_SECRET` are saved as Vercel Secrets. The new OAuth client **Neat Production Supplies Production**, public client ID `511071076507-umie73ufcqhpu9a7e2ci02btr8l82t15.apps.googleusercontent.com`, belongs to the existing owned EchoCRM project `crm-login-auth`. It has only callback `https://crm.echospirits.com/api/production-supplies/mail/google/callback`, with no JavaScript origins or TST callback. Its ID and secret are separately saved as production-only Vercel Secrets; existing Calendar and TST clients/keys are unchanged. No TST mailbox tokens, user IDs, private source records or synthetic fixtures were transferred.

`SUPPLY_GOOGLE_REDIRECT_URI` matches that exact callback and `SUPPLY_MAIL_OAUTH_ENVIRONMENT=production`. The consent gate was enabled while the worker stayed off. Joe signed in using his verified `joe@echospirits.com` identity and granted only openid/email and Gmail read access. The production callback returned `status=connected`; the live UI showed **Initial import queued**. Read-only database acceptance at **18:59:38 UTC** independently confirms one enabled GOOGLE connection with Gmail read permission and Joe's queued sync. Karl and Nikhil remain **Connection required**; each must sign in and connect their own mailbox. Their missing consent does not authorize impersonation or stop Joe's eligible mailbox.

## Scheduling and initial acceptance

GitHub's existing **Production** environment in `echospirits/ohlq-field-crm` contains the matching dedicated `SUPPLY_JOB_SECRET`, visibly verified at **18:56 UTC** after the owner's paste/save. Existing secrets and deployment protections were preserved. Repository variable `PRODUCTION_SUPPLIES_SCHEDULE_ENABLED=true` was saved and verified at **19:00 UTC**, only in the production repository. It is repository-level because the workflow's job condition is evaluated before environment variables load.

The workflow schedules `8,23,38,53 * * * *`, with fixed production destination, main/repository guards, the Production environment and no redirects. `SUPPLY_JOBS_ENABLED=true` was saved only after the connection and scheduler-secret receipts. Worker-enabled redeploy **`dpl_DmPdmeY6R18MFxyjBBMJBe1urQrz`** is READY at unchanged main `02b6fa0cbe41824d30a2d3e93ecf3f1de1e7cb56`, with the correct production aliases. A manual dispatch proves that invocation, not punctual recurring cadence.

[First production worker run 43286205961](https://github.com/echospirits/ohlq-field-crm/actions/runs/43286205961) succeeds at this exact main head. Production job `131420167091` completes in 37 seconds; TST job `131420169589` is explicitly skipped. The fixed endpoint returns one organization, one mailbox check, zero mailbox/replay errors, no tracking activity and no deferred worker lane.

Independent read-only acceptance at **19:04:48 UTC** confirms **seven COMPLETE automatic GOOGLE sources across five real messages** (five bodies and two attachments), no bootstrap sources or extraction errors, and Joe's persisted INITIAL_IMPORT checkpoint without a leftover lease. The sources comprise four OTHER and three SHIPMENT facts; before any Dx5 alert is encountered they create **zero operational orders, catalog items, needs, shipments or cards**. Missing context is preserved rather than inventing supply relevance. Foreign-tenant Supply aggregates, existing inventory aggregates and zero receipts/received allocations match the baseline.

The existing Joe Admin session verifies Supplies and Forecasting under Production at 1440 × 900 and 390 × 844. The initial dashboard accurately says **email coverage is incomplete** and **No alert data yet**, without tabs, editors, dismiss buttons or page overflow. This is a healthy initial-import state, not a claim that nothing is needed or that history has finished importing. No real item was dismissed for verification.

One bounded continuation through the same fixed authenticated endpoint ran **19:06:15–19:07:18 UTC**, HTTP 200, one mailbox check and no mailbox/replay errors or tracking activity. Readback at **19:07:53 UTC** shows 14 automatic sources across seven messages: 13 COMPLETE and one explicitly UNSUPPORTED attachment with no scheduled retry. The persisted message/attachment cursor is retained; there are still no operational orders or warnings before the newer-first scan reaches Dx5.

### Two verified starting alerts

To make the initial dashboard useful without waiting for the broader scan, the connector independently re-read only the two latest original business Dx5 alerts. Both are dated **November 12, 00:41:46 UTC**:

- **Ec Vodka Label:** 447 units against a 1,000-unit threshold.
- **750mL Tennessee Bottles:** 901 units against a 2,000-unit threshold.

Neither message specifies a physical location; both retain **Location unknown**. Their actual sender is `no-reply@fx5.com`; the released verifier accepts the topmost Gmail Authentication-Results SPF pass for the provider-owned `fx5solutions.com` envelope. DKIM and DMARC failed in these originals; neither is claimed to have passed.

At **19:14:44 UTC**, the released `ingestEvidence` service ingested exactly these two fresh sources with `reconcile:false`, the verified production Joe connection, original Gmail identifiers and explicit **GOOGLE_CONNECTOR** provenance. This was a fresh source read, not a TST record copy or simulated data. The private metadata/facts proof is retained outside Git; its fingerprint covers that metadata/facts basis, not a claimed raw-message body hash. Existing COMPLETE sources are preserved, and binding the same actual connection lets later automatic processing skip them idempotently.

The short guarded transaction neither invoked providers/replay/tracking nor wrote cursor/lease fields. Its exact sync-row hash, existing roles and protected aggregates are unchanged; independent committed readback confirms the two expected warning occurrences/cards, both **NO_ORDER_FOUND**, and zero receipts/received allocations. Later normal worker replay/continuation and final live UI receipts are recorded separately below.

### Final normal processing and live confirmation

[Final worker run 43288309345](https://github.com/echospirits/ohlq-field-crm/actions/runs/43288309345) succeeds on main `02b6fa0cbe41824d30a2d3e93ecf3f1de1e7cb56`. Production job `131427501637` runs for 1m4s; TST job `131427504215` is skipped. Response: one mailbox check, one evidence replay, zero mailbox/replay errors, no tracking activity and no deferred worker lane. No further manual worker was started.

Read-only acceptance at **19:17:33 UTC** confirms 21 automatic GOOGLE source records across seven messages and two distinct connector-derived warning records bound to Joe's same connection. Joe has 20 processed extraction units, zero failures/errors, an INITIAL_IMPORT checkpoint and no active lease; full backfill remains unfinished. Four historical shipment facts are explicitly REVIEW and one attachment UNSUPPORTED, with no scheduled retries beyond the terminal states. These are retained evidence limits, not invented successful matches.

The normal replay creates three operational orders and one shipment, **all linked to the two watched materials**, with zero unlinked/unwatched orders. Foreign-tenant Supply aggregates, existing inventory aggregates, and zero receipts/received allocations remain unchanged. The final two cards are:

| Material | Current status | Supplier | Location / arrival |
| --- | --- | --- | --- |
| 750mL Tennessee Bottles | Order match uncertain | Imperial Packaging | Location unknown; no ETA |
| Ec Vodka Label | No order found | Unknown | Location unknown; no ETA |

This supersedes the initial no-order state after bootstrap: retained real order evidence is now visible, while unconfirmed destination/shared-use purpose prevents a false definite order or arrival claim. Final live 390 × 844 and 1440 × 900 confirmation matches the persisted cards exactly. The page retains incomplete email coverage and unavailable live-carrier qualifiers, has only the two permitted Dismiss controls and no tabs, and has no horizontal page overflow. Neither real card was dismissed and no settings were changed for acceptance; the viewport was restored and the dashboard left open.

The unchanged 0.10.0 application, prior 1,289-test/typecheck/build/exact-CI evidence and production-derived migration remain authoritative. Activation adds hosted configuration, real scoped data and documentation, with no application/dependency/schema change; documentation closeout requires scope/diff checks rather than another unrelated full suite. Historical application tag `v0.10.0` remains fixed.

Historical import is 90 days, bounded and checkpointed; each page contains at most five messages and a mailbox lane yields within its time budget. Source counts and processed-message counters are distinct because attachments can create additional sources. Initial processing does not establish full 90-day completion. Only validated Dx5 warning materials create cards; unrelated purchases remain outside operational order/tracking scope.

The baseline and pre-worker readback confirm unchanged foreign-tenant Supply aggregates, existing inventory aggregates and zero supply receipts/received allocations. These are aggregate drift checks, not a complete row-level audit. Private original message IDs, subjects/bodies, filenames, session tokens and credential values remain outside committed evidence.

The GitHub workflow is independently verified **active** (`416372058`) on the production repository's default branch `main`; the repository is not archived or disabled. No scheduled event had yet appeared in the bounded observation window. Configuration and successful manual invocations are verified; exact recurring dispatch timing is not claimed. The temporary local key handoff file was removed after both provider saves and authenticated worker verification; the encrypted provider stores remain canonical. Temporary transfer servers stopped and completed setup tabs were closed.

## Limits and recovery

`SUPPLY_TRACKING_MODE=disabled` and `SUPPLY_TRACKING_LIVE_ENABLED=false` remain in production. No EasyPost credentials, charges, tracking registrations, new accounts, supplier messages, purchases, accounting entries or inventory-ledger writes are included. GFS and freight still require supported integrations. Karl/Nikhil's individual mailbox consent remains outstanding.

Disable the Supply-only worker/ingestion switches or Echo entitlement to stop new processing while retaining evidence. Keep the stable encryption key for retained connections; do not silently substitute TST credentials. The exact 0.10.0 application and migration remain intact; no new development cycle or production tag is opened for this operational activation.
