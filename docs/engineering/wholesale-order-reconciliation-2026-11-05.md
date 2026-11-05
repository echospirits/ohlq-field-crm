# Wholesale Orders automatic Filed investigation

Owner scope, November 5, 2026: investigate why daily imports have not automatically marked wholesale orders Filed and repair the existing process. TST delivery is authorized; production promotion is a separate release task under AGENTS.md. Sent and Paid remain manual.

Production closeout, later November 5: the owner separately approved promotion and reconciliation of the six existing orders. **0.7.2 is deployed as `12c1d995114203609bb92f833449138ec22bd52c` and all six are now AUTO_MATCH Filed**, with zero additional filings on replay. The original findings and TST evidence below are preserved; [0.7.2 validation](../releases/0.7.2-validation.md) records the exact production gates and live receipts.

## Production findings

- Verified current main `9b4bd8dd8b14ef6b81b628479b3a6780864be2f2`, application version 0.7.1; TST baseline `39b8a2571d17d0f061e17da422321c926a157c23`.
- Production Neon identity: `crimson-river-91402927` / `br-solitary-lake-am9whrqb` / `neondb`. Read-only inspection found 10 Echo orders: four manually completed, six unfiled, zero automatically filed.
- [Production import run 42023404682](https://github.com/echospirits/ohlq-field-crm/actions/runs/42023404682), job `127263776387`, succeeded. At 08:14:36 Eastern on November 5 it logged: six checked, zero auto-filed, zero ambiguous, six outstanding. Wholesale report imports through November 4 completed successfully. This is a matching defect rather than a missing import hook or disabled process.
- Order PDF generation stores `OhlqBrandMasterItem.vendor`, a supplier name (`ETOHIO LLC` here). Sales CSV rows use a vendor ID (`Z90399001` here). Direct string comparison rejected otherwise exact matches. Unit fixtures had used vendor IDs on both sides and missed this production format difference.
- A second defect classified manually filed `COMPLETED` orders as open because only `FILED` was excluded. A match for a completed manual reservation could throw and roll back reconciliation.
- Customer identifiers also differ for two orders. Henmick's captured bare permit and report permit with suffix `-1` are already explicitly linked to the same account in `WholesaleLicenseeId`. Antiques on High's captured suffix `-0005` and report suffix `-2` were initially unlinked. The owner then explicitly confirmed `03362482-2` is a reporting alias for the same 714 S High St location. Names, quantities and nearby dates alone did not establish that link.

## Repair boundaries

- Join exact report product codes to Brand Master supplier names to bridge name/ID formats. Resolve only a unique observed vendor ID per supplier name; conflicting IDs stay blocked for review. Preserve all report products for that supplier when comparing the full product/quantity set.
- Use the order account's explicitly stored permit aliases only while its captured permit still appears among that account's identifiers. Preserve every suffix segment and reject unlinked locations. Compare accepted permit sets when checking collisions between distinct customer accounts.
- Treat manual `FILED` and `COMPLETED` orders as reservations, never new automatic filing candidates. Retain advisory locking, transactional updates, tenant-scoped orders and globally unique evidence claims.
- Preserve exact store, inclusive sale date through sale date +7 calendar days, positive exact per-product bottle quantities, unique order/evidence pairing and one-use evidence. No fuzzy names, inferred permit suffixes, subset quantity allocation or automatic Sent/Paid changes.
- No UI, schema, migration, dependency, hosted configuration or provider account change. The initial TST repair phase left production order statuses unchanged; its only production data correction was the owner-confirmed account alias below. Later owner-approved production filing is recorded in the closeout section.

## Owner-confirmed account identity correction

- Checked production and TST for conflicting primary/alias mappings before writing. Neither contained another wholesale account claiming the normalized `3362482-2` reporting identifier.
- Added `03362482-2` as a non-primary `WholesaleLicenseeId` for Antiques on High: production account `cmtn7n92r0bwoup98mffp4ih3`; TST account `cmtn7gqyi0ab8upt4sfsowgtp`.
- Each additive insert was guarded by the verified account ID, original primary permit, address and unmerged state, inside a transaction with account row locking. Readback confirms original primary `3362482-0005`, existing alias `3362483` and new alias `03362482-2`. No saved order, PDF, primary permit or other account identity was rewritten.

## Captured production evidence for read-only replay

| Customer | Order date | Report date | Product / bottles | Verified replay result |
| --- | --- | --- | --- | --- |
| Standardized Brewing | October 6 | October 6 | 2806B / 6 | Automatic Filed |
| Lupo on Arlington | October 6 | October 6 | 3135B / 3 | Automatic Filed |
| Lupo on Arlington | October 23 | October 26 | 3135B / 3 | Automatic Filed |
| Henmick | October 27 | October 27 | 2806B / 12 | Automatic Filed through explicit stored alias |
| Antiques on High | October 27 | October 27 | 2806B / 6 | Automatic Filed through owner-confirmed explicit alias |
| Thunderwing Brewing | November 2 | November 3 | 2802B / 2 | Automatic Filed |

The replay uses a local snapshot of actual order/report/catalog/alias values and an in-memory persistence adapter. It performs no production writes. The raw snapshot remains in ignored local scratch output rather than release source.

## TST validation and original delivery

- Clean locked dependency install, Prisma Client generation, strict typecheck and optimized build passed using Node 24.15.0/npm 11.12.1. The first local build was blocked by sandbox ancestor-directory reads in the existing Workflow bundler; retry outside that filesystem restriction passed without a source/configuration change. Build used an inert localhost database URL and disabled integrations.
- Focused matching/import/lifecycle/workflow-isolation/PDF checks: **48 passing tests**. Completed full suite: **1,038 tests / 76 suites**, zero failures/skips/cancellations. No schema/migration, dependency, package version or workflow change; `git diff --check` passes.
- Independent code review found and verified the correction for unresolved historical manual supplier metadata: such a reservation cannot release evidence to a nearby pending order even if the pending order stores a raw vendor ID. Conflicting supplier mappings and overlapping explicit customer aliases fail closed.
- Initial production-data replay: six checked, five filed in memory, one unlinked Antiques order left open; second pass zero additional filings. After the owner's alias confirmation and readback, a fresh production capture replayed **six checked / six filed / zero outstanding**, then **zero additional filings**. Assertions verify unique evidence claims and unchanged Sent, Paid, original snapshots and manual filing history.
- Raw captures/replay harness and logs remain in ignored local scratch output. No live production import or production order status write was used for validation. No UI changed, so acceptance focused on the backend adapter and lifecycle/import boundaries.
- Repair delivery was `e9b778dbb4fae9438a63db161f9d5238c157df57` to `echospirits/neat-tst:tst`, based on the verified TST baseline above. Production promotion followed only after a separate owner instruction under AGENTS.md.

## Production closeout

- Exact selective production application: `12c1d995114203609bb92f833449138ec22bd52c`, tree `173c8111eb0f989c7062e8ed647cfc7c896b0726`, version 0.7.2. Main's extra tests/tooling and forecasting differences remain; all application UI blobs are unchanged.
- Production candidate passed **1,066 tests / 77 suites**, strict typecheck, a production-configured inert build and exact-tree Node **22.23.4** / npm **10.9.9** CI [run 42082257084](https://github.com/echospirits/ohlq-field-crm/actions/runs/42082257084), job `127438085170`. Main-push CI [42083925037](https://github.com/echospirits/ohlq-field-crm/actions/runs/42083925037) also passed.
- Production **`dpl_CyPkzhcW7UChNVE8UKFydrsEjATX`** is READY at [crm.echospirits.com](https://crm.echospirits.com). Health returned HTTP 200 with `production / ohlq-field-crm / connected` at 13:30:35 Eastern. The Git ref update did not create a build, so an explicit exact-Git-SHA production deployment inherited the existing project settings; no hosted configuration changed.
- The real service committed **six checked / six AUTO_MATCH filed / zero unfiled** at 13:30:51 Eastern, followed by **zero additional filings** on immediate replay. Both calls ran in one reviewed driver transaction under the lifecycle lock with exact production endpoint/database/commit and six-order ID guards. All expected report dates and unique claims passed; no downloader/provider or unrelated purchase-state/intelligence operation ran.
- Preservation assertions cover all non-filing order fields, Sent/Paid timestamps and actors, input snapshots, PDF SHA-256 and the full four existing manual records. Independent post-commit Neon readback confirms **10 total / 0 unfiled / 6 automatic / 4 manual / 6 unique automatic claims / 5 Completed**. Only Lupo's October 6 order newly completed; the other five retained unchecked Sent/Paid as applicable. Receipt: ignored `output/production-072-reconciliation.json`.
- At 13:31 Eastern, unauthenticated list/detail routes led to login at 390 x 844 and 1440 x 900 without page errors or horizontal overflow; visually checked screenshots show the login surface. The PDF endpoint returned **307 to /login** without exposing a PDF. Signed-in production order-state and cross-tenant acceptance remain **unverified** because no legitimate authenticated automation session was available. Relevant UI/tenant/lifecycle regression tests pass; these limits remain explicit in [0.7.2 validation](../releases/0.7.2-validation.md).
- Historical evidence remains intact. Any future recovery that needs report rows removed by retention must refresh the actual historical source; do not fabricate evidence or replace immutable order snapshots. Development remains frozen.
- Annotated `v0.7.2` is published and remotely verified: tag object `c3644bff37d4f297adeb0a763f9f63e5a4d2d5b5` points to application `12c1d995114203609bb92f833449138ec22bd52c`. TST version/docs closeout is pushed at `e649f35c2bb709751710860fc53ff20d4db415f6`. Two metadata hosting attempts timed out during resource provisioning; the previously tested TST repair remains live and healthy. The release validation record contains the exact receipts and limitation.
