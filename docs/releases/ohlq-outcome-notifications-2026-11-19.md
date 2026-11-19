# OHLQ load outcome notifications — November 19, 2026

The owner authorized implementation, tests and selective promotion to neat-tst/tst and ohlq-field-crm/main, retaining each current version. Production base is `8e0282a773a54209332df5198396927afbae6b68` (0.10.2); TST base is `07213320628f4e787a6c24d276eee52124f1f53f` (0.10.0-dev). Historical tags and unrelated TST changes remain untouched.

## Problem and behavior

On November 19, production run [44519733602](https://github.com/echospirits/ohlq-field-crm/actions/runs/44519733602) completed the current load. Its separately dispatched November 17 replay [44519737435](https://github.com/echospirits/ohlq-field-crm/actions/runs/44519737435) failed installing Chromium's OS dependencies when Ubuntu returned HTTP 503. That failure sent an alert despite complete current data.

The cron now dispatches its frozen report-date batch once. Each requested date is attempted even if an earlier date fails; imports precede the one downstream intelligence refresh. Setup commands and provider reads use bounded retries (three attempts, 15/30-second waits). Only provider download closures retry; parsing, committed imports, reconciliation and intelligence writes do not replay. Existing database reads and fixed-value status writes also recover narrowly recognized uncoded Prisma connection initialization failures.

The normal sync job preserves failed step outcomes but delegates the workflow's terminal result to an independent verification job. That job has its own 15-minute budget and enforces environment/database identity and the validated manifest. It reads a repeatable snapshot in a database-enforced read-only transaction, retrying incomplete/unavailable checks up to three times at 30/60-second intervals. It verifies exact sales receipts/counts, retained valid masters, enrolled tenant inventory and agency intelligence, current wholesale configuration/source revisions and completed assessment coverage, exact forecast provenance/snapshots, and the scheduled operational-source policy. Typed stale-publication and optional lookup/unavailable warnings remain warnings.

Failure or timeout before a manifest, unknown database results, unresolved processing, missing source data and incomplete scoring remain actionable failures. Discovery and Account Sales Status reconciliation lack durable completion receipts: an actual failed attempted stage remains explicitly unverified, even when other persisted checks pass. A setup failure that skipped those stages can use independently certified prior data. The verifier never performs an import or repairs statuses.

Manual purchase-state, credential-repair and production-sources-only commands retain strict outcome behavior. TST's deliberately disabled automatic OHLQ schedules remain disabled. GitHub notification preferences are unchanged; the normal workflow result now describes required data health after recovery.

Sales dates and the requested business-day manifest are fixed before setup. Actual inventory/provider observation clocks remain truthful. A rare manual/queued load crossing Eastern midnight may leave a mixed-day state that cannot be certified; this remains an actionable verification failure with a `VERIFICATION_CLOCK_ROLLOVER` warning. Newer observations are not silently accepted as proof of the requested day's complete processing.

## Scope and validation

No schema, dependency graph, version, product UI, source-date rewrite, secret/account, feature flag or notification-settings change. No historical refs are replaced. UI/browser visual acceptance is not applicable because no rendered components changed; tenant and provider boundaries are checked in behavioral tests and persisted readbacks.

Independent review required read-only retry boundaries, an independent verification budget, fail-closed manifests, matching forecast invoice policy and exact represented wholesale coverage. Those requirements are implemented and regression tested.

Read-only production rehearsal verified November 17/18 sales (82,718/17,157 and 88,801/21,396 retail/wholesale), 497 inventory rows, 608 agency summaries/profiles, all 15,596 assessments, 18 forecast/demand products, 36 warehouse observations and both OpenDock locations. No production writes were made by that rehearsal.

## Exact application validation

| Target | Application commit | Retained version | Full suite | Node 22/npm 10 CI |
| --- | --- | --- | --- | --- |
| Production | `393ea583d46f1c645f01d67cce929b4b9e4986ac` | 0.10.2 | 1,428 passed, 78 suites | [44543406443](https://github.com/echospirits/ohlq-field-crm/actions/runs/44543406443), passed |
| TST | `6c64e4e9a35470d44d422f1dd8cf833ac14891c8` | 0.10.0-dev | 1,532 passed, 78 suites | [44543699135](https://github.com/echospirits/neat-tst/actions/runs/44543699135), passed |

Both exact candidates passed strict typechecking and inert environment-specific production builds. Neither suite had skipped, cancelled or failing tests. Local validation used Node 24.15.0/npm 11.12.1; hosted lockfile checks independently verified Node 22.23.4/npm 10.9.9. `release:check` and the actual branch diff were reviewed. Only this bounded patch was selectively integrated; TST's unrelated history, Tasting hook and paused daily schedules were preserved. Independent final review found no material blockers.

Three isolated GitHub Actions fixtures exercised the real workflow outcome expressions without provider credentials, database access or application-branch changes:

- [Recovered attempt, 44543684874](https://github.com/echospirits/neat-tst/actions/runs/44543684874): the import-attempt job failed, verification passed, and the overall workflow succeeded.
- [Missing data, 44543684779](https://github.com/echospirits/neat-tst/actions/runs/44543684779): verification and the overall workflow failed as expected.
- [Missing manifest, 44543684925](https://github.com/echospirits/neat-tst/actions/runs/44543684925): verification and the overall workflow failed as expected.

These deliberately failing validation workflows are preserved under `codex-ohlq-outcome-contract-20261119` at `cf81b4b7dd910adf041de5cfa720bb87899964c1`; they do not represent failed data loads. Validation tags do not replace any version or historical release tag.

## Hosted acceptance

TST [load 44544820026](https://github.com/echospirits/neat-tst/actions/runs/44544820026) completed successfully at the exact TST application commit. The independent verifier reported `ready: true`, 21 passing checks, zero issues and zero warnings at 15:00:41 UTC on November 19. Actual imports recovered November 13's stale error receipt and loaded the requested November 16–18 dates without a direct database status repair.

| TST report date | Retail rows | Wholesale rows |
| --- | ---: | ---: |
| November 13 | 126,196 | 25,433 |
| November 16 | 76,952 | 12,297 |
| November 17 | 82,837 | 17,157 |
| November 18 | 88,923 | 21,396 |

Independent TST readback confirmed all eight sales receipts completed with zero skipped rows and matching raw counts; November 19 Account/Brand Masters contained 15,517/10,197 rows; current inventory and its daily snapshot both contained 497 rows. All 610 agency summaries/profiles were current. Wholesale assessment coverage completed for all 15,646 records, with zero failed/skipped records and matching requested-date ledger revisions. Forecasting had 18 snapshots based on source data through November 18, 18 demand rows, 36 warehouse observations and successful checks at both OpenDock locations. The represented assessment period was October 17–November 18; historical gaps outside the requested dates were not expanded into this hotfix. Automatic TST schedules remain paused.

Production [load 44553325730](https://github.com/echospirits/ohlq-field-crm/actions/runs/44553325730) also completed successfully at the exact application commit. Every attempted source and post-import stage passed. Its independent verifier reported `ready: true`, 17 passing checks, zero issues and zero warnings at 15:59:14 UTC on November 19.

| Production report date | Retail rows | Wholesale rows |
| --- | ---: | ---: |
| November 17 | 82,837 | 17,157 |
| November 18 | 88,926 | 21,396 |

The new production receipts completed at 15:40:00/15:40:05 UTC for November 17 and 15:43:39/15:43:45 UTC for November 18. Account/Brand Masters completed with 15,532/10,197 rows. Inventory contained 497 rows, all 608 agency summaries and market profiles were refreshed, and all 15,596 wholesale assessments completed with zero skipped or failed records. The represented wholesale source period was September 8–November 18. The verifier also certified 18 forecast snapshots, 18 demand rows, 36 warehouse observations and both OpenDock locations. Production's longer Account Master step was observed actively updating records with no blocked database sessions and finished normally; it was not restarted.

| Application deployment | Vercel deployment | State | Canonical health |
| --- | --- | --- | --- |
| Production `393ea583` | `dpl_8DszgbEDmK51dZ326qikhswXJnYg` | READY | [crm.echospirits.com](https://crm.echospirits.com/api/health): connected, `ohlq-field-crm`, `production` |
| TST `6c64e4e9` | `dpl_5F3LY7gejCksA3xi6hESEjL2gCnX` | READY | [neat-tst.vercel.app](https://neat-tst.vercel.app/api/health): connected, `neon-neat-tst`, `test` |

Acceptance uses real manual full-load dispatches. The next natural cron execution is not claimed as observed. Subsequent closeout changes are documentation only; application validation remains tied to the exact commits above.

Deployment-scoped error/fatal runtime-log scans returned no entries for either application deployment within the checked 30-minute windows. This bounded observation does not claim historical error-free operation.
