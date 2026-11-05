# Wholesale Orders automatic Filed investigation

Owner scope, November 5, 2026: investigate why daily imports have not automatically marked wholesale orders Filed and repair the existing process. TST delivery is authorized; production promotion is a separate release task under AGENTS.md. Sent and Paid remain manual.

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
- No UI, schema, migration, dependency, hosted configuration or provider account change. Production order statuses remain unchanged. The only production data correction is the owner-confirmed account alias described below.

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

## Validation and delivery

- Clean locked dependency install, Prisma Client generation, strict typecheck and optimized build passed using Node 24.15.0/npm 11.12.1. The first local build was blocked by sandbox ancestor-directory reads in the existing Workflow bundler; retry outside that filesystem restriction passed without a source/configuration change. Build used an inert localhost database URL and disabled integrations.
- Focused matching/import/lifecycle/workflow-isolation/PDF checks: **48 passing tests**. Completed full suite: **1,038 tests / 76 suites**, zero failures/skips/cancellations. No schema/migration, dependency, package version or workflow change; `git diff --check` passes.
- Independent code review found and verified the correction for unresolved historical manual supplier metadata: such a reservation cannot release evidence to a nearby pending order even if the pending order stores a raw vendor ID. Conflicting supplier mappings and overlapping explicit customer aliases fail closed.
- Initial production-data replay: six checked, five filed in memory, one unlinked Antiques order left open; second pass zero additional filings. After the owner's alias confirmation and readback, a fresh production capture replayed **six checked / six filed / zero outstanding**, then **zero additional filings**. Assertions verify unique evidence claims and unchanged Sent, Paid, original snapshots and manual filing history.
- Raw captures/replay harness and logs remain in ignored local scratch output. No live production import or production order status write was used for validation. No UI changed, so acceptance focused on the backend adapter and lifecycle/import boundaries.
- Delivery target is `echospirits/neat-tst:tst`, based on the verified TST baseline above. The task delivery receipt records the exact resulting commit, Vercel deployment and health response. Production code promotion requires a separate instruction under AGENTS.md.
- Production recovery: recheck retained rows, then run the normal wholesale import/reconciliation after the repair is promoted. Daily retention can remove older October evidence, requiring a normal historical report refresh. Do not fabricate evidence or replace immutable order snapshots.
